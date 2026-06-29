"""
Database migration utility helpers.

These are intentionally migration-specific utilities. Do NOT use them in normal
application code paths.
"""

from __future__ import annotations

import logging
from urllib.parse import quote_plus

import sqlalchemy as sa

logger = logging.getLogger(__name__)


def try_create_db_if_not_exists(
    db_type: str,
    host: str,
    port: int,
    username: str,
    password: str,
    database: str,
) -> None:
    """Best-effort attempt to create the target database if it does not exist.

    Only supports PostgreSQL and MySQL. For other database types this function
    is a no-op. Failures are logged as warnings and never re-raised, so callers
    (e.g. the migration command) are not interrupted when the database already
    exists or when the user lacks CREATE DATABASE privileges.

    Args:
        db_type: One of the supported DB_TYPE values (e.g. "postgresql", "mysql").
        host: Database server hostname or IP.
        port: Database server port.
        username: Database username.
        password: Database password.
        database: Name of the database to create if absent.
    """
    try:
        if db_type == "postgresql":
            _try_create_postgresql(host, port, username, password, database)
        elif db_type == "mysql":
            _try_create_mysql(host, port, username, password, database)
        else:
            logger.debug(
                "try_create_db_if_not_exists: unsupported db_type=%r, skipping.",
                db_type,
            )
    except Exception:
        logger.warning(
            "try_create_db_if_not_exists: failed to create database %r (db_type=%r). "
            "Proceeding anyway — migration will fail if the database truly does not exist.",
            database,
            db_type,
            exc_info=True,
        )


def _try_create_postgresql(host: str, port: int, username: str, password: str, database: str) -> None:
    # Connect to the default 'postgres' maintenance database so we can issue
    # CREATE DATABASE without requiring the target database to already exist.
    admin_uri = f"postgresql://{quote_plus(username)}:{quote_plus(password)}@{host}:{port}/postgres"
    engine = sa.create_engine(admin_uri, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            exists = conn.execute(
                sa.text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": database},
            ).scalar()
            if not exists:
                # Identifier quoting guards against names with special characters.
                conn.execute(sa.text(f'CREATE DATABASE "{database}"'))
                logger.info("try_create_db_if_not_exists: PostgreSQL database %r created.", database)
            else:
                logger.debug("try_create_db_if_not_exists: PostgreSQL database %r already exists.", database)
    finally:
        engine.dispose()


def _try_create_mysql(host: str, port: int, username: str, password: str, database: str) -> None:
    # Connect without specifying a database so the target need not exist yet.
    admin_uri = f"mysql+pymysql://{quote_plus(username)}:{quote_plus(password)}@{host}:{port}/"
    engine = sa.create_engine(admin_uri)
    try:
        with engine.connect() as conn:
            # MySQL supports IF NOT EXISTS natively — no need to check first.
            conn.execute(
                sa.text(f"CREATE DATABASE IF NOT EXISTS `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            )
            conn.commit()
            logger.info("try_create_db_if_not_exists: MySQL database %r ensured.", database)
    finally:
        engine.dispose()
