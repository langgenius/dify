"""simplify agent v2 output contract

Revision ID: 925e75620b69
Revises: fbdfcf5f5a6e
Create Date: 2026-08-21 14:22:52.730081

"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "925e75620b69"
down_revision = "fbdfcf5f5a6e"
branch_labels = None
depends_on = None

_LEGACY_PRESET_OUTPUT_NAMES = frozenset({"text", "files", "json"})


def _remove_legacy_preset_declared_outputs(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    declared_outputs = value.get("declared_outputs")
    if not isinstance(declared_outputs, list):
        return False

    retained_outputs = [
        output
        for output in declared_outputs
        if not (isinstance(output, dict) and output.get("name") in _LEGACY_PRESET_OUTPUT_NAMES)
    ]
    if len(retained_outputs) == len(declared_outputs):
        return False
    value["declared_outputs"] = retained_outputs
    return True


def _rewrite_node_job_configs() -> None:
    if op.get_context().as_sql:
        return

    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, node_job_config FROM workflow_agent_node_bindings"))
    for binding_id, raw_value in rows:
        if raw_value is None:
            continue
        value = json.loads(raw_value)
        if not _remove_legacy_preset_declared_outputs(value):
            continue
        connection.execute(
            sa.text("UPDATE workflow_agent_node_bindings SET node_job_config = :value WHERE id = :binding_id"),
            {
                "binding_id": binding_id,
                "value": json.dumps(value, ensure_ascii=False, separators=(",", ":")),
            },
        )


def upgrade() -> None:
    _rewrite_node_job_configs()


def downgrade() -> None:
    # ``text`` is now a derived system output, while ``files`` and ``json`` are
    # retired presets. Their removed declarations cannot be reconstructed
    # precisely after cleanup, so this data migration is one-way.
    pass
