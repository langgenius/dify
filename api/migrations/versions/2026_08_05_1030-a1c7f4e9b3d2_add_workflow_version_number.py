"""add workflow version number

Revision ID: a1c7f4e9b3d2
Revises: e4708db55c1d
Create Date: 2026-08-05 10:30:00.000000

Introduces user-facing workflow version numbers (`#N`), unique and monotonically
increasing per app. `workflow_version_counters` holds one row per app with the
highest number handed out so far, so numbers are never reused when a published
version is deleted.

DDL only. Versions published before this revision keep `version_number` NULL and
continue to render as "Untitled Version"; numbering starts at #1 on the first
publish after the upgrade.

"""

import sqlalchemy as sa
from alembic import op

import models as models

# revision identifiers, used by Alembic.
revision = "a1c7f4e9b3d2"
down_revision = "e4708db55c1d"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "workflow_version_counters",
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("last_version_number", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("app_id", name="workflow_version_counter_pkey"),
    )

    with op.batch_alter_table("workflows", schema=None) as batch_op:
        batch_op.add_column(sa.Column("version_number", sa.Integer(), nullable=True))

    # Excluding NULLs keeps the index off every pre-existing version row. The
    # partial-WHERE clause is PG-only (SQLAlchemy drops the kwarg on MySQL →
    # plain unique index); both dialects treat NULLs as distinct, so unnumbered
    # rows stay unconstrained either way.
    op.create_index(
        "workflow_app_version_number_idx",
        "workflows",
        ["app_id", "version_number"],
        unique=True,
        postgresql_where=sa.text("version_number IS NOT NULL"),
    )


def downgrade():
    op.drop_index("workflow_app_version_number_idx", table_name="workflows")

    with op.batch_alter_table("workflows", schema=None) as batch_op:
        batch_op.drop_column("version_number")

    op.drop_table("workflow_version_counters")
