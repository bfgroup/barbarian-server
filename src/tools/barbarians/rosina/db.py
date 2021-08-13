# Copyright 2021 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or http://www.boost.org/LICENSE_1_0.txt)

# import mysql.connector
import os
import peewee
import playhouse.mysql_ext
import json


class Database(playhouse.mysql_ext.MySQLConnectorDatabase):
    """
    Manages Barbarian database connection initialized from env settings.
    It optionally binds models to the database for immediate use.
    """

    def __init__(self, models=None):
        super().__init__(
            os.getenv("DB_DATABASE"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
            host=os.getenv("DB_HOST")
        )
        self._models = models
        self._bind = None

    def __enter__(self):
        super().__enter__()
        if self._models is not None:
            self._bind = self.bind_ctx(self._models)
            self._bind.__enter__()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._bind is not None:
            self._bind.__exit__(exc_type, exc_val, exc_tb)
        super().__exit__(exc_type, exc_val, exc_tb)


class JSONField(peewee.TextField):
    """
    Db field backed by Mysql JSON field type that converts to/from Python
    datastructure.
    """
    field_type = 'JSON'

    def db_value(self, value):
        if value is not None:
            return json.dumps(value, sort_keys=True)

    def python_value(self, value):
        if value is not None:
            return json.loads(value)


class TagsField(peewee.TextField):
    """
    Db field backed by Mysql TEXT field type that converts to/from Python
    list and a space separated set of tag values.
    """

    def db_value(self, value):
        if value is not None:
            return " ".join(value)

    def python_value(self, value):
        if value is not None:
            return value.split()


def barbarian_table_name(model_class):
    return "barbarian_" + peewee.make_snake_case(model_class.__name__)


class Model(peewee.Model):
    """
    Base table model that enforces some conventions and provides additional
    query utilities.
    """
    class Meta:
        table_function = barbarian_table_name


class Track(Model):
    """
    Tracking log entries of access to Barbarian server.
    """
    id = peewee.BigIntegerField(primary_key=True)  # bigint(20)
    package_name = peewee.CharField(max_length=100)  # varchar(100)
    package_version = peewee.CharField(max_length=100)  # varchar(100)
    package_username = peewee.CharField(
        max_length=100, null=True)  # varchar(100)
    package_channel = peewee.CharField(
        max_length=100, null=True)  # varchar(100)
    revision = peewee.CharField(max_length=64, null=True)  # varchar(64)
    dp = peewee.CharField(max_length=200)  # varchar(200)
    ua = peewee.CharField(max_length=300)  # varchar(300)
    uip = peewee.CharField(max_length=16)  # varchar(16)
    t = peewee.DateTimeField()  # datatime

    @property
    def package_identity(self):
        result = '{}/{}'.format(
            self.package_username if self.package_username else "_",
            self.package_channel if self.package_channel else "_")
        if self.revision:
            result += "#"+self.revision
        return result


class Project(Model):
    """
    A project is the top level container for ay kind of packageable product.
    This could be anything from a library, tool, documentation, etc. A project
    has packages for it available as sub entires in the index. It contains
    key information that is shared among all the packages for the project.
    """
    id = peewee.BigIntegerField(primary_key=True)  # bigint(20)
    # Ideal, overall, name for the project.
    name = peewee.CharField(max_length=100)  # varchar(100)
    # Brief text description of the project.
    description_brief = peewee.TextField(null=True)  # text
    # Space delimited topic tags.
    topic = TagsField(null=True)  # text
    # Normalized license of project.
    license = peewee.CharField(max_length=50, null=True)  # varchar(50)
    # Combined count of package downloads through the Barbarian server.
    downloads = peewee.BigIntegerField(default=0)  # bigint(20)
    # Latest package update date & time.
    updated = peewee.DateTimeField(null=True)  # datetime
    # Detailed information on the project.
    info = JSONField(null=True)  # JSON


class Package(Model):
    """
    A package is an instance of a project available in a particular
    PDM (aka packager).
    """
    project = peewee.ForeignKeyField(
        Project, backref="packages", column_name='project')  # bigint(20)
    # Package name for the PDM.
    name = peewee.CharField(max_length=100)  # varchar(100)
    # Version in form needed for the package.
    version = peewee.CharField(max_length=100)  # varchar(100)
    # Optional identity to differentiate multiple packages of the same project
    # in the same PDM. For Conan packages this would include the user, channel,
    # and possibly the recipe revision.
    identity = peewee.CharField(max_length=300, null=True)  # varchar(300)
    # The PDM for the package, only "Conan" so far.
    packager = peewee.CharField(max_length=30)  # varchar(30)
    # Detailed information on the package.
    info = JSONField(null=True)  # JSON
    # Count of package downloads through the Barbarian server.
    downloads = peewee.BigIntegerField(default=0)  # bigint(20)

    class Meta:
        primary_key = peewee.CompositeKey(
            'project', 'name', 'version', 'identity', 'packager')
