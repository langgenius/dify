"""add resource_type to dataset_api_token_bindings

Revision ID: 9a4e7d1c2b60
Revises: f1d3c5b7a902, c4d8e2f7a1b6
Create Date: 2026-09-03 10:00:00.000000

Legacy knowledge bases (``datasets``) and KnowledgeFS spaces (``knowledge_fs_control_spaces``)
live in different tables, so a dataset API key binding now records which kind of
knowledge base it points at:

    resource_type = 'dataset'            → dataset_id is set
    resource_type = 'knowledge_fs_space' → control_space_id is set

Existing rows are all legacy dataset bindings and keep working unchanged.
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

# revision identifiers, used by Alembic.
revision = "9a4e7d1c2b60"
# Also merges the KnowledgeFS chain: the foreign key below needs knowledge_fs_control_spaces,
# and main's fbdfcf5f5a6e keeps its original parent so upgrades from main still apply the chain.
down_revision = ("f1d3c5b7a902", "c4d8e2f7a1b6")
branch_labels = None
depends_on = None

_RESOURCE_CHECK = (
    "(resource_type = 'dataset' AND dataset_id IS NOT NULL AND control_space_id IS NULL)"
    " OR (resource_type = 'knowledge_fs_space' AND control_space_id IS NOT NULL AND dataset_id IS NULL)"
)


def upgrade():
    with op.batch_alter_table("dataset_api_token_bindings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("resource_type", sa.String(length=32), server_default="dataset", nullable=False))
        batch_op.add_column(sa.Column("control_space_id", StringUUID(), nullable=True))
        batch_op.alter_column("dataset_id", existing_type=StringUUID(), nullable=True)
        batch_op.create_foreign_key(
            "dataset_api_token_binding_space_fkey",
            "knowledge_fs_control_spaces",
            ["control_space_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_unique_constraint(
            "dataset_api_token_binding_space_unique", ["api_token_id", "control_space_id"]
        )
        batch_op.create_check_constraint("dataset_api_token_binding_resource_ck", _RESOURCE_CHECK)
        batch_op.create_index("dataset_api_token_binding_space_idx", ["control_space_id"], unique=False)


_KNOWLEDGE_FS_ONLY_KEYS_SQL = (
    "SELECT COUNT(DISTINCT api_token_id) FROM dataset_api_token_bindings AS space_binding"
    " WHERE space_binding.resource_type = 'knowledge_fs_space'"
    " AND NOT EXISTS ("
    "SELECT 1 FROM dataset_api_token_bindings AS dataset_binding"
    " WHERE dataset_binding.api_token_id = space_binding.api_token_id"
    " AND dataset_binding.resource_type = 'dataset')"
)
_KNOWLEDGE_FS_ONLY_KEYS_MESSAGE = (
    "dataset API key(s) are bound only to KnowledgeFS spaces and would gain access to every dataset "
    "in their tenant after this downgrade. Revoke them before downgrading."
)


def _assert_no_knowledge_fs_only_keys() -> None:
    if not op.get_context().as_sql:
        count = op.get_bind().execute(sa.text(_KNOWLEDGE_FS_ONLY_KEYS_SQL)).scalar_one()
        if count:
            raise RuntimeError(f"{count} {_KNOWLEDGE_FS_ONLY_KEYS_MESSAGE}")
        return
    # Offline scripts cannot inspect rows, so the generated SQL carries the check itself.
    if op.get_context().dialect.name == "postgresql":
        op.execute(
            # No RAISE placeholder: offline rendering doubles "%", which would break the format.
            "DO $$ DECLARE knowledge_fs_only_keys bigint; BEGIN "
            f"{_KNOWLEDGE_FS_ONLY_KEYS_SQL} "
            "INTO knowledge_fs_only_keys; "
            "IF knowledge_fs_only_keys > 0 THEN "
            f"RAISE EXCEPTION 'Some {_KNOWLEDGE_FS_ONLY_KEYS_MESSAGE}'; "
            "END IF; END $$"
        )
    else:
        op.execute(f"-- Before running this downgrade, confirm no {_KNOWLEDGE_FS_ONLY_KEYS_MESSAGE}")


def downgrade():
    # The previous schema treats a key with no bindings as tenant-wide. Dropping the space
    # bindings of a key bound only to KnowledgeFS spaces would widen it to every legacy
    # dataset, so those keys must be revoked through the API (which also clears the token
    # cache) before downgrading.
    _assert_no_knowledge_fs_only_keys()
    # Keys that also bind legacy datasets keep those bindings and only lose their space scope.
    op.execute(sa.text("DELETE FROM dataset_api_token_bindings WHERE resource_type <> 'dataset'"))
    with op.batch_alter_table("dataset_api_token_bindings", schema=None) as batch_op:
        batch_op.drop_index("dataset_api_token_binding_space_idx")
        batch_op.drop_constraint("dataset_api_token_binding_resource_ck", type_="check")
        batch_op.drop_constraint("dataset_api_token_binding_space_unique", type_="unique")
        batch_op.drop_constraint("dataset_api_token_binding_space_fkey", type_="foreignkey")
        batch_op.alter_column("dataset_id", existing_type=StringUUID(), nullable=False)
        batch_op.drop_column("control_space_id")
        batch_op.drop_column("resource_type")
