"""Repair a missing OAuth consent flag without changing existing opt-ins.

Revision ID: c1120oauthfix
Revises: c3056dev1120
Create Date: 2026-11-20 14:00:00

Some restored databases record descendants of f3a9c2d17b4e while lacking its
oauth_provider_apps.auto_authorize column. Restore that revision's Boolean,
NOT NULL, DEFAULT false contract without stamping or replaying old revisions.
Existing valid columns and their explicit true values remain unchanged.

Online upgrades inspect the existing definition and reject incompatible drift.
Offline SQL assumes the column is missing and emits explicit DDL; use online
upgrades to reconcile databases where the original column already exists.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.mysql import TINYINT

revision = "c1120oauthfix"
down_revision = "c3056dev1120"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Restore the absent flag, preserve valid flags, and reject conflicting schemas.

    The OAuth provider-app table must exist. Missing flags are backfilled false,
    preserving consent for historical apps. Incompatible types, nullability,
    or defaults raise before any DDL or row change. Valid flags stay untouched.
    """
    if not op.get_context().as_sql:
        bind = op.get_bind()
        column = next(
            (
                column
                for column in sa.inspect(bind).get_columns("oauth_provider_apps")
                if column["name"] == "auto_authorize"
            ),
            None,
        )
        if column is not None:
            column_type = column["type"]
            boolean_type = isinstance(column_type, sa.Boolean) or (
                bind.dialect.name in ("mysql", "mariadb")
                and isinstance(column_type, TINYINT)
                and column_type.display_width == 1
            )
            default = column["default"]
            normalized_default = "" if default is None else str(default).strip().lower()
            while normalized_default.startswith("(") and normalized_default.endswith(")"):
                normalized_default = normalized_default[1:-1].strip()
            false_default = normalized_default in ("false", "0", "'0'", "'false'", "'false'::boolean", "false::boolean")
            if not boolean_type or column["nullable"] or not false_default:
                raise RuntimeError(
                    "oauth_provider_apps.auto_authorize must be Boolean NOT NULL with DEFAULT false; "
                    "inspect the conflicting schema before retrying this repair"
                )
            return
    op.add_column(
        "oauth_provider_apps",
        sa.Column("auto_authorize", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    """Keep the flag and its values because revision f3a9c2d17b4e owns them.

    This revision only restores an earlier schema contract. Removing that
    contract here would break the predecessor schema and discard true opt-ins.
    """
