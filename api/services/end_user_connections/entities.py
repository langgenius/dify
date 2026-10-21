"""Internal authority references, reconstructed from authenticated/stored state.

These types are not request payloads. A serialized context is not proof of
identity: OAuth callbacks and asynchronous consumers must resolve it again at
their authentication/persistence boundary. No workspace membership is implied.
"""

from dataclasses import dataclass, field

from clients.plugin.auth_entities import CredentialCheckResult
from constants.end_user_connections import ConnectionCredentialStatus, ConnectionCredentialType, OAuthClientSource


@dataclass(frozen=True, slots=True)
class ConnectionOwner:
    # Exactly one reference is populated; EndUser owns its own identity type.
    account_id: str | None
    end_user_id: str | None

    def __post_init__(self) -> None:
        if (self.account_id is None) == (self.end_user_id is None):
            raise ValueError("Exactly one Connection owner is required.")
        if self.account_id == "" or self.end_user_id == "":
            raise ValueError("Connection owner identifiers must not be empty.")


@dataclass(frozen=True, slots=True)
class WebConnectionContext:
    """The existing Web Passport boundary has authenticated this App and EndUser."""

    tenant_id: str
    app_id: str
    end_user_id: str
    # None keeps ownership on the authenticated App-scoped EndUser.
    account_id: str | None

    def __post_init__(self) -> None:
        if not self.tenant_id or not self.app_id or not self.end_user_id or self.account_id == "":
            raise ValueError("Incomplete connection identity.")

    @property
    def owner(self) -> ConnectionOwner:
        if self.account_id is not None:
            return ConnectionOwner(account_id=self.account_id, end_user_id=None)
        return ConnectionOwner(account_id=None, end_user_id=self.end_user_id)


@dataclass(frozen=True, slots=True)
class ConnectionOAuthClient:
    """Non-secret grant provenance; never serialize the raw client ID to browsers."""

    source: OAuthClientSource
    configuration_id: str
    # None means the plugin does not expose a public Client ID.
    client_id: str | None = field(repr=False)


@dataclass(frozen=True, slots=True)
class ConnectionAccessRecord:
    """Stored access metadata, loaded without decrypting credential material.

    credential_status is the persisted lifecycle state. Lifecycle services apply
    refresh/repair results before projection; a status projection never revives a
    stored invalid grant or writes an App-specific mismatch into this record.
    """

    id: str
    tenant_id: str
    owner: ConnectionOwner
    provider: str
    credential_type: ConnectionCredentialType
    credential_status: ConnectionCredentialStatus
    # None for API keys; OAuth stores the reference captured for its grant.
    oauth_client: ConnectionOAuthClient | None
    revision: int

    def __post_init__(self) -> None:
        if self.revision <= 0:
            raise ValueError("Connection revision must be positive.")
        if (self.credential_type == ConnectionCredentialType.OAUTH2) != (self.oauth_client is not None):
            raise ValueError("OAuth client provenance must match the credential type.")


@dataclass(frozen=True, slots=True)
class ToolConnectionTarget:
    """Effective EndUser requirement from the currently published App graph.

    The resolver checks App/Workflow ownership, node existence and source, follows
    explicit reuse configuration, and resolves an installed Provider in this tenant.
    provider is canonical, not a browser-supplied alias. Independent nodes are never
    merged by Provider. A missing OAuth client means authorization is unavailable.
    """

    tenant_id: str
    app_id: str
    workflow_id: str
    node_id: str
    provider: str
    allowed_credential_types: frozenset[ConnectionCredentialType]
    provider_credential_types: frozenset[ConnectionCredentialType]
    oauth_client: ConnectionOAuthClient | None


@dataclass(frozen=True, slots=True)
class ConnectionMutationGuard:
    """All predicates for a conditional write, including the original owner.

    Persistence must match these fields, increment revision in the same write,
    and report zero affected rows as a conflict. Never retry stale external results
    with a newer revision. Construct this only after ownership has been checked.
    """

    connection_id: str
    tenant_id: str
    owner: ConnectionOwner
    revision: int


@dataclass(frozen=True, slots=True)
class NodeConnectionSelection:
    """An explicit choice for one graph-version node, never inferred from defaults."""

    workflow_id: str
    node_id: str
    # None means unselected or explicitly disconnected.
    connection_id: str | None


@dataclass(frozen=True, slots=True)
class ConnectionCheckSnapshot:
    """Bind a normalized check result to the exact credential revision checked."""

    connection_id: str
    revision: int
    result: CredentialCheckResult
