from __future__ import annotations

import importlib.util
from datetime import datetime
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import IntegrityError

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_19_1300-e2a8b0d3f715_enforce_tag_name_uniqueness.py"
)


def _load_migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("enforce_tag_name_uniqueness", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load tag uniqueness migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_migration_step(module: ModuleType, engine: sa.Engine, step_name: str) -> None:
    migration_step = module.__dict__[step_name]
    if not callable(migration_step):
        raise TypeError(f"migration step {step_name!r} is not callable")

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.__dict__["op"]
        module.__dict__["op"] = operations
        try:
            migration_step()
        finally:
            module.__dict__["op"] = original_op


def _create_legacy_schema(engine: sa.Engine) -> tuple[sa.Table, sa.Table]:
    metadata = sa.MetaData()
    tags = sa.Table(
        "tags",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36)),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    bindings = sa.Table(
        "tag_bindings",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36)),
        sa.Column("tag_id", sa.String(36)),
        sa.Column("target_id", sa.String(36)),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    metadata.create_all(engine)
    return tags, bindings


def test_mysql_identity_type_uses_binary_collation() -> None:
    module = _load_migration_module()

    assert module._tag_identity_type().dialect_impl(mysql.dialect()).collation == "utf8mb4_0900_bin"


def test_upgrade_merges_duplicate_tags_and_preserves_distinct_binding_scope() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    tags, bindings = _create_legacy_schema(engine)
    first_created_at = datetime(2026, 1, 1)
    second_created_at = datetime(2026, 1, 2)

    with engine.begin() as connection:
        connection.execute(
            tags.insert(),
            [
                {
                    "id": "tag-canonical",
                    "tenant_id": "tenant-1",
                    "type": "knowledge",
                    "name": "Shared",
                    "created_by": "account-1",
                    "created_at": first_created_at,
                },
                {
                    "id": "tag-duplicate",
                    "tenant_id": "tenant-1",
                    "type": "knowledge",
                    "name": "Shared",
                    "created_by": "account-2",
                    "created_at": second_created_at,
                },
                {
                    "id": "tag-other-tenant",
                    "tenant_id": "tenant-2",
                    "type": "knowledge",
                    "name": "Shared",
                    "created_by": "account-3",
                    "created_at": first_created_at,
                },
                {
                    "id": "tag-other-type",
                    "tenant_id": "tenant-1",
                    "type": "app",
                    "name": "Shared",
                    "created_by": "account-1",
                    "created_at": first_created_at,
                },
                {
                    "id": "tag-space-distinct",
                    "tenant_id": "tenant-1",
                    "type": "knowledge",
                    "name": "Shared ",
                    "created_by": "account-1",
                    "created_at": first_created_at,
                },
                {
                    "id": "tag-skill-canonical",
                    "tenant_id": "tenant-1",
                    "type": "skill",
                    "name": "Shared",
                    "created_by": "account-1",
                    "created_at": first_created_at,
                },
                {
                    "id": "tag-skill-duplicate",
                    "tenant_id": "tenant-1",
                    "type": "skill",
                    "name": "shared",
                    "created_by": "account-2",
                    "created_at": second_created_at,
                },
                {
                    "id": "tag-skill-accented",
                    "tenant_id": "tenant-1",
                    "type": "skill",
                    "name": "R\N{LATIN SMALL LETTER E WITH ACUTE}sum\N{LATIN SMALL LETTER E WITH ACUTE}",
                    "created_by": "account-1",
                    "created_at": first_created_at,
                },
                {
                    "id": "tag-skill-unaccented",
                    "tenant_id": "tenant-1",
                    "type": "skill",
                    "name": "Resume",
                    "created_by": "account-1",
                    "created_at": first_created_at,
                },
                {
                    "id": "tag-skill-composed",
                    "tenant_id": "tenant-1",
                    "type": "skill",
                    "name": "Caf\N{LATIN SMALL LETTER E WITH ACUTE}",
                    "created_by": "account-1",
                    "created_at": first_created_at,
                },
                {
                    "id": "tag-skill-decomposed",
                    "tenant_id": "tenant-1",
                    "type": "skill",
                    "name": "Cafe\N{COMBINING ACUTE ACCENT}",
                    "created_by": "account-2",
                    "created_at": second_created_at,
                },
                {
                    "id": "tag-unowned-1",
                    "tenant_id": None,
                    "type": "knowledge",
                    "name": "Unowned",
                    "created_by": "account-1",
                    "created_at": first_created_at,
                },
                {
                    "id": "tag-unowned-2",
                    "tenant_id": None,
                    "type": "knowledge",
                    "name": "Unowned",
                    "created_by": "account-1",
                    "created_at": second_created_at,
                },
            ],
        )
        connection.execute(
            bindings.insert(),
            [
                {
                    "id": "binding-canonical",
                    "tenant_id": "tenant-1",
                    "tag_id": "tag-canonical",
                    "target_id": "target-1",
                    "created_by": "account-1",
                    "created_at": first_created_at,
                },
                {
                    "id": "binding-redundant",
                    "tenant_id": "tenant-1",
                    "tag_id": "tag-duplicate",
                    "target_id": "target-1",
                    "created_by": "account-2",
                    "created_at": second_created_at,
                },
                {
                    "id": "binding-canonical-duplicate",
                    "tenant_id": "tenant-1",
                    "tag_id": "tag-canonical",
                    "target_id": "target-1",
                    "created_by": "account-2",
                    "created_at": second_created_at,
                },
                {
                    "id": "binding-distinct",
                    "tenant_id": "tenant-1",
                    "tag_id": "tag-duplicate",
                    "target_id": "target-2",
                    "created_by": "account-2",
                    "created_at": second_created_at,
                },
                {
                    "id": "binding-legacy-foreign-scope",
                    "tenant_id": "tenant-2",
                    "tag_id": "tag-duplicate",
                    "target_id": "target-3",
                    "created_by": "account-3",
                    "created_at": second_created_at,
                },
                {
                    "id": "binding-skill-duplicate",
                    "tenant_id": "tenant-1",
                    "tag_id": "tag-skill-duplicate",
                    "target_id": "skill-1",
                    "created_by": "account-2",
                    "created_at": second_created_at,
                },
            ],
        )

    module = _load_migration_module()
    _run_migration_step(module, engine, "upgrade")

    assert {constraint["name"] for constraint in sa.inspect(engine).get_unique_constraints("tags")} == {
        "tag_tenant_type_name_unique",
        "tag_tenant_type_normalized_name_unique",
    }
    assert {constraint["name"] for constraint in sa.inspect(engine).get_unique_constraints("tag_bindings")} == {
        "tag_binding_tenant_tag_target_unique"
    }
    assert {constraint["name"] for constraint in sa.inspect(engine).get_check_constraints("tags")} == {
        "tag_skill_normalized_name_check"
    }
    with engine.connect() as connection:
        remaining_tags = connection.execute(sa.select(tags.c.id).order_by(tags.c.id)).scalars().all()
        remaining_bindings = connection.execute(
            sa.select(bindings.c.id, bindings.c.tenant_id, bindings.c.tag_id, bindings.c.target_id).order_by(
                bindings.c.id
            )
        ).all()

    assert remaining_tags == [
        "tag-canonical",
        "tag-other-tenant",
        "tag-other-type",
        "tag-skill-accented",
        "tag-skill-canonical",
        "tag-skill-composed",
        "tag-skill-unaccented",
        "tag-space-distinct",
        "tag-unowned-1",
        "tag-unowned-2",
    ]
    assert remaining_bindings == [
        ("binding-canonical", "tenant-1", "tag-canonical", "target-1"),
        ("binding-distinct", "tenant-1", "tag-canonical", "target-2"),
        ("binding-legacy-foreign-scope", "tenant-2", "tag-canonical", "target-3"),
        ("binding-skill-duplicate", "tenant-1", "tag-skill-canonical", "skill-1"),
    ]

    migrated_tags = sa.Table("tags", sa.MetaData(), autoload_with=engine)
    with engine.connect() as connection:
        normalized_names = {
            str(tag_id): normalized_name
            for tag_id, normalized_name in connection.execute(
                sa.select(migrated_tags.c.id, migrated_tags.c.normalized_name).where(migrated_tags.c.type == "skill")
            ).all()
        }
        assert normalized_names == {
            "tag-skill-accented": "r\N{LATIN SMALL LETTER E WITH ACUTE}sum\N{LATIN SMALL LETTER E WITH ACUTE}",
            "tag-skill-canonical": "shared",
            "tag-skill-composed": "caf\N{LATIN SMALL LETTER E WITH ACUTE}",
            "tag-skill-unaccented": "resume",
        }

    assert (
        module._normalize_tag_name("skill", "Cafe\N{COMBINING ACUTE ACCENT}")
        == "caf\N{LATIN SMALL LETTER E WITH ACUTE}"
    )
    assert module._normalize_tag_name("skill", "Resume") != module._normalize_tag_name(
        "skill", "R\N{LATIN SMALL LETTER E WITH ACUTE}sum\N{LATIN SMALL LETTER E WITH ACUTE}"
    )

    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                tags.insert().values(
                    id="tag-new-duplicate",
                    tenant_id="tenant-1",
                    type="knowledge",
                    name="Shared",
                    created_by="account-4",
                    created_at=second_created_at,
                )
            )
    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                migrated_tags.insert().values(
                    id="tag-new-skill-casefold-duplicate",
                    tenant_id="tenant-1",
                    type="skill",
                    name="SHARED",
                    normalized_name="shared",
                    created_by="account-4",
                    created_at=second_created_at,
                )
            )
    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                bindings.insert().values(
                    id="binding-new-duplicate",
                    tenant_id="tenant-1",
                    tag_id="tag-canonical",
                    target_id="target-1",
                    created_by="account-4",
                    created_at=second_created_at,
                )
            )

    _run_migration_step(module, engine, "downgrade")
    assert sa.inspect(engine).get_unique_constraints("tags") == []
    assert sa.inspect(engine).get_unique_constraints("tag_bindings") == []
    assert sa.inspect(engine).get_check_constraints("tags") == []
    assert "normalized_name" not in {column["name"] for column in sa.inspect(engine).get_columns("tags")}
    with engine.begin() as connection:
        connection.execute(
            tags.insert().values(
                id="tag-after-downgrade",
                tenant_id="tenant-1",
                type="knowledge",
                name="Shared",
                created_by="account-4",
                created_at=second_created_at,
            )
        )
        connection.execute(
            bindings.insert().values(
                id="binding-after-downgrade",
                tenant_id="tenant-1",
                tag_id="tag-canonical",
                target_id="target-1",
                created_by="account-4",
                created_at=second_created_at,
            )
        )
