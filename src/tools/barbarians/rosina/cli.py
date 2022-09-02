# Copyright 2021-2022 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or http://www.boost.org/LICENSE_1_0.txt)

from argparse import ArgumentParser
import conans.client.conan_api
import datetime
import peewee
import playhouse
import playhouse.migrate
import semver
import uuid
from .db import Database, Track, Project, Package, Stat, Models, Meta, Model


class Rosina(object):
    """
        Rosina, daughter of a sorceress and rescued by Conan from slavery, with
        her figurines shattered losses her mind trying to put them back together.
    """

    pdm_conan = "conan"

    def __init__(self):
        ap = ArgumentParser(
            "barbarian_rosina",
            description='''\
Required environment variables for database connection: DB_HOST, DB_USER,
DB_PASSWORD, DB_DATABASE.
''')
        ap.add_argument(
            "--mariadb",
            help="Use MariaDB backend instead of MySQL.",
            action="store_true",
            default=False)

        ap_sub = ap.add_subparsers(dest="command")

        # "tracklog" command..
        ap_tracklog = ap_sub.add_parser(
            "tracklog",
            help="Process track data to statistics info.")
        ap_tracklog.add_argument(
            "--skip-project-refresh",
            help="Skip refreshing project data from PDM info.",
            action="store_true",
            default=False)
        ap_tracklog.add_argument(
            "--skip-delete",
            help="Skip deleting processed tracklog entries.",
            action="store_true",
            default=False)

        # Info command..
        ap_info = ap_sub.add_parser(
            "info",
            help="Show information about the database.")

        # Database management commands..
        ap_create = ap_sub.add_parser(
            "create",
            help="Create schema in an empty database.")
        ap_migrate = ap_sub.add_parser(
            "migrate",
            help="Migrate the database schema to the latest version.")
        ap_turnoff = ap_sub.add_parser(
            "turnoff",
            help="Mark the database off, and out of service.")
        ap_turnon = ap_sub.add_parser(
            "turnon",
            help="Mark the database on, and in service.")

        self.args = ap.parse_args()
        if self.args.command:
            if hasattr(self, "command_"+self.args.command):
                getattr(self, "command_"+self.args.command)(self.args)

        if self._db:
            self._db.close()

    # The databass..

    _db = None

    @property
    def db(self):
        if not self._db:
            self._db = Database()
            self._db.connect()
        return self._db

    # Commands..

    def command_create(self, args):
        print("Creating models:", *Models)
        self.db.create_tables(Models)
        self.db.execute_sql(
            'ALTER TABLE `barbarian_project` ADD FULLTEXT KEY `fulltext_all` (`name`,`description_brief`,`topic`);')
        self.db.execute_sql(
            'ALTER TABLE `barbarian_project` ADD FULLTEXT KEY `fulltext_topic` (`topic`);')
        self.db.execute_sql(
            'ALTER TABLE `barbarian_project` ADD FULLTEXT KEY `fulltext_name` (`name`);')

    def command_turnoff(self, args):
        self.do_set_in_service(False)
        print("Placed the database out of service.")

    def command_turnon(self, args):
        self.do_set_in_service(True)
        print("Placed the database in service.")

    def do_set_in_service(self, in_service=True):
        with self.db.atomic():
            meta, created = Meta.get_or_create(
                key="status", defaults={'value': {'in_service': True}})
            result = meta.value['in_service']
            meta.value['in_service'] = in_service
            meta.save()
            return result

    def command_migrate(self, args):
        in_service = self.do_set_in_service(False)
        if in_service:
            print("Placed the database out of service for the migration.")
        with self.db.atomic():
            version = Meta.get(Meta.key == "version")
            schema_version_past = int(version.value['schema'])
            schema_version_future = int(Meta.version['schema'])
            while schema_version_past < schema_version_future:
                migrate_f = "do_migrate_{}_to_{}".format(
                    schema_version_past, schema_version_future)
                if not hasattr(self, migrate_f):
                    break
                print("Migrating from schema version",
                      schema_version_past, "to", schema_version_future, "...")
                getattr(self, migrate_f)(args)
                print("Migration to schema version",
                      schema_version_future, "complete.")
                schema_version_past += 1
            if schema_version_past < schema_version_future:
                print("WARNING: No schema migration from",
                      schema_version_past, "to", schema_version_future, "possible.")
        if in_service:
            self.do_set_in_service(True)
            print("Place the database back in service.")

    class Project_1_to_2(Model):
        id = peewee.BigIntegerField()

        class Meta:
            table_name = 'barbarian_project'

    def do_migrate_1_to_2(self, args):
        """
        Migrates a v1 database to v2 by: generating uuid values for projects and
        replacing the v1 IDs with them.
        """
        Rosina.Project_1_to_2.bind(self.db)
        migrator = playhouse.migrate.MySQLMigrator(self.db)
        # Generate UUIDs for the existing projects.
        project_id2uuid = {}
        with self.db.atomic():
            for project in Rosina.Project_1_to_2.select(Rosina.Project_1_to_2.id):
                new_uuid = uuid.uuid4()
                print("Assigning uuid", new_uuid, "to project #", project.id)
                project_id2uuid[str(project.id)] = new_uuid
        # Drop the indices, constraints, foreign keys so we can restructure.
        self.db.execute_sql(
            'ALTER TABLE barbarian_project DROP PRIMARY KEY;')
        playhouse.migrate.migrate(
            migrator.drop_index('barbarian_package', 'unique_package'))
        # Project.. Rename & retype columns, and refill with new data.
        playhouse.migrate.migrate(
            migrator.rename_column('barbarian_project', 'id', 'uuid'),
            migrator.alter_column_type('barbarian_project', 'uuid', peewee.UUIDField(primary_key=True)))
        with self.db.atomic():
            for project_id, project_uuid in project_id2uuid.items():
                update_sql = "UPDATE barbarian_project SET uuid = '" + \
                    project_uuid.hex+"' WHERE uuid = '"+project_id+"';"
                self.db.execute_sql(update_sql)
        # Packages.. Retype columns, and refill with new data.
        playhouse.migrate.migrate(
            migrator.alter_column_type(
                'barbarian_package', 'project', peewee.UUIDField()))
        with self.db.atomic():
            for project_id, project_uuid in project_id2uuid.items():
                update_sql = "UPDATE barbarian_package SET project = '" + \
                    project_uuid.hex+"' WHERE project = '"+project_id+"';"
                self.db.execute_sql(update_sql)
        # Stats.. Retype columns, and refill with new data.
        playhouse.migrate.migrate(
            migrator.alter_column_type(
                'barbarian_stat', 'project', peewee.UUIDField()))
        with self.db.atomic():
            for project_id, project_uuid in project_id2uuid.items():
                update_sql = "UPDATE barbarian_stat SET project = '" + \
                    project_uuid.hex+"' WHERE project = '"+project_id+"';"
                self.db.execute_sql(update_sql)
        # Recreate the indices, constraints, foreign keys.
        self.db.execute_sql(
            'ALTER TABLE barbarian_package ADD PRIMARY KEY (`project`,`name`,`version`,`identity`,`packager`)')
        self.db.execute_sql(
            'CREATE INDEX `package_project` ON barbarian_package (`project`)')
        playhouse.migrate.migrate(
            migrator.add_foreign_key_constraint(
                'barbarian_package', 'project', 'barbarian_project', 'uuid'))
        self.db.execute_sql(
            'CREATE INDEX `package_project` ON barbarian_stat (`project`)')
        playhouse.migrate.migrate(
            migrator.add_foreign_key_constraint(
                'barbarian_stat', 'project', 'barbarian_project', 'uuid'))

    def command_info(self, args):
        with self.db.atomic():
            # For stability we limit the set of tracking entries to those older
            # than a specific datetime, now.
            now = datetime.datetime.now()
            # Query all the track log data, and process one at a time.
            for track_i in Track.select().where(Track.t < now).iterator():
                print("> ", track_i.package_name, track_i.package_version,
                      track_i.package_username, track_i.package_channel)

    def command_tracklog(self, args):
        """
        Process track log entries to add and update the database of projects
        and packages.
        """
        with self.db.atomic():
            # For stability we limit the set of tracking entries to those older
            # than a specific datetime, now.
            now = datetime.datetime.now()
            # The projects that get updated and refreshed.
            projects = {}
            # Query all the track log data, and process one at a time.
            track_i = Track.select().where(Track.t < now).order_by(
                Track.package_name, Track.package_version,
                Track.package_username, Track.package_channel
            ).iterator()
            track_e = next(track_i, None)
            while track_e is not None:
                print("[INFO] Tracking for package: {}".format(
                    (track_e.package_name, track_e.package_version,
                        track_e.package_username, track_e.package_channel)))
                # Find or create project for package.
                current_project = self.obtain_project(
                    track_e.package_name, self.pdm_conan)
                if current_project.uuid in projects:
                    current_project = projects[current_project.uuid]
                else:
                    projects[current_project.uuid] = current_project
                # Find or create package that matches current track entry.
                current_package = self.obtain_package(
                    current_project,
                    track_e.package_name,
                    track_e.package_version,
                    track_e.package_identity,
                    self.pdm_conan)
                # Track the stats for this package. Or move on to the next one.
                while track_e is not None:
                    if track_e.package_name != current_package.name or \
                            track_e.package_version != current_package.version or \
                        track_e.package_identity != current_package.identity or \
                            self.pdm_conan != current_package.packager:
                        break
                    else:
                        stat = Stat.create(
                            project=current_project,
                            package_name=track_e.package_name,
                            package_version=track_e.package_version,
                            package_identity=track_e.package_identity,
                            packager=self.pdm_conan,
                            span_start=track_e.t, span_end=track_e.t,
                            stat='down', value_i=1)
                        stat.save()
                        track_e = next(track_i, None)
            # Refresh the data for the projects we encountered.
            if not args.skip_project_refresh:
                for project in projects.values():
                    self.refresh_project(project)
            # Clear out processed tracklog entries.
            if not args.skip_delete:
                Track.delete().where(Track.t < now).execute()

    def obtain_project(self, name, packager):
        result = None
        # Find an existing package that corresponds to the possible project.
        try:
            p = Package.get(
                Package.name == name,
                Package.packager == packager)
            result = Project.get(Project.uuid == p.project)
        except peewee.DoesNotExist:
            # If we don't have an existing package, create a new project that
            # that matches the package.
            result = Project.create(uuid=uuid.uuid4(), name=name)
        # print("[INFO] project:", result)
        return result

    def obtain_package(self, project, name, version, identity, packager):
        try:
            result = Package.get(
                Package.project == project,
                Package.name == name,
                Package.version == version,
                Package.identity == identity,
                Package.packager == packager)
        except peewee.DoesNotExist:
            result = Package.create(
                project=project,
                name=name, version=version, identity=identity, packager=packager)
        # print("[INFO] package:", result)
        return result

    def refresh_project(self, project):
        print("[INFO] Refresh project: {} #{}".format(
            project.name, project.uuid))
        # Find the current package, i.e. latest version, to obtain info from PDM.
        packages = Package.select().where(Package.project == project.uuid,
                                          Package.packager == self.pdm_conan)
        latest_version = "0"
        latest_package = None
        for package in packages:
            if semver.parse(package.version, True) and semver.gt(package.version, latest_version, True):
                latest_version = package.version
                latest_package = package
        if latest_package:
            # Obtain the details package info from PDM.
            package_info = self.obtain_conan_package_info(latest_package)
            if not package_info:
                # Failed to find the package, or info. Ignore the update.
                return
            # Set project info from package.
            project.description_brief = package_info['description']
            project.topic = package_info['topics']
            project.license = package_info['license']
            project.info = package_info
        # Write out the updated project data.
        project.save()

    def obtain_conan_package_info(self, package: Package):
        """
        Fetch the information for a package in a Conan remote repository.
        """
        assert(package.packager == self.pdm_conan)
        conan_api: conans.client.conan_api.Conan = conans.client.conan_api.Conan.factory()[
            0]
        package_ref = "{}/{}@{}".format(package.name,
                                        package.version, package.identity.split("#")[0])
        package_attributes = [
            'barbarian', 'name', 'version', 'url', 'homepage', 'license', 'author',
            'description', 'topics', 'settings', 'options', 'default_options']
        package_remote = "barbarian-github"
        conan_api.config_set("general.revisions_enabled", "True")
        conan_api.remote_add(
            package_remote,
            "https://barbarian.bfgroup.xyz/github",
            force=True)
        try:
            package_info = conan_api.inspect(
                package_ref, package_attributes, package_remote)
        except conans.errors.NotFoundException:
            print("[ERROR] Failed to inspect package",
                  package_ref, "ignoring.")
            return None
        # Extract description if it's from an export file.
        if 'barbarian' in package_info and 'description' in package_info['barbarian'] and 'file' in package_info['barbarian']['description']:
            description_file = package_info['barbarian']['description']['file']
            try:
                description_text, _ = conan_api.get_path(
                    package_ref,
                    path=description_file,
                    remote_name=package_remote)
                if description_text:
                    package_info['barbarian']['description']['text'] = description_text
                    print("[INFO] Obtained description text for package",
                          package_ref, "from export file", description_file)
            finally:
                # Ignore errors from fetching description data?
                pass
        return package_info


def main():
    Rosina()


if __name__ == '__main__':
    main()
