from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from libs.uuid_utils import uuidv7

from .base import TypeBase
from .types import LongText, StringUUID

if TYPE_CHECKING:
    pass


class GitHubConnection(TypeBase):
    """
    Stores GitHub OAuth connection and repository mapping.

    Attributes:
    - id: Connection ID
    - tenant_id: Workspace ID
    - user_id: User who created the connection
    - app_id: App ID (optional, can be workspace-level)
    - repository_owner: GitHub repository owner
    - repository_name: GitHub repository name
    - branch: Default branch name
    - access_token: Encrypted GitHub access token
    - refresh_token: Encrypted refresh token (if applicable)
    - token_expires_at: Token expiration timestamp
    - webhook_id: GitHub webhook ID for sync
    - webhook_secret: Webhook secret (encrypted)
    - created_at: Creation timestamp
    - updated_at: Last update timestamp
    """

    __tablename__ = "github_connections"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="github_connection_pkey"),
        sa.Index("github_connection_tenant_id_idx", "tenant_id"),
        sa.Index("github_connection_app_id_idx", "app_id"),
        sa.Index("github_connection_user_id_idx", "user_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuidv7()), default_factory=lambda: str(uuidv7()), init=False
    )
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # None for workspace-level connections
    app_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True, default=None)
    repository_owner: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    repository_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    branch: Mapped[str] = mapped_column(String(255), nullable=False, default="main")
    # Path to workflow file in repository
    workflow_file_path: Mapped[str] = mapped_column(String(500), nullable=False, default="workflow.json")
    access_token: Mapped[str] = mapped_column(LongText, nullable=False, default="")  # Encrypted
    refresh_token: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)  # Encrypted, optional
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    webhook_id: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    webhook_secret: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)  # Encrypted
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )

    @property
    def created_by_account(self):
        from extensions.ext_database import db
        from models.account import Account

        return db.session.get(Account, self.user_id)

    @property
    def repository_full_name(self) -> str:
        """Get full repository name in format owner/repo."""
        return f"{self.repository_owner}/{self.repository_name}"

    def get_decrypted_access_token(self) -> str:
        """Get decrypted access token."""
        from core.helper.encrypter import decrypt_token

        return decrypt_token(self.tenant_id, self.access_token)

    def get_decrypted_refresh_token(self) -> str | None:
        """Get decrypted refresh token if available."""
        if not self.refresh_token:
            return None
        from core.helper.encrypter import decrypt_token

        return decrypt_token(self.tenant_id, self.refresh_token)

    def get_decrypted_webhook_secret(self) -> str | None:
        """Get decrypted webhook secret if available."""
        if not self.webhook_secret:
            return None
        from core.helper.encrypter import decrypt_token

        return decrypt_token(self.tenant_id, self.webhook_secret)

    def set_encrypted_access_token(self, token: str) -> None:
        """Set encrypted access token."""
        from core.helper.encrypter import encrypt_token

        self.access_token = encrypt_token(self.tenant_id, token)

    def set_encrypted_refresh_token(self, token: str | None) -> None:
        """Set encrypted refresh token."""
        if token is None:
            self.refresh_token = None
            return
        from core.helper.encrypter import encrypt_token

        self.refresh_token = encrypt_token(self.tenant_id, token)

    def set_encrypted_webhook_secret(self, secret: str | None) -> None:
        """Set encrypted webhook secret."""
        if secret is None:
            self.webhook_secret = None
            return
        from core.helper.encrypter import encrypt_token

        self.webhook_secret = encrypt_token(self.tenant_id, secret)

    def to_dict(self, include_tokens: bool = False) -> dict:
        """Convert to dictionary representation."""
        result = {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "user_id": self.user_id,
            "app_id": self.app_id,
            "repository_owner": self.repository_owner,
            "repository_name": self.repository_name,
            "repository_full_name": self.repository_full_name,
            "branch": self.branch,
            "workflow_file_path": self.workflow_file_path,
            "token_expires_at": self.token_expires_at.isoformat() if self.token_expires_at else None,
            "webhook_id": self.webhook_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
        if include_tokens:
            result["access_token"] = self.get_decrypted_access_token()
            if self.refresh_token:
                result["refresh_token"] = self.get_decrypted_refresh_token()
            if self.webhook_secret:
                result["webhook_secret"] = self.get_decrypted_webhook_secret()
        return result
