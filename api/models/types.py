import json

from sqlalchemy import CHAR, Index, TypeDecorator
from sqlalchemy import JSON as SAJSON
from sqlalchemy.dialects.mysql import JSON as MYSQLJSON
from sqlalchemy.dialects.postgresql import JSONB, UUID


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
            return dialect.type_descriptor(UUID())
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        return str(value)


class AdjustedJSON(TypeDecorator):
    """
    Adjusted JSON type for PostgreSQL and MySQL.
    It is treated as JSONB in PostgreSQL and JSON in MySQL.
    """

    impl = SAJSON
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        return json.dumps(value)

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB)
        elif dialect.name == "mysql":
            return dialect.type_descriptor(MYSQLJSON)
        else:
            raise NotImplementedError(f"Unsupported dialect: {dialect.name}")

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        return json.loads(value)


class PostgresJSONIndex(Index):
    """
    JSON index for PostgreSQL.
    This should be ignored in MySQL, because MySQL does not support indexing JSON column directly.
    Reference: https://dev.mysql.com/doc/refman/8.0/en/create-table-secondary-indexes.html#json-column-indirect-index

    It's required to modify the index creation statement for this index in the migration script.
    """

    pass
