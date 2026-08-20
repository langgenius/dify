"""add knowledge graph index

Adds the storage backing native GraphRAG for built-in knowledge bases:
entities, relations, and the chunk provenance links that keep graph hits
citable back to ``document_segments``.

Revision ID: c7a41f0b9d52
Revises: 89919253ca7a
Create Date: 2026-08-19 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "c7a41f0b9d52"
down_revision = "89919253ca7a"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dataset_graph_entities",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("dataset_id", models.types.StringUUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("description", models.types.LongText(), nullable=True),
        sa.Column("frequency", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dataset_graph_entity_pkey"),
        sa.UniqueConstraint("dataset_id", "name", name="dataset_graph_entity_dataset_name_uniq"),
    )
    with op.batch_alter_table("dataset_graph_entities", schema=None) as batch_op:
        batch_op.create_index("dataset_graph_entity_tenant_idx", ["tenant_id"], unique=False)
        batch_op.create_index("dataset_graph_entity_dataset_idx", ["dataset_id"], unique=False)
        batch_op.create_index("dataset_graph_entity_dataset_type_idx", ["dataset_id", "entity_type"], unique=False)

    op.create_table(
        "dataset_graph_relations",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("dataset_id", models.types.StringUUID(), nullable=False),
        sa.Column("source_entity_id", models.types.StringUUID(), nullable=False),
        sa.Column("target_entity_id", models.types.StringUUID(), nullable=False),
        sa.Column("predicate", sa.String(length=255), nullable=False),
        sa.Column("description", models.types.LongText(), nullable=True),
        sa.Column("weight", sa.Float(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dataset_graph_relation_pkey"),
        sa.UniqueConstraint(
            "dataset_id",
            "source_entity_id",
            "target_entity_id",
            "predicate",
            name="dataset_graph_relation_edge_uniq",
        ),
    )
    with op.batch_alter_table("dataset_graph_relations", schema=None) as batch_op:
        batch_op.create_index("dataset_graph_relation_tenant_idx", ["tenant_id"], unique=False)
        batch_op.create_index("dataset_graph_relation_source_idx", ["dataset_id", "source_entity_id"], unique=False)
        batch_op.create_index("dataset_graph_relation_target_idx", ["dataset_id", "target_entity_id"], unique=False)

    op.create_table(
        "dataset_graph_chunk_links",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("dataset_id", models.types.StringUUID(), nullable=False),
        sa.Column("document_id", models.types.StringUUID(), nullable=False),
        sa.Column("index_node_id", sa.String(length=255), nullable=False),
        sa.Column("entity_id", models.types.StringUUID(), nullable=True),
        sa.Column("relation_id", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dataset_graph_chunk_link_pkey"),
    )
    with op.batch_alter_table("dataset_graph_chunk_links", schema=None) as batch_op:
        batch_op.create_index("dataset_graph_chunk_link_document_idx", ["dataset_id", "document_id"], unique=False)
        batch_op.create_index("dataset_graph_chunk_link_node_idx", ["dataset_id", "index_node_id"], unique=False)
        batch_op.create_index("dataset_graph_chunk_link_entity_idx", ["dataset_id", "entity_id"], unique=False)
        batch_op.create_index("dataset_graph_chunk_link_relation_idx", ["dataset_id", "relation_id"], unique=False)

    with op.batch_alter_table("datasets", schema=None) as batch_op:
        batch_op.add_column(sa.Column("graph_index_setting", models.types.AdjustedJSON(), nullable=True))


def downgrade():
    with op.batch_alter_table("datasets", schema=None) as batch_op:
        batch_op.drop_column("graph_index_setting")

    with op.batch_alter_table("dataset_graph_chunk_links", schema=None) as batch_op:
        batch_op.drop_index("dataset_graph_chunk_link_relation_idx")
        batch_op.drop_index("dataset_graph_chunk_link_entity_idx")
        batch_op.drop_index("dataset_graph_chunk_link_node_idx")
        batch_op.drop_index("dataset_graph_chunk_link_document_idx")
    op.drop_table("dataset_graph_chunk_links")

    with op.batch_alter_table("dataset_graph_relations", schema=None) as batch_op:
        batch_op.drop_index("dataset_graph_relation_target_idx")
        batch_op.drop_index("dataset_graph_relation_source_idx")
        batch_op.drop_index("dataset_graph_relation_tenant_idx")
    op.drop_table("dataset_graph_relations")

    with op.batch_alter_table("dataset_graph_entities", schema=None) as batch_op:
        batch_op.drop_index("dataset_graph_entity_dataset_type_idx")
        batch_op.drop_index("dataset_graph_entity_dataset_idx")
        batch_op.drop_index("dataset_graph_entity_tenant_idx")
    op.drop_table("dataset_graph_entities")
