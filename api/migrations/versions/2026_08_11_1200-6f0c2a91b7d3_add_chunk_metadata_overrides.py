"""add chunk metadata overrides

Revision ID: 6f0c2a91b7d3
Revises: e4708db55c1d
Create Date: 2026-08-11 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

revision = "6f0c2a91b7d3"
down_revision = "e4708db55c1d"
branch_labels = None
depends_on = None


def _is_postgresql() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    op.create_table(
        "segment_metadata_bindings",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("dataset_id", models.types.StringUUID(), nullable=False),
        sa.Column("document_id", models.types.StringUUID(), nullable=False),
        sa.Column("segment_id", models.types.StringUUID(), nullable=False),
        sa.Column("metadata_id", models.types.StringUUID(), nullable=False),
        sa.Column("value_json", models.types.AdjustedJSON(), nullable=False),
        sa.Column("created_by", models.types.StringUUID(), nullable=False),
        sa.Column("updated_by", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"], ["documents.id"], name="segment_metadata_binding_document_fkey", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["segment_id"],
            ["document_segments.id"],
            name="segment_metadata_binding_segment_fkey",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["metadata_id"],
            ["dataset_metadatas.id"],
            name="segment_metadata_binding_metadata_fkey",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="segment_metadata_binding_pkey"),
    )
    op.create_index("segment_metadata_binding_tenant_idx", "segment_metadata_bindings", ["tenant_id"])
    op.create_index("segment_metadata_binding_dataset_idx", "segment_metadata_bindings", ["dataset_id"])
    op.create_index("segment_metadata_binding_document_idx", "segment_metadata_bindings", ["document_id"])
    op.create_index("segment_metadata_binding_metadata_idx", "segment_metadata_bindings", ["metadata_id"])
    op.create_index(
        "segment_metadata_binding_segment_metadata_idx",
        "segment_metadata_bindings",
        ["segment_id", "metadata_id"],
        unique=True,
    )

    op.add_column("document_segments", sa.Column("effective_metadata", models.types.AdjustedJSON(), nullable=True))
    op.add_column(
        "document_segments",
        sa.Column("metadata_override_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column("document_segments", sa.Column("effective_security_level", sa.String(length=255), nullable=True))
    op.add_column(
        "documents",
        sa.Column("has_segment_metadata_override", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "documents",
        sa.Column("segment_metadata_override_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )

    if _is_postgresql():
        op.execute(
            """
            UPDATE document_segments AS ds
            SET effective_metadata = COALESCE(d.doc_metadata::jsonb, '{}'::jsonb),
                effective_security_level = d.doc_metadata->>'security_level'
            FROM documents AS d
            WHERE ds.document_id = d.id
            """
        )
        metadata_default = sa.text("'{}'::jsonb")
    else:
        op.execute(
            """
            UPDATE document_segments AS ds
            JOIN documents AS d ON ds.document_id = d.id
            SET ds.effective_metadata = COALESCE(d.doc_metadata, JSON_OBJECT()),
                ds.effective_security_level = JSON_UNQUOTE(JSON_EXTRACT(d.doc_metadata, '$.security_level'))
            """
        )
        metadata_default = sa.text("(JSON_OBJECT())")

    with op.batch_alter_table("document_segments") as batch_op:
        batch_op.alter_column(
            "effective_metadata",
            existing_type=models.types.AdjustedJSON(),
            nullable=False,
            server_default=metadata_default,
        )
        batch_op.create_index("document_segment_document_position_idx", ["document_id", "position"])
        batch_op.create_index("document_segment_dataset_security_level_idx", ["dataset_id", "effective_security_level"])

    if _is_postgresql():
        op.create_index(
            "document_segment_effective_metadata_idx",
            "document_segments",
            ["effective_metadata"],
            postgresql_using="gin",
        )

    op.create_index("document_dataset_override_flag_idx", "documents", ["dataset_id", "has_segment_metadata_override"])


def downgrade() -> None:
    op.drop_index("document_dataset_override_flag_idx", table_name="documents")
    if _is_postgresql():
        op.drop_index("document_segment_effective_metadata_idx", table_name="document_segments")
    with op.batch_alter_table("document_segments") as batch_op:
        batch_op.drop_index("document_segment_dataset_security_level_idx")
        batch_op.drop_index("document_segment_document_position_idx")
    op.drop_column("documents", "segment_metadata_override_count")
    op.drop_column("documents", "has_segment_metadata_override")
    op.drop_column("document_segments", "effective_security_level")
    op.drop_column("document_segments", "metadata_override_count")
    op.drop_column("document_segments", "effective_metadata")
    op.drop_table("segment_metadata_bindings")
