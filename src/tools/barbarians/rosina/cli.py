# Copyright 2021 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or http://www.boost.org/LICENSE_1_0.txt)

from argparse import ArgumentParser
import datetime
from .db import Database, Track, Project, Package, Stat
import peewee
import conans.client.conan_api
import semver


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
        ap_sub = ap.add_subparsers(dest="command")

        # "tracklog" command..
        ap_tracklog = ap_sub.add_parser(
            "tracklog"
        )
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
            "info"
        )

        self.args = ap.parse_args()
        if self.args.command:
            if hasattr(self, "command_"+self.args.command):
                getattr(self, "command_"+self.args.command)(self.args)

    # Commands..

    def command_info(self, args):
        with Database([Track]):
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
        # We open and bind the database to read the track log data.
        with Database([Track]):
            # We also open a connection to do the update queries and writes.
            with Database([Project, Package]):
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
                    print("[INFO] Tracking for package: {}".format((track_e.package_name, track_e.package_version,
                          track_e.package_username, track_e.package_channel)))
                    # Find or create project for package.
                    current_project = self.obtain_project(
                        track_e.package_name, self.pdm_conan)
                    if current_project.id in projects:
                        current_project = projects[current_project.id]
                    else:
                        projects[current_project.id] = current_project
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
            result = Project.get(Project.id == p.project)
        except peewee.DoesNotExist:
            # If we don't have an existing package, create a new project that
            # that matches the package.
            result = Project.create(name=name)
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
            project.name, project.id))
        # Find the current package, i.e. latest version, to obtain info from PDM.
        packages = Package.select().where(Package.project == project.id,
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
        except conans.errors.PackageNotFoundException:
            print("[ERROR] Failed to inspect package", package_ref, "ignoring.")
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
