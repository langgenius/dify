import pytest

from dify_agent.runtime_backend import ExecutionBindingCreateSpec, InitializeHomeSnapshotSpec
from dify_agent.runtime_backend.enterprise import EnterpriseExecutionBindingBackend, EnterpriseHomeSnapshotBackend


@pytest.mark.anyio
async def test_enterprise_working_environment_is_explicitly_not_implemented() -> None:
    snapshots = EnterpriseHomeSnapshotBackend(gateway_endpoint="https://gateway", auth_token="secret")
    bindings = EnterpriseExecutionBindingBackend(gateway_endpoint="https://gateway", auth_token="secret")

    with pytest.raises(NotImplementedError, match="Execution Binding protocol"):
        await snapshots.initialize(
            InitializeHomeSnapshotSpec(tenant_id="tenant-1", agent_id="agent-1", home_snapshot_id="home-1")
        )
    with pytest.raises(NotImplementedError, match="Execution Binding protocol"):
        await bindings.create_binding(
            ExecutionBindingCreateSpec(
                tenant_id="tenant-1",
                agent_id="agent-1",
                binding_id="binding-1",
                workspace_id="workspace-1",
                existing_workspace_ref=None,
                home_snapshot_ref="snapshot-1",
            )
        )
