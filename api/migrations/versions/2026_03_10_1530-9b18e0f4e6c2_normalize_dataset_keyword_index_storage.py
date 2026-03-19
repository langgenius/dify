"""normalize dataset keyword index storage

Revision ID: 9b18e0f4e6c2
Revises: 2a3aebbbf4bb, b69ca54b9208, e288952f2994
Create Date: 2026-03-10 15:30:00.000000

"""

import json
from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
import models as models
from alembic import context, op

# revision identifiers, used by Alembic.
revision = "9b18e0f4e6c2"
down_revision = ("2a3aebbbf4bb", "b69ca54b9208", "e288952f2994")
branch_labels = None
depends_on = None

LEGACY_STORAGE_VERSION = 1
NORMALIZED_STORAGE_VERSION = 2
ENTRY_BATCH_SIZE = 1000


def _chunked(items: list[dict[str, str]], size: int):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def _build_entry_rows(dataset_id: str, keyword_table_text: str) -> list[dict[str, str]]:
    if not keyword_table_text:
        return []

    try:
        keyword_table_dict = json.loads(keyword_table_text)
    except json.JSONDecodeError:
        return []

    keyword_table = keyword_table_dict.get("__data__", {}).get("table", {})
    if not isinstance(keyword_table, dict):
        return []

    rows: list[dict[str, str]] = []
    for keyword, segment_ids in keyword_table.items():
        if not isinstance(keyword, str) or not isinstance(segment_ids, list):
            continue
        for segment_id in segment_ids:
            rows.append(
                {
                    "id": str(uuid4()),
                    "dataset_id": dataset_id,
                    "keyword": keyword,
                    "segment_id": str(segment_id),
                }
            )

    return rows


def upgrade():
    op.create_table(
        "dataset_keyword_entries",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("dataset_id", models.types.StringUUID(), nullable=False),
        sa.Column("keyword", sa.String(length=255), nullable=False),
        sa.Column("segment_id", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dataset_keyword_entry_pkey"),
        sa.UniqueConstraint("dataset_id", "keyword", "segment_id", name="dataset_keyword_entry_unique_idx"),
    )
    with op.batch_alter_table("dataset_keyword_entries", schema=None) as batch_op:
        batch_op.create_index("dataset_keyword_entry_dataset_keyword_idx", ["dataset_id", "keyword"], unique=False)
        batch_op.create_index("dataset_keyword_entry_dataset_segment_idx", ["dataset_id", "segment_id"], unique=False)

    with op.batch_alter_table("dataset_keyword_tables", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("storage_version", sa.SmallInteger(), server_default=sa.text("1"), nullable=False)
        )
        batch_op.add_column(sa.Column("migrated_at", sa.DateTime(), nullable=True))

    if context.is_offline_mode():
        return

    conn = op.get_bind()
    if conn is None:
        return

    metadata = sa.MetaData()
    dataset_keyword_tables = sa.Table(
        "dataset_keyword_tables",
        metadata,
        sa.Column("id", models.types.StringUUID()),
        sa.Column("dataset_id", models.types.StringUUID()),
        sa.Column("keyword_table", sa.Text()),
        sa.Column("data_source_type", sa.String(length=255)),
        sa.Column("storage_version", sa.SmallInteger()),
        sa.Column("migrated_at", sa.DateTime()),
    )
    dataset_keyword_entries = sa.Table(
        "dataset_keyword_entries",
        metadata,
        sa.Column("id", models.types.StringUUID()),
        sa.Column("dataset_id", models.types.StringUUID()),
        sa.Column("keyword", sa.String(length=255)),
        sa.Column("segment_id", sa.String(length=255)),
    )

    dataset_keyword_table_rows = conn.execute(
        sa.select(
            dataset_keyword_tables.c.id,
            dataset_keyword_tables.c.dataset_id,
            dataset_keyword_tables.c.keyword_table,
            dataset_keyword_tables.c.data_source_type,
        )
    ).mappings()

    for row in dataset_keyword_table_rows:
        storage_version = LEGACY_STORAGE_VERSION
        migrated_at = None

        if row["data_source_type"] == "database":
            entry_rows = _build_entry_rows(row["dataset_id"], row["keyword_table"] or "")
            for chunk in _chunked(entry_rows, ENTRY_BATCH_SIZE):
                conn.execute(dataset_keyword_entries.insert(), chunk)
            storage_version = NORMALIZED_STORAGE_VERSION
            migrated_at = datetime.utcnow()

        conn.execute(
            dataset_keyword_tables.update()
            .where(dataset_keyword_tables.c.id == row["id"])
            .values(storage_version=storage_version, migrated_at=migrated_at)
        )


def downgrade():
    with op.batch_alter_table("dataset_keyword_tables", schema=None) as batch_op:
        batch_op.drop_column("migrated_at")
        batch_op.drop_column("storage_version")

    with op.batch_alter_table("dataset_keyword_entries", schema=None) as batch_op:
        batch_op.drop_index("dataset_keyword_entry_dataset_segment_idx")
        batch_op.drop_index("dataset_keyword_entry_dataset_keyword_idx")

    op.drop_table("dataset_keyword_entries")
