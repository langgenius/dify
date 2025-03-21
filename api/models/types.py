import uuid

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


def adjusted_jsonb():
    if dify_config.SQLALCHEMY_DATABASE_URI_SCHEME == "postgresql":
        return postgresql.JSONB
    else:
        return JSON


def adjusted_json_index(index_name, column_name):
    index_name = index_name or f"{column_name}_idx"

    if dify_config.SQLALCHEMY_DATABASE_URI_SCHEME == "postgresql":
        return db.Index(index_name, column_name, postgresql_using="gin")
    else:
        return None


def no_length_string():
    if "mysql" in dify_config.SQLALCHEMY_DATABASE_URI_SCHEME:
        return db.String(255)
    else:
        return db.String


def adjusted_text():
    if "mysql" in dify_config.SQLALCHEMY_DATABASE_URI_SCHEME:
        return mysql.LONGTEXT
    else:
        return db.TEXT


def uuid_default():
    if dify_config.SQLALCHEMY_DATABASE_URI_SCHEME == "postgresql":
        return {"server_default": db.text("uuid_generate_v4()")}
    else:
        return {"default": lambda: uuid.uuid4()}


def varchar_default(varchar):
    if dify_config.SQLALCHEMY_DATABASE_URI_SCHEME == "postgresql":
        return {"server_default": db.text(f"'{varchar}'::character varying")}
    else:
        return {"default": varchar}


def text_default(varchar):
    if dify_config.SQLALCHEMY_DATABASE_URI_SCHEME == "postgresql":
        return {"server_default": db.text(f"'{varchar}'::text")}
    else:
        return {"default": varchar}
