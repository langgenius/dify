"""The revocation job has no physical links to live credentials or history."""

from importlib import import_module

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_upgrade_and_downgrade_of_the_encrypted_handoff() -> None:
    """Verify upgrade and downgrade without changing data in the existing live table."""
    migration = import_module("migrations.versions.2026_11_18_1200-e65c713bf204_add_expired_guest_oauth_grants")
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
        live = sa.Table(
            "end_user_connections",
            sa.MetaData(),
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("account_id", sa.String(36)),
            sa.Column("last_active_at", sa.DateTime(), nullable=False),
            sa.Index("end_user_connection_activity_idx", "last_active_at", "id"),
        )
        live.create(connection)
        migration.upgrade()
        name = "expired_guest_oauth_grants"
        schema = sa.inspect(connection)
        assert schema.get_foreign_keys(name) == []
        assert schema.get_pk_constraint(name)["constrained_columns"] == ["connection_id"]
        assert schema.get_indexes(name)[0]["column_names"] == ["available_at", "connection_id"]
        assert not next(column for column in schema.get_columns(name) if column["name"] == "encrypted_credentials")[
            "nullable"
        ]
        assert schema.get_indexes(live.name)[0]["column_names"] == ["account_id", "last_active_at", "id"]
        migration.downgrade()
        restored = sa.inspect(connection)
        assert not restored.has_table(name)
        assert restored.get_indexes(live.name)[0]["column_names"] == ["last_active_at", "id"]
    engine.dispose()
