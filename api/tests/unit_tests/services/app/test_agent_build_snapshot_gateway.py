"""Verify how the Build snapshot gateway translates Agent client failures."""

from typing import override

import pytest
from dify_agent.client import Client, DifyAgentTimeoutError
from dify_agent.protocol import CreateHomeSnapshotFromBindingRequest, HomeSnapshotResponse

from services.app.agent_build_session_store import AgentBuildSnapshotFailedError
from services.app.agent_build_snapshot_gateway import checkpoint_build_home


def test_checkpoint_build_home_translates_client_timeout() -> None:
    """Translate a checkpoint timeout into a Build failure with the original cause."""
    timeout = DifyAgentTimeoutError("Checkpoint timed out")

    class TimingOutClient(Client):
        @override
        def create_home_snapshot_from_binding_sync(
            self, request: CreateHomeSnapshotFromBindingRequest
        ) -> HomeSnapshotResponse:
            """Raise the timeout on the expected checkpoint call without opening a connection."""
            assert request.backend_binding_ref == "build-binding"
            raise timeout

    with pytest.raises(AgentBuildSnapshotFailedError, match="^Checkpoint timed out$") as exc_info:
        checkpoint_build_home(
            lambda: TimingOutClient(base_url="http://agent.example"),
            tenant_id="tenant",
            agent_id="agent",
            backend_binding_ref="build-binding",
        )

    assert exc_info.value.__cause__ is timeout
