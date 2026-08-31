import json
from collections.abc import Sequence
from datetime import datetime
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, Session, mapped_column

from libs.uuid_utils import uuidv7

from .account import Account
from .base import Base
from .model import Tag, TagBinding
from .types import AdjustedJSON, LongText, StringUUID


class SnippetType(StrEnum):
    """Snippet Type Enum"""

    NODE = "node"
    GROUP = "group"


class CustomizedSnippet(Base):
    """
    Customized Snippet Model

    Stores reusable workflow components (nodes or node groups) that can be
    shared across applications within a workspace.
    """

    __tablename__ = "customized_snippets"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="customized_snippet_pkey"),
        sa.Index("customized_snippet_tenant_idx", "tenant_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(LongText, nullable=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False, server_default=sa.text("'node'"))

    # Workflow reference for published version
    workflow_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)

    # State flags
    is_published: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("1"))
    use_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"))

    # Visual customization
    icon_info: Mapped[dict | None] = mapped_column(AdjustedJSON, nullable=True)

    # Snippet configuration (stored as JSON text)
    input_fields: Mapped[str | None] = mapped_column(LongText, nullable=True)

    # Audit fields
    created_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )

    def graph_dict(self, session: Session) -> dict[str, Any]:
        """Get graph from associated workflow."""
        if self.workflow_id:
            from .workflow import Workflow

            workflow = session.get(Workflow, self.workflow_id)
            if workflow:
                return json.loads(workflow.graph) if workflow.graph else {}
        return {}

    @property
    def input_fields_list(self) -> list[dict[str, Any]]:
        """Parse input_fields JSON to list."""
        return json.loads(self.input_fields) if self.input_fields else []

    def tags(self, session: Session) -> Sequence[Tag]:
        """Get snippet tags."""
        tags = session.scalars(
            sa.select(Tag)
            .join(TagBinding, Tag.id == TagBinding.tag_id)
            .where(
                TagBinding.target_id == self.id,
                TagBinding.tenant_id == self.tenant_id,
                Tag.tenant_id == self.tenant_id,
                Tag.type == "snippet",
            )
        ).all()

        return tags or []

    def created_by_account(self, session: Session) -> Account | None:
        """Get the account that created this snippet."""
        if self.created_by:
            return session.get(Account, self.created_by)
        return None

    def author_name(self, session: Session) -> str | None:
        """Get the creator account name."""
        account = self.created_by_account(session)
        return account.name if account else None

    def updated_by_account(self, session: Session) -> Account | None:
        """Get the account that last updated this snippet."""
        if self.updated_by:
            return session.get(Account, self.updated_by)
        return None

    @property
    def version_str(self) -> str:
        """Get version as string for API response."""
        return str(self.version)
