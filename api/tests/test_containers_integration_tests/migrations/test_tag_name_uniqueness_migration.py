"""MySQL collation coverage for the pending tag-identity migration."""

from __future__ import annotations

import importlib.util
from collections.abc import Generator
from datetime import datetime
from pathlib import Path
from types import ModuleType
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_19_1300-e2a8b0d3f715_enforce_tag_name_uniqueness.py"
)


def _load_migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("enforce_tag_name_uniqueness_mysql", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load tag uniqueness migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def mysql_engine() -> Generator[Engine]:
    testcontainers_mysql = pytest.importorskip("testcontainers.mysql")
    container = testcontainers_mysql.MySqlContainer("mysql:8.0")
    container.start()
    engine = sa.create_engine(container.get_connection_url().replace("mysql://", "mysql+pymysql://", 1))
    try:
        yield engine
    finally:
        engine.dispose()
        container.stop()


def _create_legacy_schema(engine: Engine) -> tuple[sa.Table, sa.Table]:
    metadata = sa.MetaData()
    tags = sa.Table(
        "tags",
        metadata,
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column("tenant_id", sa.CHAR(36)),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("created_by", sa.CHAR(36), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    bindings = sa.Table(
        "tag_bindings",
        metadata,
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column("tenant_id", sa.CHAR(36)),
        sa.Column("tag_id", sa.CHAR(36)),
        sa.Column("target_id", sa.CHAR(36)),
        sa.Column("created_by", sa.CHAR(36), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    metadata.create_all(engine)
    return tags, bindings


def _run_upgrade(module: ModuleType, engine: Engine) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.__dict__["op"]
        module.__dict__["op"] = operations
        try:
            module.upgrade()
        finally:
            module.__dict__["op"] = original_op


def test_upgrade_aligns_mysql_collation_with_domain_identity(mysql_engine: Engine) -> None:
    tags, _ = _create_legacy_schema(mysql_engine)
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    created_at = datetime(2026, 1, 1)
    rows = [
        ("knowledge-upper", "knowledge", "Shared"),
        ("knowledge-lower", "knowledge", "shared"),
        ("knowledge-spaced", "knowledge", "Shared "),
        ("skill-upper", "skill", "Shared"),
        ("skill-lower", "skill", "shared"),
        ("skill-accented", "skill", "R\N{LATIN SMALL LETTER E WITH ACUTE}sum\N{LATIN SMALL LETTER E WITH ACUTE}"),
        ("skill-unaccented", "skill", "Resume"),
        ("skill-composed", "skill", "Caf\N{LATIN SMALL LETTER E WITH ACUTE}"),
        ("skill-decomposed", "skill", "Cafe\N{COMBINING ACUTE ACCENT}"),
    ]
    with mysql_engine.begin() as connection:
        connection.execute(
            tags.insert(),
            [
                {
                    "id": tag_id,
                    "tenant_id": tenant_id,
                    "type": tag_type,
                    "name": name,
                    "created_by": actor_id,
                    "created_at": created_at,
                }
                for tag_id, tag_type, name in rows
            ],
        )

    module = _load_migration_module()
    _run_upgrade(module, mysql_engine)

    migrated_tags = sa.Table("tags", sa.MetaData(), autoload_with=mysql_engine)
    with mysql_engine.connect() as connection:
        persisted = connection.execute(
            sa.select(migrated_tags.c.id, migrated_tags.c.normalized_name).order_by(migrated_tags.c.id)
        ).all()
        collations = {
            str(column_name): collation_name
            for column_name, collation_name in connection.execute(
                sa.text(
                    "SELECT column_name, collation_name FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() AND table_name = 'tags' "
                    "AND column_name IN ('name', 'normalized_name')"
                )
            ).all()
        }

    assert persisted == [
        ("knowledge-lower", None),
        ("knowledge-spaced", None),
        ("knowledge-upper", None),
        ("skill-accented", "r\N{LATIN SMALL LETTER E WITH ACUTE}sum\N{LATIN SMALL LETTER E WITH ACUTE}"),
        ("skill-composed", "caf\N{LATIN SMALL LETTER E WITH ACUTE}"),
        ("skill-lower", "shared"),
        ("skill-unaccented", "resume"),
    ]
    assert collations == {"name": "utf8mb4_0900_bin", "normalized_name": "utf8mb4_0900_bin"}

    with pytest.raises(IntegrityError):
        with mysql_engine.begin() as connection:
            connection.execute(
                migrated_tags.insert(),
                {
                    "id": "skill-case-duplicate",
                    "tenant_id": tenant_id,
                    "type": "skill",
                    "name": "SHARED",
                    "normalized_name": "shared",
                    "created_by": actor_id,
                    "created_at": created_at,
                },
            )
