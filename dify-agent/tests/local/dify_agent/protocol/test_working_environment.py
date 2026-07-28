import pytest
from pydantic import ValidationError

from dify_agent.protocol import (
    CreateExecutionBindingRequest,
    CreateHomeSnapshotFromBindingRequest,
    DestroyExecutionBindingRequest,
    WorkspaceListRequest,
)


def test_execution_binding_request_uses_opaque_backend_refs() -> None:
    request = CreateExecutionBindingRequest(
        tenant_id="tenant-1",
        agent_id="agent-1",
        binding_id="binding-1",
        workspace_id="workspace-1",
        existing_workspace_ref="opaque-workspace",
        home_snapshot_ref="opaque-home",
    )

    assert request.model_dump() == {
        "tenant_id": "tenant-1",
        "agent_id": "agent-1",
        "binding_id": "binding-1",
        "workspace_id": "workspace-1",
        "existing_workspace_ref": "opaque-workspace",
        "home_snapshot_ref": "opaque-home",
    }


def test_destroy_workspace_requires_workspace_ref() -> None:
    with pytest.raises(ValidationError, match="workspace_ref"):
        DestroyExecutionBindingRequest(binding_ref="binding-1", destroy_workspace=True)


def test_snapshot_and_file_requests_locate_binding_directly() -> None:
    snapshot = CreateHomeSnapshotFromBindingRequest(
        tenant_id="tenant-1",
        agent_id="agent-1",
        home_snapshot_id="home-2",
        backend_binding_ref="binding-ref",
    )
    listing = WorkspaceListRequest(backend_binding_ref="binding-ref", path="~/files")

    assert snapshot.backend_binding_ref == "binding-ref"
    assert listing.path == "~/files"
