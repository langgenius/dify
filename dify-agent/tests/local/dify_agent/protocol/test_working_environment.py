import pytest
from pydantic import ValidationError

from dify_agent.protocol import (
    BindingFileListRequest,
    BindingFileReadRequest,
    CreateExecutionBindingRequest,
    CreateHomeSnapshotFromBindingRequest,
    DestroyExecutionBindingRequest,
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


def test_execution_binding_request_accepts_missing_or_null_home_snapshot_ref() -> None:
    fields = {
        "tenant_id": "tenant-1",
        "agent_id": "agent-1",
        "binding_id": "binding-1",
        "workspace_id": "workspace-1",
    }

    assert CreateExecutionBindingRequest(**fields).home_snapshot_ref is None
    assert CreateExecutionBindingRequest(**fields, home_snapshot_ref=None).home_snapshot_ref is None


def test_execution_binding_request_rejects_empty_home_snapshot_ref() -> None:
    with pytest.raises(ValidationError, match="home_snapshot_ref"):
        CreateExecutionBindingRequest(
            tenant_id="tenant-1",
            agent_id="agent-1",
            binding_id="binding-1",
            workspace_id="workspace-1",
            home_snapshot_ref="",
        )


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
    listing = BindingFileListRequest(backend_binding_ref="binding-ref", path="~/files")

    assert snapshot.backend_binding_ref == "binding-ref"
    assert listing.path == "~/files"


def test_binding_file_read_preview_uses_bounded_default_and_limit() -> None:
    assert BindingFileReadRequest(backend_binding_ref="binding-ref", path="report.txt").max_bytes == 262144
    assert (
        BindingFileReadRequest(
            backend_binding_ref="binding-ref",
            path="report.txt",
            max_bytes=262144,
        ).max_bytes
        == 262144
    )

    with pytest.raises(ValidationError, match="max_bytes"):
        BindingFileReadRequest(
            backend_binding_ref="binding-ref",
            path="report.txt",
            max_bytes=262145,
        )
