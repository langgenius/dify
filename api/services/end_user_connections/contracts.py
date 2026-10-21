"""Application inputs/results and use-case contracts; no HTTP routes or CRUD yet.

Authority is a separate WebConnectionContext, never part of a submitted payload.
The target resolver reconstructs the currently published node/Provider/Client from
stored state. CRUD implementations must apply the ownership policy before decrypting
or contacting a plugin. Controllers will map domain failures to documented HTTP
errors when the corresponding vertical slice is implemented.
"""

from datetime import datetime
from typing import Any, Protocol, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue, computed_field, field_validator, model_validator

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import ConnectionCredentialStatus, ConnectionCredentialType, NodeConnectionStatus
from services.end_user_connections.entities import ToolConnectionTarget, WebConnectionContext


class ConnectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, hide_input_in_errors=True)


class ConnectionTargetInput(ConnectionInput):
    """Untrusted graph references, checked against the active published version."""

    workflow_id: UUID = Field(strict=False)
    node_id: str = Field(min_length=1, max_length=255)


class CreateApiKeyConnectionInput(ConnectionTargetInput):
    name: str = Field(min_length=1, max_length=100)
    # Provider-schema validation and remote checks precede persistence.
    credentials: dict[str, JsonValue] = Field(min_length=1, repr=False)


class UpdateConnectionInput(ConnectionInput):
    """Omitted fields are unchanged; explicit null is invalid.

    Credentials are a complete API-key replacement, never a patch containing mask
    placeholders. OAuth credentials can change only through the OAuth lifecycle.
    """

    name: str | None = Field(default=None, min_length=1, max_length=100)
    credentials: dict[str, JsonValue] | None = Field(default=None, min_length=1, repr=False)

    @field_validator("name", "credentials", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("Omit unchanged fields instead of supplying null.")
        return value

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one change is required.")
        return self


class StartConnectionOAuthInput(ConnectionTargetInput):
    name: str = Field(min_length=1, max_length=100)


class ListConnectionsInput(ConnectionInput):
    # None means no Provider filter, or the first page, respectively.
    provider: str | None = Field(default=None, min_length=1, max_length=255)
    cursor: str | None = Field(default=None, min_length=1, max_length=1024)
    limit: int = Field(default=20, ge=1, le=100)


class ConnectionSummary(BaseModel):
    """Allowlisted management result, not proof that a Connection can run a node.

    No owner IDs, ciphertext, credential values, or raw OAuth Client IDs are exposed.
    account_label is already masked; API-key Connections have no account label.
    credential_status is intrinsic lifecycle state, not the node's effective status.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    name: str
    provider: str
    credential_type: ConnectionCredentialType
    credential_status: ConnectionCredentialStatus
    account_label: str | None
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime
    last_active_at: datetime


class ConnectionPage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    data: tuple[ConnectionSummary, ...]
    # None means there is no next page; cursors are scoped again on every request.
    next_cursor: str | None

    @computed_field
    @property
    def has_more(self) -> bool:
        return self.next_cursor is not None


class ConnectionCheckView(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    connection_id: str
    check: CredentialCheckResult
    credential_status: ConnectionCredentialStatus


class NodeConnectionState(BaseModel):
    """Effective status for one node; only connected satisfies its connection gate.

    The check result remains separate. Transient/unperformed checks on an otherwise
    usable credential raise ConnectionCheckUnavailableError rather than fabricating
    invalidity or claiming readiness. Scope expansion is not part of this release.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_id: str
    node_id: str
    # None when no visible Connection is selected, including deleted/unowned rows.
    connection_id: str | None
    status: NodeConnectionStatus
    # None when no remote check was needed to establish a blocking state.
    check: CredentialCheckResult | None

    @model_validator(mode="after")
    def validate_selection_state(self) -> Self:
        if self.status == NodeConnectionStatus.DISCONNECTED:
            if self.connection_id is not None or self.check is not None:
                raise ValueError("Disconnected nodes cannot expose Connection or check metadata.")
        elif self.connection_id is None:
            raise ValueError("A connected or blocked Connection state requires a selected Connection.")
        return self


class ConnectionOAuthStart(BaseModel):
    """The controller also sets the existing OAuth context cookie."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    authorization_url: str = Field(repr=False)
    # Server-generated Redis context reference, excluded from the response body.
    context_id: str = Field(repr=False, exclude=True)


class ConnectionTargetResolver(Protocol):
    def resolve(self, context: WebConnectionContext, reference: ConnectionTargetInput) -> ToolConnectionTarget:
        """Resolve the published node and its installed Provider/Client in this scope.

        Reject missing/wrong-source nodes and uninstalled Providers. An App may
        accept several credential types on a node. Respect explicit reuse rules
        without merging independent nodes by Provider. Never accept caller-owned
        Provider capabilities, OAuth client parameters, or a draft graph here.
        """
        ...


class ConnectionManagement(Protocol):
    """Owner-scoped management; App Access/Guest entry policy is enforced upstream.

    Missing and foreign IDs both raise ConnectionNotFoundError. Do not require
    workspace membership or an existing default/Session selection to manage an
    owned Connection. Status/configuration changes must not prevent its deletion
    or repair. Database/ownership state must be revalidated after async boundaries.
    """

    def list_connections(self, context: WebConnectionContext, query: ListConnectionsInput) -> ConnectionPage: ...

    def get_connection(self, context: WebConnectionContext, connection_id: str) -> ConnectionSummary: ...

    def create_api_key(self, context: WebConnectionContext, command: CreateApiKeyConnectionInput) -> ConnectionSummary:
        """Validate schema and target, check credentials, encrypt, then persist.

        Definite invalidity raises ConnectionInvalidCredentialsError; transient
        checks raise ConnectionCheckUnavailableError. Unsupported checking is not
        invalidity. No remote I/O in a write transaction. Creation never selects
        the Connection for a Session or changes App defaults.
        """
        ...

    def update_connection(
        self, context: WebConnectionContext, connection_id: str, command: UpdateConnectionInput
    ) -> ConnectionSummary:
        """Replace API-key credentials only after successful validation.

        Name-only edits work for either type. Preserve old values on failure. A
        conditional write includes owner/tenant/revision and atomically increments
        revision; a lost race raises ConnectionConflictError, never a blind retry.
        """
        ...

    def delete_connection(self, context: WebConnectionContext, connection_id: str) -> None:
        """Remove the resource and live selections; retain historical Run references.

        OAuth revocation is best effort outside a write transaction. Failure or
        lack of revoke support must not restore the deleted Connection.
        """
        ...

    def check_connection(self, context: WebConnectionContext, connection_id: str) -> ConnectionCheckView:
        """Refresh expired OAuth server-side before checking when possible.

        Unsupported and temporarily unavailable checks never persist invalidity.
        Checking does not extend last_active_at or select a replacement Connection.
        """
        ...

    def start_oauth(self, context: WebConnectionContext, command: StartConnectionOAuthInput) -> ConnectionOAuthStart:
        """Use the resolved workspace/platform Client and existing short-lived context."""
        ...

    def reauthorize_oauth(self, context: WebConnectionContext, connection_id: str) -> ConnectionOAuthStart:
        """Keep the Connection ID; pin owner/revision/Provider/Client in server context.

        A callback revalidates these references before writing. Failed authorization
        cannot become a new Connection or overwrite existing working credentials.
        """
        ...
