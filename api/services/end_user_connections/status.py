"""Project credential and selection state for one Tool node without modifying either."""

from constants.end_user_connections import ConnectionCredentialStatus, NodeConnectionStatus
from services.end_user_connections.contracts import NodeConnectionState
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


def resolve_node_connection_state(
    context: WebConnectionContext,
    *,
    selection: NodeConnectionSelection,
    target: ToolConnectionTarget,
    record: ConnectionAccessRecord | None,
    check: ConnectionCheckSnapshot | None,
) -> NodeConnectionState:
    """Evaluate the explicit selection against its effective node configuration.

    The caller resolves the target and loads the selected row under the owner scope.
    Missing and foreign selections are indistinguishable; neither exposes another
    owner's status or check metadata. A check can only describe its original ID and
    revision. No App default or previously saved Session choice is a fallback.
    """
    require_target_reference(context, workflow_id=selection.workflow_id, node_id=selection.node_id, target=target)
    disconnected = NodeConnectionState(
        workflow_id=selection.workflow_id,
        node_id=selection.node_id,
        connection_id=None,
        status=NodeConnectionStatus.DISCONNECTED,
        check=None,
    )
    if selection.connection_id is None or record is None or record.id != selection.connection_id:
        return disconnected
    try:
        owned = require_owned_connection(context, record)
    except ConnectionNotFoundError:
        return disconnected

    if check is not None and (check.connection_id != owned.id or check.revision != owned.revision):
        raise ConnectionConflictError()
    result = check.result if check is not None else None
    try:
        require_applicable_connection(
            context, owned, workflow_id=selection.workflow_id, node_id=selection.node_id, target=target
        )
    except ConnectionReauthorizationRequiredError:
        status = NodeConnectionStatus.RECONNECT_REQUIRED
    else:
        if owned.credential_status == ConnectionCredentialStatus.INVALID or (
            result is not None and result.status == "invalid"
        ):
            status = NodeConnectionStatus.INVALID
        elif owned.credential_status == ConnectionCredentialStatus.RECONNECT_REQUIRED:
            status = NodeConnectionStatus.RECONNECT_REQUIRED
        elif result is None or result.status == "temporarily_unavailable":
            raise ConnectionCheckUnavailableError()
        else:
            # A Provider that cannot check credentials does not invalidate a known
            # usable grant. The unsupported result stays visible to the caller.
            status = NodeConnectionStatus.CONNECTED

    return NodeConnectionState(
        workflow_id=selection.workflow_id,
        node_id=selection.node_id,
        connection_id=owned.id,
        status=status,
        check=result,
    )
