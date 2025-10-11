from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from .account import Account
from .base import Base
from .engine import db
from .types import StringUUID


class WorkflowNameAlias(Base):
    """
    Workflow Alias for managing version aliases across different environments.

    This table allows users to assign human-readable aliases to workflow versions,
    making it easier to manage deployments across different environments.

    Attributes:
        - id (uuid): Alias ID, primary key
        - app_id (uuid): App ID
        - workflow_id (uuid): Workflow version ID
        - name (string): Alias name (e.g., 'production', 'staging', 'v1.0')

        - created_by (uuid): Creator ID
        - created_at (timestamp): Creation time
        - updated_at (timestamp): Last update time
    """

    __tablename__ = "workflow_name_aliases"
    __allow_unmapped__ = True  # Allow non-mapped attributes
    __slots__ = ("_is_transferred", "_old_workflow_id")
    __table_args__ = (
        # Ensure alias name is unique within an app
        sa.UniqueConstraint("app_id", "name", name="unique_workflow_alias_app_name"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, server_default=sa.text("uuidv7()"))
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)

    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )

    created_by_account: Mapped["Account"] = relationship(foreign_keys=[created_by])

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._is_transferred = False
        self._old_workflow_id = None

    def __repr__(self):
        return f"<WorkflowNameAlias(id='{self.id}', app_id='{self.app_id}', name='{self.name}')>"
