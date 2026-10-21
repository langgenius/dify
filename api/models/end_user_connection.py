"""Personal credentials and saved selections, separate from workspace credentials.

Account, EndUser, App, Workflow, business Session, and Run references are logical pointers.
Callers must validate their complete ownership chain before writing selections;
the foreign keys here only enforce the credential namespace and Provider.
"""

from datetime import datetime
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from libs.datetime_utils import naive_utc_now

from .base import DefaultFieldsDCMixin, TypeBase
from .types import EnumText, LongText, StringUUID


class ConnectionCredentialType(StrEnum):
    API_KEY = "api-key"
    OAUTH2 = "oauth2"


class ConnectionStatus(StrEnum):
    CONNECTED = "connected"
    RECONNECT_REQUIRED = "reconnect_required"
    INVALID = "invalid"


class OAuthClientSource(StrEnum):
    WORKSPACE = "workspace"
    PLATFORM = "platform"


class EndUserConnection(DefaultFieldsDCMixin, TypeBase):
    """An Account owns credentials across Apps within their tenant namespace.

    Guest and service identities own credentials through their App-scoped EndUser.
    Neither queries nor checks automatically extend last_active_at. Credential
    mutation services must condition writes on owner and revision after external I/O.
    """

    __tablename__ = "end_user_connections"
    __table_args__ = (
        sa.CheckConstraint(
            "(account_id IS NOT NULL AND end_user_id IS NULL) OR (account_id IS NULL AND end_user_id IS NOT NULL)",
            name=sa.schema.conv("end_user_connection_owner_check"),
        ),
        sa.CheckConstraint(
            "credential_type IN ('api-key', 'oauth2')", name=sa.schema.conv("end_user_connection_credential_type_check")
        ),
        sa.CheckConstraint(
            "status IN ('connected', 'reconnect_required', 'invalid')",
            name=sa.schema.conv("end_user_connection_status_check"),
        ),
        sa.CheckConstraint("revision > 0", name=sa.schema.conv("end_user_connection_revision_check")),
        sa.CheckConstraint(
            sa.func.char_length(sa.column("name")).between(1, 100),
            name=sa.schema.conv("end_user_connection_name_check"),
        ),
        sa.CheckConstraint(
            "(credential_type = 'api-key' AND oauth_client_source IS NULL "
            "AND oauth_client_configuration_id IS NULL AND oauth_client_id IS NULL AND expires_at IS NULL) OR "
            "(credential_type = 'oauth2' AND oauth_client_source IS NOT NULL "
            "AND oauth_client_source IN ('workspace', 'platform'))",
            name=sa.schema.conv("end_user_connection_oauth_check"),
        ),
        # Selection FKs prevent a valid ID from being paired with another tenant or Provider.
        sa.UniqueConstraint("id", "tenant_id", "provider", name="end_user_connection_scope_key"),
        sa.Index("end_user_connection_account_idx", "tenant_id", "account_id", "id"),
        sa.Index("end_user_connection_end_user_idx", "tenant_id", "end_user_id", "id"),
        sa.Index("end_user_connection_activity_idx", "last_active_at", "id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # Exactly one owner reference is populated; EndUser carries its own identity type.
    account_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    end_user_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    provider: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    credential_type: Mapped[ConnectionCredentialType] = mapped_column(
        EnumText(ConnectionCredentialType), nullable=False
    )
    name: Mapped[str] = mapped_column(sa.String(100), nullable=False)
    encrypted_credentials: Mapped[str] = mapped_column(LongText, nullable=False, repr=False)
    status: Mapped[ConnectionStatus] = mapped_column(EnumText(ConnectionStatus), nullable=False)
    # All client fields are absent for API keys. OAuth requires only a source.
    oauth_client_source: Mapped[OAuthClientSource | None] = mapped_column(EnumText(OAuthClientSource), nullable=True)
    # None means the client has no independent configuration record or no available public ID.
    oauth_client_configuration_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    oauth_client_id: Mapped[str | None] = mapped_column(LongText, nullable=True)
    # None means unknown expiration, or not applicable for API keys.
    expires_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True)
    revision: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=1, server_default=sa.text("1"))
    last_active_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        default_factory=naive_utc_now,
        server_default=sa.func.current_timestamp(),
    )


class AppConnection(DefaultFieldsDCMixin, TypeBase):
    """One Tool node selection from an App user's last Run; not a permission grant.

    Replace the whole set under a stable owner lock, including for an empty set.
    All rows in a replacement share source_run_id. The Run integration owns update
    timing and ordering; row timestamps do not define the latest Run. Empty defaults
    have no rows. Run references never cascade into historical execution records.
    workflow_id and node_id identify the published graph version where this choice
    was saved. A different execution version requires reconfirmation, even if node
    IDs match. Callers validate Workflow ownership and node authentication requirements
    before replacing the saved version and choice; these rows are not version history.
    """

    __tablename__ = "app_connections"
    __table_args__ = (
        sa.UniqueConstraint("app_id", "end_user_id", "node_id", name="app_connection_selection_key"),
        sa.ForeignKeyConstraint(
            ["connection_id", "tenant_id", "provider"],
            ["end_user_connections.id", "end_user_connections.tenant_id", "end_user_connections.provider"],
            name="app_connection_scope_fkey",
            ondelete="CASCADE",
        ),
        sa.Index("app_connection_connection_idx", "connection_id"),
        sa.CheckConstraint(
            sa.func.char_length(sa.column("node_id")).between(1, 255),
            name=sa.schema.conv("app_connection_node_id_check"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_id: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    end_user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    connection_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    source_run_id: Mapped[str] = mapped_column(StringUUID, nullable=False)


class SessionConnection(DefaultFieldsDCMixin, TypeBase):
    """A business Session's saved choice, independent of App defaults and Run inputs.

    session_id refers to a Conversation for Chatflow. Plain Workflow's authoritative
    Session mapping is owned by the Run integration. It must never refer to
    EndUser.session_id, an OAuth context, or a Portal token. Ownership is resolved
    through the business Session, even when no selection rows exist. Retained
    references after identity migration do not transfer credential ownership. Like
    App defaults, workflow_id records the published graph version of the saved choice.
    A version mismatch requires reconfirmation and validation against the execution
    graph before replacing the saved version and choice.
    """

    __tablename__ = "session_connections"
    __table_args__ = (
        sa.UniqueConstraint("app_id", "session_id", "node_id", name="session_connection_selection_key"),
        sa.ForeignKeyConstraint(
            ["connection_id", "tenant_id", "provider"],
            ["end_user_connections.id", "end_user_connections.tenant_id", "end_user_connections.provider"],
            name="session_connection_scope_fkey",
            ondelete="CASCADE",
        ),
        sa.Index("session_connection_connection_idx", "connection_id"),
        sa.CheckConstraint(
            sa.func.char_length(sa.column("node_id")).between(1, 255),
            name=sa.schema.conv("session_connection_node_id_check"),
        ),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    node_id: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    provider: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    connection_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
