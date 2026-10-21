"""bind pipeline execution logs to document generations

Revision ID: b1d5e9fac684
Revises: a0c4d8ebf573
Create Date: 2026-10-21 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "b1d5e9fac684"
down_revision = "a0c4d8ebf573"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("document_pipeline_execution_logs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("indexing_generation", models.types.StringUUID(), nullable=True))

    logs = sa.table(
        "document_pipeline_execution_logs",
        sa.column("id", models.types.StringUUID()),
        sa.column("document_id", models.types.StringUUID()),
        sa.column("indexing_generation", models.types.StringUUID()),
        sa.column("created_at", sa.DateTime()),
    )
    documents = sa.table(
        "documents",
        sa.column("id", models.types.StringUUID()),
        sa.column("indexing_generation", models.types.StringUUID()),
    )
    backfill = op.create_table(
        "tmp_pipeline_execution_log_generation_backfill",
        sa.Column("execution_log_id", models.types.StringUUID(), nullable=False),
        sa.Column("indexing_generation", models.types.StringUUID(), nullable=False),
        sa.PrimaryKeyConstraint("execution_log_id"),
    )
    ranked = (
        sa.select(
            logs.c.id.label("execution_log_id"),
            documents.c.indexing_generation,
            sa.func.row_number()
            .over(
                partition_by=logs.c.document_id,
                order_by=(logs.c.created_at.desc(), logs.c.id.desc()),
            )
            .label("row_number"),
        )
        .join(documents, documents.c.id == logs.c.document_id)
        .where(documents.c.indexing_generation.is_not(None))
        .subquery()
    )
    connection = op.get_bind()
    connection.execute(
        backfill.insert().from_select(
            ["execution_log_id", "indexing_generation"],
            sa.select(ranked.c.execution_log_id, ranked.c.indexing_generation).where(ranked.c.row_number == 1),
        )
    )
    selected_generation = (
        sa.select(backfill.c.indexing_generation).where(backfill.c.execution_log_id == logs.c.id).scalar_subquery()
    )
    connection.execute(
        logs.update()
        .where(
            logs.c.indexing_generation.is_(None),
            sa.exists(sa.select(backfill.c.execution_log_id).where(backfill.c.execution_log_id == logs.c.id)),
        )
        .values(indexing_generation=selected_generation)
    )
    op.drop_table("tmp_pipeline_execution_log_generation_backfill")

    op.create_index(
        "document_pipeline_execution_logs_document_generation_idx",
        "document_pipeline_execution_logs",
        ["document_id", "indexing_generation"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "document_pipeline_execution_logs_document_generation_idx",
        table_name="document_pipeline_execution_logs",
    )
    with op.batch_alter_table("document_pipeline_execution_logs", schema=None) as batch_op:
        batch_op.drop_column("indexing_generation")
