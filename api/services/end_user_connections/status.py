"""Project credential and selection state for one Tool node without modifying either."""

from constants.end_user_connections import ConnectionCredentialStatus, NodeConnectionStatus
from services.end_user_connections.entities import (
    ConnectionAccessRecord,
    ConnectionCheckSnapshot,
    NodeConnectionSelection,
    ToolConnectionTarget,
    WebConnectionContext,
)
from services.end_user_connections.errors import (
    ConnectionCheckUnavailableError,
    ConnectionConflictError,
    ConnectionNotFoundError,
    ConnectionReauthorizationRequiredError,
)
from services.end_user_connections.policy import (
    require_applicable_connection,
    require_owned_connection,
    require_target_reference,
)


def resolve_node_connection_status(
    context: WebConnectionContext,
    *,
    selection: NodeConnectionSelection,
    target: ToolConnectionTarget,
    record: ConnectionAccessRecord | None,
    check: ConnectionCheckSnapshot | None,
) -> NodeConnectionStatus:
    """Evaluate the explicit selection against its effective node configuration.

    The caller resolves the target and loads the selected row under the owner scope.
    Return only the effective status without modifying the record or check. Missing
    and foreign selections are disconnected. A check must match its original ID and
    revision; mismatches raise ConnectionConflictError. Unperformed or transient
    checks on a usable credential raise ConnectionCheckUnavailableError. No App
    default or previously saved Session choice is a fallback.
    """
    require_target_reference(context, workflow_id=selection.workflow_id, node_id=selection.node_id, target=target)
    if selection.connection_id is None or record is None or record.id != selection.connection_id:
        return NodeConnectionStatus.DISCONNECTED
    try:
        owned = require_owned_connection(context, record)
    except ConnectionNotFoundError:
        return NodeConnectionStatus.DISCONNECTED

    if check is not None and (check.connection_id != owned.id or check.revision != owned.revision):
        raise ConnectionConflictError()
    result = check.result if check is not None else None
    try:
        require_applicable_connection(
            context, owned, workflow_id=selection.workflow_id, node_id=selection.node_id, target=target
        )
    except ConnectionReauthorizationRequiredError:
        return NodeConnectionStatus.RECONNECT_REQUIRED
    if owned.credential_status == ConnectionCredentialStatus.INVALID or (
        result is not None and result.status == "invalid"
    ):
        return NodeConnectionStatus.INVALID
    if owned.credential_status == ConnectionCredentialStatus.RECONNECT_REQUIRED:
        return NodeConnectionStatus.RECONNECT_REQUIRED
    if result is None or result.status == "temporarily_unavailable":
        raise ConnectionCheckUnavailableError()
    return NodeConnectionStatus.CONNECTED
