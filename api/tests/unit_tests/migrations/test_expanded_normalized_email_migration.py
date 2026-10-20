from __future__ import annotations

import importlib.util
from io import StringIO
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from services.account_email import normalize_email


def _load_migration() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[3]
        / "migrations/versions/2026_09_10_1200-d8e4a6b1c902_expand_normalized_email_providers.py"
    )
    spec = importlib.util.spec_from_file_location("expand_normalized_email_providers", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upgrade_matches_runtime_preserves_accounts_and_downgrade_restores_values() -> None:
    domains = [
        "outlook.com",
        "hotmail.com",
        "live.com",
        "msn.com",
        "icloud.com",
        "me.com",
        "mac.com",
        "protonmail.com",
        "proton.me",
        "pm.me",
        "protonmail.ch",
        "yahoo.com",
        "yahoo.co.uk",
        "mail.com",
        "example.org",
        "sub.proton.me",
        "outlook.com.example.org",
    ]
    emails = [f"{local}@{domain.upper()}" for domain in domains for local in ("First.Last_Name-Test+tag+other", "User")]
    emails += ["user+duplicate@outlook.com", "u.ser+tag@gmail.com", "User@GoogleMail.com"]
    original_values = [
        normalize_email(email) if email.lower().endswith(("@gmail.com", "@googlemail.com")) else email.lower()
        for email in emails
    ]
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accounts = sa.Table(
        "accounts",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("normalized_email", sa.String(255), nullable=True),
        sa.Index("account_normalized_email_idx", "normalized_email"),
    )
    metadata.create_all(engine)
    module = _load_migration()
    with engine.begin() as connection:
        connection.execute(
            accounts.insert(),
            [
                {"id": index, "email": email, "normalized_email": original_values[index]}
                for index, email in enumerate(emails)
            ],
        )
        module.__dict__["op"] = Operations(MigrationContext.configure(connection))
        module.upgrade()
        rows = connection.execute(sa.select(accounts).order_by(accounts.c.id)).all()
        assert [row.email for row in rows] == emails
        assert [row.normalized_email for row in rows] == [normalize_email(email) for email in emails]
        assert [row.normalized_email for row in rows].count("user@outlook.com") == 2
        module.upgrade()
        assert connection.execute(sa.select(accounts).order_by(accounts.c.id)).all() == rows
        module.downgrade()
        assert (
            connection.scalars(sa.select(accounts.c.normalized_email).order_by(accounts.c.id)).all() == original_values
        )
    engine.dispose()


@pytest.mark.parametrize("dialect", ["postgresql", "mysql", "mariadb", "sqlite"])
@pytest.mark.parametrize("restore", [False, True])
def test_migration_supports_offline_sql(dialect: str, restore: bool) -> None:
    output = StringIO()
    module = _load_migration()
    module.__dict__["op"] = Operations(
        MigrationContext.configure(
            dialect_name=dialect,
            opts={"as_sql": True, "output_buffer": output},
        )
    )
    module._backfill_normalized_emails(restore=restore)
    sql = output.getvalue()
    assert "UPDATE accounts SET normalized_email=" in sql
    assert "WHERE" in sql
    assert "protonmail.ch" in sql
    assert "gmail.com" not in sql
    assert "CASE" in sql if not restore else "CASE" not in sql
