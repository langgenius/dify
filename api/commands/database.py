"""Database schema migration CLI commands."""

import logging

import click

from extensions.ext_redis import redis_client
from libs.db_migration_lock import DbMigrationAutoRenewLock

logger = logging.getLogger(__name__)

DB_UPGRADE_LOCK_TTL_SECONDS = 60


@click.command("upgrade-db", help="Upgrade the database")
def upgrade_db() -> None:
    click.echo("Preparing database migration...")
    lock = DbMigrationAutoRenewLock(
        redis_client=redis_client,
        name="db_upgrade_lock",
        ttl_seconds=DB_UPGRADE_LOCK_TTL_SECONDS,
        logger=logger,
        log_context="db_migration",
    )
    if lock.acquire(blocking=False):
        migration_succeeded = False
        try:
            click.echo(click.style("Starting database migration.", fg="green"))

            import flask_migrate

            flask_migrate.upgrade()

            migration_succeeded = True
            click.echo(click.style("Database migration successful!", fg="green"))

        except Exception as e:
            logger.exception("Failed to execute database migration")
            click.echo(click.style(f"Database migration failed: {e}", fg="red"))
            raise SystemExit(1)
        finally:
            status = "successful" if migration_succeeded else "failed"
            lock.release_safely(status=status)
    else:
        click.echo("Database migration skipped")
