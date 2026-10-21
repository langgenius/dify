"""DDL helpers shared by the native testing migration chain."""

import sqlalchemy as sa
from alembic import op


def function_schema_prefix() -> str:
    """Resolve online schemas; exported SQL resolves the same search path when applied."""
    if op.get_context().as_sql:
        return ""
    connection = op.get_bind()
    schema = connection.execute(sa.text("SELECT current_schema()")).scalar_one()
    return connection.dialect.identifier_preparer.quote(schema) + "."


def require_empty_table(table: str, reason: str, *, lock: bool = False, predicate: str | None = None) -> None:
    """Retain evidence checks in exported SQL instead of reading a nonexistent connection."""
    query = f"SELECT 1 FROM {table}"
    if predicate:
        query += f" WHERE {predicate}"
    query += " LIMIT 1"
    offline_mysql = op.get_context().as_sql and is_mysql()
    procedure = "builder_downgrade_guard"
    if offline_mysql:
        # MySQL refuses routine DDL while tables are locked. Define the guard
        # first, then run its read under the lock retained through DROP TABLE.
        op.execute(sa.text(f"DROP PROCEDURE IF EXISTS {procedure}"))
        mysql_program(f"""CREATE PROCEDURE {procedure}() BEGIN
            IF EXISTS ({query}) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '{reason}';
            END IF; END""")
    if lock:
        op.execute(
            sa.text(f"LOCK TABLES {table} WRITE" if is_mysql() else f"LOCK TABLE {table} IN ACCESS EXCLUSIVE MODE")
        )
    if op.get_context().as_sql:
        if is_mysql():
            op.execute(sa.text(f"CALL {procedure}()"))
            if not lock:
                op.execute(sa.text(f"DROP PROCEDURE {procedure}"))
        else:
            op.execute(
                sa.text(f"""DO $$ BEGIN IF EXISTS ({query})
                THEN RAISE EXCEPTION '{reason}'; END IF; END $$""")
            )
    elif op.get_bind().execute(sa.text(query)).first():
        if lock:
            unlock_tables()
        raise RuntimeError(reason)


def is_mysql() -> bool:
    return op.get_bind().dialect.name == "mysql"


def mysql_program(statement: str) -> None:
    """Emit a compound MySQL statement with CLI delimiters only in SQL exports."""
    if op.get_context().as_sql:
        op.get_context().impl.static_output(f"DELIMITER $$\n{statement}$$\nDELIMITER ;")
    else:
        op.execute(sa.text(statement))


def mysql_immutable_triggers(table: str, name: str, reason: str) -> None:
    for event in ("UPDATE", "DELETE"):
        mysql_program(
            f"CREATE TRIGGER {name}_{event.lower()} BEFORE {event} ON {table} "
            f"FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '{reason}'"
        )


def mysql_changed(fields: tuple[str, ...]) -> str:
    """Null-safe binary comparisons preserve case-sensitive immutable identities."""
    return " OR ".join(f"NOT (BINARY NEW.{field} <=> BINARY OLD.{field})" for field in fields)


def unlock_tables() -> None:
    if is_mysql():
        op.execute(sa.text("UNLOCK TABLES"))
        if op.get_context().as_sql:
            op.execute(sa.text("DROP PROCEDURE builder_downgrade_guard"))
