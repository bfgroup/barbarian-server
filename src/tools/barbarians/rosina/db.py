# Copyright 2021-2022 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or http://www.boost.org/LICENSE_1_0.txt)

# import mysql.connector
import os
import peewee
import playhouse.mysql_ext
import json
import uuid

from playhouse.mysql_ext import JSONField

Models = []


class Database(peewee.DatabaseProxy):
    """
    Manages Barbarian database connection initialized from env settings.
    It optionally binds models to the database for immediate use.
    """
    __slots__ = ('obj', '_callbacks', '_models', '_bind')

    def __init__(self, models=None, dbkind=None):
        super().__init__()
        if not dbkind and os.getenv("DB_KIND") == "mariadb":
            dbkind = playhouse.mysql_ext.MariaDBConnectorDatabase
        if not dbkind and os.getenv("DB_KIND") == "mysql":
            dbkind = playhouse.mysql_ext.MySQLConnectorDatabase
        database = dbkind(
            os.getenv("DB_DATABASE"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
            host=os.getenv("DB_HOST")
        )
        self.initialize(database)
        self.bind(Models)


class TagsField(peewee.UUIDField):
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


class Meta(Model):
    """
    Metadata about the database and its schema. It's a freeform key=value
    store where the value is a JSON object.
    """
    key = peewee.CharField(max_length=100, primary_key=True)  # varchar(100)
    value = JSONField(null=True)  # JSON

    version = {"schema": "2"}


Models.append(Meta)


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


Models.append(Track)


class Project(Model):
    """
    A project is the top level container for ay kind of packageable product.
    This could be anything from a library, tool, documentation, etc. A project
    has packages for it available as sub entires in the index. It contains
    key information that is shared among all the packages for the project.
    """
    uuid = peewee.UUIDField(primary_key=True)  # varchar(40)
    # Ideal, overall, name for the project.
    name = peewee.CharField(max_length=100)  # varchar(100)
    # Brief text description of the project.
    description_brief = peewee.TextField(null=True)  # text
    # Space delimited topic tags.
    topic = TagsField(null=True)  # text
    # Normalized license of project.
    license = peewee.CharField(max_length=50, null=True)  # varchar(50)
    # Latest package update date & time.
    updated = peewee.DateTimeField(null=True)  # datetime
    # Detailed information on the project.
    info = JSONField(null=True)  # JSON


Models.append(Project)


class Package(Model):
    """
    A package is an instance of a project available in a particular
    PDM (aka packager).
    """
    project = peewee.ForeignKeyField(
        Project, backref="packages", column_name='project')  # varchar(40)
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

    class Meta:
        primary_key = peewee.CompositeKey(
            'project', 'name', 'version', 'identity', 'packager')


Models.append((Package))


class Stat(Model):
    """
    Single entry for a package statistic value.
    """
    id = peewee.BigIntegerField(primary_key=True)  # bigint(20)
    project = peewee.ForeignKeyField(
        Project, backref="packages", column_name='project')  # varchar(40)
    # Package name for the PDM.
    package_name = peewee.CharField(max_length=100)  # varchar(100)
    # Version in form needed for the package.
    package_version = peewee.CharField(max_length=100)  # varchar(100)
    # Optional identity to differentiate multiple packages of the same project
    # in the same PDM. For Conan packages this would include the user, channel,
    # and possibly the recipe revision.
    package_identity = peewee.CharField(
        max_length=300, null=True)  # varchar(300)
    # The PDM for the package, only "Conan" so far.
    packager = peewee.CharField(max_length=30)  # varchar(30)
    # Time span that the stat applies to.
    span_start = peewee.DateTimeField()  # datatime
    span_end = peewee.DateTimeField()  # datatime
    # The stat key ID.
    stat = peewee.FixedCharField(max_length=4, choices=[
        ('down', 'downloads')
    ])  # char(4)
    # The stat value, if it's a decimal.
    value_i = peewee.BigIntegerField()  # bigint(20)


Models.append(Stat)
