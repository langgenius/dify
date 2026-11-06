"""Application inputs/results and use-case contracts for Connection management.

Authority is a separate WebConnectionContext, never part of a submitted payload.
The target resolver reconstructs the currently published node/Provider/Client from
stored state. CRUD implementations must apply the ownership policy before decrypting
or contacting a plugin. Controllers map domain failures to documented HTTP errors.

Explicit configuration saves own saved selections and authorization acceptance.
Run entry points check execution inputs without updating preferences. Builder tests use authorized
workspace credential overrides through the Console entry point (SNP-970), outside
this Web Passport and published-workflow contract.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, computed_field, field_validator, model_validator

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import ConnectionCredentialStatus, ConnectionCredentialType
from services.end_user_connections.entities import ToolConnectionTarget, WebConnectionContext
from services.end_user_connections.revision import ConnectionRevision


class ConnectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, hide_input_in_errors=True)


class ConnectionContractInput(ConnectionInput):
    connection_revision: ConnectionRevision = Field(
        description=(
            "Opaque revision issued for the current Web App. Use App parameters for tool-node operations "
            "or the owned Connection revision endpoint for Provider management."
        ),
    )


class ConnectionTargetInput(ConnectionContractInput):
    """Client connection contract references, checked against the current published graph."""

    node_id: str = Field(min_length=1, max_length=255)


class CreateApiKeyConnectionInput(ConnectionTargetInput):
    name: str | None = Field(
        default=None, max_length=100, description="Omit or leave empty to generate an incremental API KEY name."
    )
    # Provider-schema validation and remote checks precede persistence.
    credentials: dict[str, JsonValue] = Field(min_length=1, repr=False)


class UpdateConnectionInput(ConnectionInput):
    """Omitted fields are unchanged; explicit null is invalid.

    Credentials are a complete API-key replacement, never a patch containing mask
    placeholders. OAuth credentials can change only through the OAuth lifecycle.
    """

    connection_revision: ConnectionRevision | None = Field(
        default=None, description="Provider revision required when replacing credentials."
    )
    name: str | None = Field(default=None, min_length=1, max_length=100)
    credentials: dict[str, JsonValue] | None = Field(default=None, min_length=1, repr=False)

    @field_validator("name", "credentials", "connection_revision", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("Omit unchanged fields instead of supplying null.")
        return value

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if not self.model_fields_set.intersection({"name", "credentials"}):
            raise ValueError("At least one change is required.")
        if self.credentials is not None and self.connection_revision is None:
            raise ValueError("Connection revision is required when replacing credentials.")
        return self


class ConnectionRevisionView(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    connection_revision: ConnectionRevision = Field(
        description="Provider revision scoped to this Web App, for operations on the owned Connection."
    )


class StartConnectionOAuthInput(ConnectionTargetInput):
    name: str | None = Field(
        default=None, max_length=100, description="Omit or leave empty to generate an incremental AUTH name."
    )


class ListConnectionsInput(ConnectionInput):
    # None means no Provider filter, or the first page, respectively.
    provider: str | None = Field(default=None, min_length=1, max_length=255)
    cursor: str | None = Field(default=None, min_length=1, max_length=1024)
    limit: int = Field(default=20, ge=1, le=100)


class ConnectionSummary(BaseModel):
    """Allowlisted management result, not proof that a Connection can run a node.

    No owner IDs, ciphertext, credential values, or raw OAuth Client IDs are included.
    account_label retains the provider identity and must be masked by transport
    serialization; API-key Connections have no account label.
    credential_status is intrinsic lifecycle state, not the node's effective status.
    Workspace-backed projections have no persisted lifecycle or activity state;
    credential_status and last_active_at are null instead of implying readiness.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    name: str
    provider: str
    credential_type: ConnectionCredentialType
    credential_status: ConnectionCredentialStatus | None
    account_label: str | None
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime
    last_active_at: datetime | None


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


@dataclass(frozen=True)
class ConnectionCheckOutcome:
    """Internal check evidence pinned to the revision that was actually checked."""

    view: ConnectionCheckView
    revision: int


class ConnectionCredentialChecks(Protocol):
    def check_connection_result(
        self, context: WebConnectionContext, connection_id: str, *, connection_revision: str
    ) -> ConnectionCheckOutcome: ...


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
