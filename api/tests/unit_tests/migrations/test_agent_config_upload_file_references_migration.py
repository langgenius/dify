from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Literal, Protocol, cast

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_10_20_1800-d7f1a5b8c240_add_agent_config_upload_file_references.py"
)


class _MigrationModule(Protocol):
    op: object

    def upgrade(self) -> None: ...

    def downgrade(self) -> None: ...


def _load_migration() -> _MigrationModule:
    spec = importlib.util.spec_from_file_location("agent_config_upload_file_references", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load Agent config upload-file migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return cast(_MigrationModule, module)


def _run_step(module: _MigrationModule, engine: sa.Engine, step: Literal["upgrade", "downgrade"]) -> None:
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        original_op = module.op
        module.op = operations
        try:
            module.upgrade() if step == "upgrade" else module.downgrade()
        finally:
            module.op = original_op


def _soul(file_id: str, *, file_kind: str = "upload_file", is_missing: bool = False) -> str:
    return json.dumps(
        {
            "config_files": [
                {
                    "name": "guide.txt",
                    "file_kind": file_kind,
                    "file_id": file_id,
                    "is_missing": is_missing,
                }
            ]
        }
    )


def test_upgrade_adds_reference_schema_without_activating_legacy_rows() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
    metadata = sa.MetaData()
    uploads = sa.Table(
        "upload_files",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
    )
    drafts = sa.Table(
        "agent_config_drafts",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("config_snapshot", sa.Text(), nullable=False),
    )
    snapshots = sa.Table(
        "agent_config_snapshots",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column("config_snapshot", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            uploads.insert(),
            [
                {"id": "shared-file", "tenant_id": "tenant-1"},
                {"id": "snapshot-file", "tenant_id": "tenant-1"},
                {"id": "foreign-file", "tenant_id": "tenant-2"},
            ],
        )
        connection.execute(
            drafts.insert(),
            [
                *(
                    {
                        "id": f"draft-{index:04}",
                        "tenant_id": "tenant-1",
                        "config_snapshot": _soul("shared-file"),
                    }
                    for index in range(501)
                ),
                {"id": "draft-foreign", "tenant_id": "tenant-1", "config_snapshot": _soul("foreign-file")},
                {
                    "id": "draft-tool-file",
                    "tenant_id": "tenant-1",
                    "config_snapshot": _soul("shared-file", file_kind="tool_file"),
                },
                {
                    "id": "draft-missing",
                    "tenant_id": "tenant-1",
                    "config_snapshot": _soul("shared-file", is_missing=True),
                },
            ],
        )
        connection.execute(
            snapshots.insert(),
            [{"id": "snapshot-1", "tenant_id": "tenant-1", "config_snapshot": _soul("snapshot-file")}],
        )

    module = _load_migration()
    _run_step(module, engine, "upgrade")

    references = sa.Table("agent_config_upload_file_references", sa.MetaData(), autoload_with=engine)
    with engine.connect() as connection:
        rows = connection.execute(
            sa.select(
                references.c.owner_kind,
                references.c.owner_id,
                references.c.upload_file_id,
            ).order_by(references.c.owner_kind, references.c.owner_id)
        ).all()
    assert rows == []

    with engine.begin() as connection:
        connection.execute(uploads.delete())
        assert connection.scalar(sa.select(sa.func.count()).select_from(uploads)) == 0

    _run_step(module, engine, "downgrade")
    assert "agent_config_upload_file_references" not in sa.inspect(engine).get_table_names()
