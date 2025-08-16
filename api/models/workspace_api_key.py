import json
from datetime import datetime
from typing import Any, Optional

import sqlalchemy as sa
from sqlalchemy import String, func
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from models.types import StringUUID


class WorkspaceApiKey(Base):
    __tablename__ = "workspace_api_keys"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workspace_api_key_pkey"),
        sa.Index("workspace_api_key_token_idx", "token"),
        sa.Index("workspace_api_key_tenant_idx", "tenant_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    token: Mapped[str] = mapped_column(sa.Text, nullable=False)  # TEXT型で暗号化されたトークンを保存
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    scopes: Mapped[str] = mapped_column(sa.Text, nullable=False)  # JSON string of scopes
    expires_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime, nullable=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(sa.DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())

    @staticmethod
    def generate_api_key():
        """Generate workspace management API key"""
        from models.model import ApiToken

        return ApiToken.generate_api_key("wsk-", 32)

    @property
    def scopes_list(self) -> list[str]:
        """Get scopes as list"""
        try:
            return json.loads(self.scopes)
        except Exception:
            return []

    @scopes_list.setter
    def scopes_list(self, value: list[str]) -> None:
        """Set scopes from list"""
        self.scopes = json.dumps(value)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dict for API response"""
        is_expired = False
        if self.expires_at:
            is_expired = self.expires_at < datetime.utcnow()

        return {
            "id": self.id,
            "name": self.name,
            "token": self.token[:8] + "..." if self.token else "",
            "type": "workspace",
            "scopes": self.scopes_list,
            "created_at": self.created_at,
            "last_used_at": self.last_used_at,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "is_expired": is_expired,
            "created_by": self.created_by,
        }

    def to_auth_dict(self) -> dict[str, Any]:
        """Convert to auth dict for validation response"""
        return {
            "tenant_id": self.tenant_id,
            "token": self.token,
            "name": self.name,
            "scopes": self.scopes_list,
            "account_id": self.created_by,
        }
