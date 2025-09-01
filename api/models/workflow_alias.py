from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy import String, func
from sqlalchemy.orm import Mapped, mapped_column

from .account import Account
from .base import Base
from .types import StringUUID


class AliasType(StrEnum):
    """Alias type enumeration"""

    SYSTEM = "system"  # System aliases like 'production', 'staging'
    CUSTOM = "custom"  # User-defined custom aliases


class WorkflowNameAlias(Base):
    """
    Workflow Alias for managing version aliases across different environments.

    This table allows users to assign human-readable aliases to workflow versions,
    making it easier to manage deployments across different environments.

    Attributes:
        - id (uuid): Alias ID, primary key
        - tenant_id (uuid): Workspace ID
        - app_id (uuid): App ID
        - workflow_id (uuid): Workflow version ID
        - alias_name (string): Alias name (e.g., 'production', 'staging', 'v1.0')
        - alias_type (string): Type of alias ('system' or 'custom')

        - created_by (uuid): Creator ID
        - created_at (timestamp): Creation time
        - updated_at (timestamp): Last update time
    """

    __tablename__ = "workflow_name_aliases"
    __allow_unmapped__ = True  # Allow non-mapped attributes
    __slots__ = ("_is_transferred", "_old_workflow_id")
    __table_args__ = (
        # Ensure alias name is unique within an app
        sa.UniqueConstraint("app_id", "alias_name", name="unique_workflow_alias_app_name"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, server_default=sa.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str]

    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._is_transferred = False
        self._old_workflow_id = None

    @property
    def created_by_account(self):
        """Get the account that created this alias"""
        from .engine import db

        return db.session.get(Account, self.created_by)


    def __repr__(self):
        return (
            f"<WorkflowAlias(id='{self.id}', app_id='{self.app_id}', "
            f"alias_name='{self.alias_name}', type='{self.alias_type}')>"
        )
