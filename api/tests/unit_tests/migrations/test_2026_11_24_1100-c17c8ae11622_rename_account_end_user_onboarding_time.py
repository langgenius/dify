from datetime import datetime
from importlib import import_module

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATION = "migrations.versions.2026_11_24_1100-c17c8ae11622_rename_account_end_user_onboarding_time"


def test_rename_preserves_known_and_unknown_onboarding_times_in_both_directions() -> None:
    migration = import_module(MIGRATION)
    legacy = sa.Table(
        "accounts",
        sa.MetaData(),
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("first_app_used_at", sa.DateTime),
    )
    baseline = datetime(2026, 11, 4, 10)
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection, Operations.context(MigrationContext.configure(connection)):
        legacy.create(connection)
        connection.execute(
            legacy.insert(), [{"id": 1, "first_app_used_at": baseline}, {"id": 2, "first_app_used_at": None}]
        )
        migration.upgrade()
        current = sa.Table("accounts", sa.MetaData(), autoload_with=connection)
        assert set(current.c.keys()) == {"id", "be_end_user_at"}
        assert current.c.be_end_user_at.nullable
        assert connection.scalars(sa.select(current.c.be_end_user_at).order_by(current.c.id)).all() == [baseline, None]

        migration.downgrade()
        assert {col["name"] for col in sa.inspect(connection).get_columns("accounts")} == set(legacy.c.keys())
        assert connection.scalars(sa.select(legacy.c.first_app_used_at).order_by(legacy.c.id)).all() == [baseline, None]
