"""Recognize the previously deployed application tracing revision.

Revision ID: a17c2980d3e6
Revises: a9d4c1e6f823

The original deployment created the same tracing schema as a17c2980f3e6,
but did not include that revision's main-only ancestors. Keep the original
parent so ordinary upgrades still apply genuinely missing schema changes.
Canonical a17c2980f3e6 creates or strictly validates the tracing tables; this
compatibility marker never replays the historical table creation.
"""

revision = "a17c2980d3e6"
down_revision = "a9d4c1e6f823"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
