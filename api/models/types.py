import json

from sqlalchemy import CHAR, JSON, TypeDecorator
from sqlalchemy.dialects import mysql, postgresql

from configs import dify_config

from .engine import db


class StringUUID(TypeDecorator):
    impl = CHAR
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name in {"postgresql", "mysql"}:
            return str(value)
        else:
            return value.hex

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(postgresql.UUID())
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        return str(value)


class JSONType(TypeDecorator):
    impl = JSON
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        else:
            return json.dumps(value)

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(postgresql.JSONB())
        elif dialect.name == "mysql":
            return dialect.type_descriptor(mysql.JSON())
        else:
            raise NotImplementedError(f"Unsupported dialect: {dialect.name}")

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        else:
            return json.loads(value)


def json_index(index_name, column_name):
    index_name = index_name or f"{column_name}_idx"

    if dify_config.SQLALCHEMY_DATABASE_URI_SCHEME == "postgresql":
        return db.Index(index_name, column_name, postgresql_using="gin")
    else:
        return None
