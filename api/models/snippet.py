import json
from datetime import datetime
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from libs.uuid_utils import uuidv7

from .account import Account
from .base import Base
from .engine import db
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
        sa.UniqueConstraint("tenant_id", "name", name="customized_snippet_tenant_name_key"),
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

    @property
    def graph_dict(self) -> dict[str, Any]:
        """Get graph from associated workflow."""
        if self.workflow_id:
            from .workflow import Workflow

            workflow = db.session.get(Workflow, self.workflow_id)
            if workflow:
                return json.loads(workflow.graph) if workflow.graph else {}
        return {}

    @property
    def input_fields_list(self) -> list[dict[str, Any]]:
        """Parse input_fields JSON to list."""
        return json.loads(self.input_fields) if self.input_fields else []

    @property
    def created_by_account(self) -> Account | None:
        """Get the account that created this snippet."""
        if self.created_by:
            return db.session.get(Account, self.created_by)
        return None

    @property
    def updated_by_account(self) -> Account | None:
        """Get the account that last updated this snippet."""
        if self.updated_by:
            return db.session.get(Account, self.updated_by)
        return None

    @property
    def version_str(self) -> str:
        """Get version as string for API response."""
        return str(self.version)
