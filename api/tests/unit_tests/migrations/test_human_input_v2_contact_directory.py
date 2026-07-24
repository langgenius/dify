"""Migration contract tests for the Human Input v2 Contact Directory slice."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from models.human_input_v2 import HumanInputContact, HumanInputPlatformContactWorkspaceEntry

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_07_25_1000-5c8f1a2b3d4e_add_human_input_v2_contact_directory.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("human_input_v2_contact_directory_migration", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_migration_step(module: object, engine: sa.Engine, step_name: str) -> None:
    with engine.begin() as connection:
        context = MigrationContext.configure(connection)
        operations = Operations(context)
        original_op = module.op
        module.op = operations
        try:
            getattr(module, step_name)()
        finally:
            module.op = original_op


def test_revision_metadata_is_a_single_ordered_slice() -> None:
    module = _load_migration_module()

    assert module.revision == "5c8f1a2b3d4e"
    assert module.down_revision == "d2825e7b9c10"
    assert module.branch_labels is None
    assert module.depends_on is None


def test_upgrade_matches_contact_model_metadata_and_constraints() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()

    _run_migration_step(module, engine, "upgrade")

    inspector = sa.inspect(engine)
    assert set(inspector.get_table_names()) == {
        "human_input_contacts",
        "human_input_platform_contact_workspace_entries",
    }
    contact_columns = {column["name"]: column for column in inspector.get_columns("human_input_contacts")}
    assert set(contact_columns) == {column.name for column in HumanInputContact.__table__.columns}
    assert contact_columns["tenant_id"]["nullable"] is True
    assert contact_columns["account_id"]["nullable"] is True
    assert contact_columns["identity_source"]["nullable"] is False
    entry_columns = {
        column["name"]: column for column in inspector.get_columns("human_input_platform_contact_workspace_entries")
    }
    assert set(entry_columns) == {column.name for column in HumanInputPlatformContactWorkspaceEntry.__table__.columns}
    assert all(entry_columns[name]["nullable"] is False for name in ("tenant_id", "contact_id", "added_by_account_id"))

    contact_checks = {constraint["name"] for constraint in inspector.get_check_constraints("human_input_contacts")}
    assert contact_checks == {"identity_owner", "external_email", "email_normalization_pair"}
    contact_uniques = {constraint["name"] for constraint in inspector.get_unique_constraints("human_input_contacts")}
    assert contact_uniques == {"human_input_contacts_tenant_account_uq", "human_input_contacts_tenant_email_uq"}
    contact_indexes = {index["name"] for index in inspector.get_indexes("human_input_contacts")}
    assert contact_indexes == {
        "human_input_contacts_tenant_normalized_email_idx",
        "human_input_contacts_tenant_normalized_name_idx",
    }


def test_upgrade_enforces_structured_identity_source_owner_values() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO human_input_contacts "
                "(id, name, normalized_name, identity_source, tenant_id, account_id, email, normalized_email) "
                "VALUES (:id, :name, :normalized_name, :identity_source, :tenant_id, :account_id, :email, "
                ":normalized_email)"
            ),
            {
                "id": "contact-1",
                "name": "Reviewer",
                "normalized_name": "reviewer",
                "identity_source": "external",
                "tenant_id": "workspace-1",
                "account_id": None,
                "email": "reviewer@example.com",
                "normalized_email": "reviewer@example.com",
            },
        )

    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO human_input_contacts "
                    "(id, name, normalized_name, identity_source, tenant_id, account_id, email, normalized_email) "
                    "VALUES ('invalid', 'Invalid', 'invalid', 'external', NULL, NULL, 'invalid@example.com', "
                    "'invalid@example.com')"
                )
            )


def test_downgrade_removes_only_contact_directory_tables() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE unrelated_state (id INTEGER PRIMARY KEY)"))
        connection.execute(sa.text("INSERT INTO unrelated_state (id) VALUES (1)"))
    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    _run_migration_step(module, engine, "downgrade")

    inspector = sa.inspect(engine)
    assert inspector.get_table_names() == ["unrelated_state"]
    with engine.begin() as connection:
        assert connection.scalar(sa.text("SELECT id FROM unrelated_state")) == 1
