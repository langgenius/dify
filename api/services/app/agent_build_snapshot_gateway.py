"""Checkpoint the prepared Build Sandbox through the Agent backend."""

import logging
from collections.abc import Callable
from http import HTTPStatus

from dify_agent.client import Client, DifyAgentClientError, DifyAgentHTTPError, DifyAgentNotFoundError
from dify_agent.protocol import CreateHomeSnapshotFromBindingRequest

from clients.agent_backend.errors import backend_error_detail, backend_reported_failure
from libs.uuid_utils import uuidv7
from services.app.agent_build_session_store import (
    AgentBuildBindingUnavailableError,
    AgentBuildHomeSnapshot,
    AgentBuildSandbox,
    AgentBuildSnapshotFailedError,
    AgentBuildSnapshotTooLargeError,
)

logger = logging.getLogger(__name__)


def checkpoint_build_home(
    client_factory: Callable[[], Client], *, tenant_id: str, agent_id: str, backend_binding_ref: str
) -> AgentBuildHomeSnapshot | None:
    """Capture the resolved Sandbox's Home, or return None when checkpointing is unsupported."""
    home_snapshot_id = str(uuidv7())
    try:
        with client_factory() as client:
            response = client.create_home_snapshot_from_binding_sync(
                CreateHomeSnapshotFromBindingRequest(
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                    home_snapshot_id=home_snapshot_id,
                    backend_binding_ref=backend_binding_ref,
                )
            )
    except DifyAgentNotFoundError as exc:
        raise AgentBuildBindingUnavailableError() from exc
    except DifyAgentHTTPError as exc:
        if not backend_reported_failure(exc):
            logger.exception("Unreadable Home Snapshot response for agent %s", agent_id)
            raise AgentBuildSnapshotFailedError() from exc
        _, message = backend_error_detail(exc)
        if exc.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE:
            raise AgentBuildSnapshotTooLargeError(message) from exc
        raise AgentBuildSnapshotFailedError(message) from exc
    except DifyAgentClientError as exc:
        raise AgentBuildSnapshotFailedError(str(exc)) from exc
    if response.snapshot_ref is None:
        return None
    return AgentBuildHomeSnapshot(home_snapshot_id, response.snapshot_ref)


class AgentBuildSnapshotGateway:
    def __init__(self, client_factory: Callable[[], Client]) -> None:
        """Use the configured Agent client for checkpoint and compensation calls."""
        self._client_factory = client_factory

    def create(self, *, tenant_id: str, agent_id: str, sandbox: AgentBuildSandbox) -> AgentBuildHomeSnapshot | None:
        """Checkpoint the validated Build Sandbox using the detached backend binding reference."""
        return checkpoint_build_home(
            self._client_factory,
            tenant_id=tenant_id,
            agent_id=agent_id,
            backend_binding_ref=sandbox.backend_binding_ref,
        )

    def discard(self, snapshot: AgentBuildHomeSnapshot) -> None:
        """Best-effort removal after writeback definitively rejects the checkpoint."""
        try:
            with self._client_factory() as client:
                client.delete_home_snapshot_sync(snapshot.ref)
        except Exception:
            logger.exception("Could not remove rejected Build Home Snapshot %s", snapshot.id)
