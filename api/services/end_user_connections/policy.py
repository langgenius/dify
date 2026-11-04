"""Deployment admission, ownership and applicability rules for personal Connections."""

from configs import dify_config
from constants.end_user_connections import ConnectionCredentialType
from services.end_user_connections.entities import (
    ConnectionAccessRecord,
    ConnectionManagementContext,
    ConnectionMutationGuard,
    ToolConnectionTarget,
    WebConnectionContext,
)
from services.end_user_connections.errors import (
    ConnectionAccountRequiredError,
    ConnectionConfigurationError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
    ConnectionRevisionChangedError,
)


def require_personal_connection_access(context: ConnectionManagementContext) -> None:
    if context.account_id is None and not dify_config.END_USER_AUTH_ALLOW_ANONYMOUS:
        raise ConnectionAccountRequiredError()


def require_owned_connection(
    context: ConnectionManagementContext, record: ConnectionAccessRecord | None
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
        raise ConnectionRevisionChangedError()
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
    if credential_type == ConnectionCredentialType.OAUTH2 and (
        target.oauth_client is None or target.oauth_client.source != target.oauth_client_source
    ):
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
    if owned.credential_type == ConnectionCredentialType.OAUTH2:
        if (
            target.oauth_client is None
            or target.oauth_client.source != target.oauth_client_source
            or owned.oauth_client is None
            or not owned.oauth_client.same_credentials(target.oauth_client)
        ):
            raise ConnectionReauthorizationRequiredError()
    return owned


def connection_mutation_guard(
    context: ConnectionManagementContext, record: ConnectionAccessRecord | None
) -> ConnectionMutationGuard:
    owned = require_owned_connection(context, record)
    return ConnectionMutationGuard(
        connection_id=owned.id,
        tenant_id=owned.tenant_id,
        owner=owned.owner,
        revision=owned.revision,
    )
