"""Pure ownership and applicability rules, with no persistence or external I/O."""

from constants.end_user_connections import ConnectionCredentialType
from services.end_user_connections.entities import (
    ConnectionAccessRecord,
    ConnectionMutationGuard,
    ToolConnectionTarget,
    WebConnectionContext,
)
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
    ConnectionWorkflowChangedError,
)


def require_owned_connection(
    context: WebConnectionContext, record: ConnectionAccessRecord | None
) -> ConnectionAccessRecord:
    """Ownership allows management even when a node, Provider, or Client changed.

    App and Session selections never grant ownership. Account owners may manage a
    compatible same-tenant Connection across Apps; EndUser owners stay App-scoped.
    Stored rows must be filtered by tenant/owner as well, not only after retrieval.
    """
    if record is None or record.tenant_id != context.tenant_id or record.owner != context.owner:
        raise ConnectionNotFoundError()
    return record


def require_target_reference(
    context: WebConnectionContext,
    *,
    workflow_id: str,
    node_id: str,
    target: ToolConnectionTarget,
) -> None:
    """Check a requested graph reference against freshly resolved server state."""
    if target.tenant_id != context.tenant_id or target.app_id != context.app_id:
        raise ConnectionConfigurationError()
    if target.workflow_id != workflow_id:
        raise ConnectionWorkflowChangedError()
    if target.node_id != node_id:
        raise ConnectionConfigurationError()


def require_creation_target(
    context: WebConnectionContext,
    *,
    workflow_id: str,
    node_id: str,
    credential_type: ConnectionCredentialType,
    target: ToolConnectionTarget,
) -> None:
    require_target_reference(context, workflow_id=workflow_id, node_id=node_id, target=target)
    if (
        credential_type not in target.allowed_credential_types
        or credential_type not in target.provider_credential_types
    ):
        raise ConnectionConfigurationError()
    if credential_type == ConnectionCredentialType.OAUTH2 and target.oauth_client is None:
        raise ConnectionConfigurationError()


def require_applicable_connection(
    context: WebConnectionContext,
    record: ConnectionAccessRecord | None,
    *,
    workflow_id: str,
    node_id: str,
    target: ToolConnectionTarget,
) -> ConnectionAccessRecord:
    """Check ownership first, then the intended node and OAuth grant provenance.

    This does not certify readiness: remote checks, refresh, and status decisions
    belong to lifecycle/Preflight services. In particular, it never changes a
    Connection's persisted status because one App's configuration changed.
    """
    owned = require_owned_connection(context, record)
    require_target_reference(context, workflow_id=workflow_id, node_id=node_id, target=target)
    if (
        owned.provider != target.provider
        or owned.credential_type not in target.allowed_credential_types
        or owned.credential_type not in target.provider_credential_types
    ):
        raise ConnectionConfigurationError()
    if owned.credential_type == ConnectionCredentialType.OAUTH2 and owned.oauth_client != target.oauth_client:
        raise ConnectionReauthorizationRequiredError()
    return owned


def connection_mutation_guard(
    context: WebConnectionContext, record: ConnectionAccessRecord | None
) -> ConnectionMutationGuard:
    owned = require_owned_connection(context, record)
    return ConnectionMutationGuard(
        connection_id=owned.id,
        tenant_id=owned.tenant_id,
        owner=owned.owner,
        revision=owned.revision,
    )
