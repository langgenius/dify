"""Index Human Input v2 deadlines for bounded expiration discovery.

Revision ID: 6a8c0e2f4b7d
Revises: f3c5e7a9b1d2
Create Date: 2026-10-09 12:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "6a8c0e2f4b7d"
down_revision: str | None = "f3c5e7a9b1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("hitlv2_forms_node_deadline_idx", "hitlv2_forms", ["form_kind", "status", "expiration_time", "id"])
    op.create_index(
        "hitlv2_forms_global_deadline_idx", "hitlv2_forms", ["form_kind", "status", "global_timeout_deadline", "id"]
    )


def downgrade() -> None:
    op.drop_index("hitlv2_forms_global_deadline_idx", table_name="hitlv2_forms")
    op.drop_index("hitlv2_forms_node_deadline_idx", table_name="hitlv2_forms")
