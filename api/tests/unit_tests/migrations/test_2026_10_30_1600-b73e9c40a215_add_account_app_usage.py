"""Exercise the portable usage migration against a real database schema."""

from importlib import import_module

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_usage_schema_upgrade_and_downgrade() -> None:
    migration = import_module("migrations.versions.2026_10_30_1600-b73e9c40a215_add_account_app_usage")
    engine = sa.create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            inspector = sa.inspect(connection)
            assert {column["name"] for column in inspector.get_columns("account_app_usages")} == {
                "id",
                "account_id",
                "tenant_id",
                "app_id",
                "last_used_at",
                "created_at",
                "updated_at",
            }
            assert inspector.get_unique_constraints("account_app_usages")[0]["column_names"] == [
                "account_id",
                "tenant_id",
                "app_id",
            ]
            assert inspector.get_indexes("account_app_usages")[0]["column_names"] == [
                "account_id",
                "last_used_at",
                "app_id",
            ]
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            assert not sa.inspect(connection).has_table("account_app_usages")
    finally:
        engine.dispose()
