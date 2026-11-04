"""Verify execution lookup indexes without creating a second usage ledger."""

from importlib import import_module

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_execution_indexes_upgrade_and_downgrade_preserve_rows() -> None:
    migration = import_module("migrations.versions.2026_10_30_1600-b73e9c40a215_add_consumer_execution_indexes")
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    users = sa.Table(
        "end_users",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("account_id", sa.String),
        sa.Column("type", sa.String),
        sa.Column("tenant_id", sa.String),
        sa.Column("app_id", sa.String),
    )
    runs = sa.Table(
        "workflow_runs",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("tenant_id", sa.String),
        sa.Column("app_id", sa.String),
        sa.Column("created_by_role", sa.String),
        sa.Column("created_by", sa.String),
        sa.Column("triggered_from", sa.String),
        sa.Column("created_at", sa.DateTime),
    )
    try:
        with engine.begin() as connection:
            metadata.create_all(connection)
            connection.execute(users.insert().values(id="user", account_id="account"))
            connection.execute(runs.insert().values(id="run", created_by="user"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            inspector = sa.inspect(connection)
            assert set(inspector.get_table_names()) == {"end_users", "workflow_runs"}
            assert inspector.get_indexes("end_users")[0]["column_names"] == [
                "account_id",
                "type",
                "tenant_id",
                "app_id",
                "id",
            ]
            assert inspector.get_indexes("workflow_runs")[0]["column_names"] == [
                "tenant_id",
                "app_id",
                "created_by_role",
                "created_by",
                "triggered_from",
                "created_at",
            ]
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            assert sa.inspect(connection).get_indexes("end_users") == []
            assert sa.inspect(connection).get_indexes("workflow_runs") == []
            assert connection.execute(sa.select(users.c.id, users.c.account_id)).one() == ("user", "account")
            assert connection.execute(sa.select(runs.c.id, runs.c.created_by)).one() == ("run", "user")
    finally:
        engine.dispose()
