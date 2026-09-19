"""clean legacy agent soul files

Revision ID: fbdfcf5f5a6e
Revises: 89919253ca7a
Create Date: 2026-08-20 09:38:36.827807

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "fbdfcf5f5a6e"
down_revision = "89919253ca7a"
branch_labels = None
depends_on = None


def _remove_legacy_files(table_name: str) -> None:
    dialect_name = op.get_context().dialect.name
    if dialect_name == "postgresql":
        op.execute(
            f"""UPDATE {table_name}
            SET config_snapshot = (config_snapshot::jsonb - 'files')::text
            WHERE config_snapshot::jsonb ? 'files'"""
        )
        return
    if dialect_name == "mysql":
        op.execute(
            f"""UPDATE {table_name}
            SET config_snapshot = JSON_REMOVE(config_snapshot, '$.files')
            WHERE JSON_CONTAINS_PATH(config_snapshot, 'one', '$.files')"""
        )
        return
    if dialect_name == "sqlite":
        op.execute(
            f"""UPDATE {table_name}
            SET config_snapshot = json_remove(config_snapshot, '$.files')
            WHERE json_type(config_snapshot, '$.files') IS NOT NULL"""
        )
        return
    raise RuntimeError(f"unsupported database dialect: {dialect_name}")


def upgrade() -> None:
    # The Agent Drive removal migration skipped its Python row rewrite when
    # migrations were emitted as offline SQL. Run the cleanup again as native
    # SQL so every deployment removes the retired AgentSoulConfig.files field.
    _remove_legacy_files("agent_config_snapshots")
    _remove_legacy_files("agent_config_drafts")


def downgrade() -> None:
    # The retired files catalog cannot be reconstructed after Agent Drive data
    # has been removed.
    pass
