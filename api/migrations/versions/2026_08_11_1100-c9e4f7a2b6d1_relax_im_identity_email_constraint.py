"""Retain the revision after removing the unpublished normalization constraint.

Revision ID: c9e4f7a2b6d1
Revises: b7d3e5f9a1c2
Create Date: 2026-08-11 11:00:00
"""

from collections.abc import Sequence

revision: str = "c9e4f7a2b6d1"
down_revision: str | None = "b7d3e5f9a1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """The original unpublished schema no longer creates the constraint."""


def downgrade() -> None:
    """The original unpublished schema no longer creates the constraint."""
