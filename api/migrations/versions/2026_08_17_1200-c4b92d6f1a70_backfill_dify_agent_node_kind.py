"""backfill Dify Agent node kind for bound workflow nodes

Revision ID: c4b92d6f1a70
Revises: 56124e050600
Create Date: 2026-08-17 12:00:00.000000

"""

import json
from collections import defaultdict

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

# revision identifiers, used by Alembic.
revision = "c4b92d6f1a70"
down_revision = "56124e050600"
branch_labels = None
depends_on = None

_BATCH_SIZE = 200


def upgrade() -> None:
    if op.get_context().as_sql:
        return

    connection = op.get_bind()
    workflows = sa.table(
        "workflows",
        sa.column("id", StringUUID()),
        sa.column("graph", sa.Text()),
    )
    bindings = sa.table(
        "workflow_agent_node_bindings",
        sa.column("workflow_id", StringUUID()),
        sa.column("node_id", sa.String(255)),
    )

    last_workflow_id: str | None = None
    while True:
        conditions = [sa.exists().where(bindings.c.workflow_id == workflows.c.id)]
        if last_workflow_id is not None:
            conditions.append(workflows.c.id > last_workflow_id)
        workflow_ids = list(
            connection.scalars(sa.select(workflows.c.id).where(*conditions).order_by(workflows.c.id).limit(_BATCH_SIZE))
        )
        if not workflow_ids:
            break

        node_ids_by_workflow: defaultdict[str, set[str]] = defaultdict(set)
        for workflow_id, node_id in connection.execute(
            sa.select(bindings.c.workflow_id, bindings.c.node_id).where(bindings.c.workflow_id.in_(workflow_ids))
        ):
            node_ids_by_workflow[workflow_id].add(node_id)

        workflow_rows = connection.execute(
            sa.select(workflows.c.id, workflows.c.graph).where(workflows.c.id.in_(workflow_ids))
        )
        for workflow_id, raw_graph in workflow_rows:
            if not isinstance(raw_graph, str):
                continue
            try:
                graph = json.loads(raw_graph)
            except (TypeError, json.JSONDecodeError):
                continue
            if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list):
                continue

            changed = False
            bound_node_ids = node_ids_by_workflow[workflow_id]
            for node in graph["nodes"]:
                if not isinstance(node, dict) or node.get("id") not in bound_node_ids:
                    continue
                node_data = node.get("data")
                if not isinstance(node_data, dict):
                    continue
                if (
                    node_data.get("type") == "agent"
                    and str(node_data.get("version")) == "2"
                    and node_data.get("agent_node_kind") is None
                ):
                    node_data["agent_node_kind"] = "dify_agent"
                    changed = True

            if changed:
                connection.execute(
                    sa.update(workflows)
                    .where(workflows.c.id == workflow_id)
                    .values(graph=json.dumps(graph, ensure_ascii=False, separators=(",", ":")))
                )

        last_workflow_id = workflow_ids[-1]


def downgrade() -> None:
    # Data-only compatibility marker: removing it could make valid Dify Agent
    # nodes indistinguishable from historical Agent nodes.
    pass
