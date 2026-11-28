from __future__ import annotations

from unittest.mock import patch

import pytest

from core.tools.tool_manager import ToolManager
from core.workflow.node_runtime import DifyToolNodeRuntime
from graphon.nodes.tool.entities import ToolNodeData, ToolProviderType
from graphon.nodes.tool.exc import ToolRuntimeResolutionError
from tests.workflow_test_utils import build_test_graph_init_params, build_test_variable_pool


def _build_tool_node_data() -> ToolNodeData:
    return ToolNodeData.model_validate(
        {
            "type": "tool",
            "title": "Tool",
            "provider_id": "provider",
            "provider_type": ToolProviderType.BUILT_IN,
            "provider_name": "provider",
            "tool_name": "lookup",
            "tool_label": "Lookup",
            "tool_configurations": {},
            "tool_parameters": {},
        }
    )


@pytest.mark.parametrize("source", ["end_user", "reuse_node", "invalid", None])
def test_missing_execution_graph_cannot_fall_back_to_workspace_credentials(source: object) -> None:
    params = build_test_graph_init_params()
    runtime = DifyToolNodeRuntime(params.run_context)
    data = ToolNodeData.model_validate(
        {
            **_build_tool_node_data().model_dump(),
            "credential_id": "old-workspace-credential",
            "credential_source": source,
        }
    )

    with patch.object(ToolManager, "get_workflow_tool_runtime") as get_runtime:
        with pytest.raises(ToolRuntimeResolutionError, match="execution graph"):
            runtime.get_runtime(node_id="personal", node_data=data, variable_pool=None)

    get_runtime.assert_not_called()


def test_node_factory_keeps_dify_credential_source_from_the_execution_graph() -> None:
    from core.workflow.node_factory import DifyNodeFactory
    from graphon.runtime import RuntimeState

    data = _build_tool_node_data().model_dump(mode="json")
    data["credential_source"] = "end_user"
    params = build_test_graph_init_params(graph_config={"nodes": [{"id": "personal", "data": data}]})
    factory = DifyNodeFactory(
        params, RuntimeState(variable_pool=build_test_variable_pool(), start_at=0, workflow_id=params.workflow_id)
    )
    node = factory.create_node({"id": "personal", "data": data})
    data["credential_source"] = "workspace"
    assert isinstance(node.node_data, ToolNodeData)

    with patch.object(ToolManager, "get_workflow_tool_runtime") as get_runtime:
        with pytest.raises(ToolRuntimeResolutionError, match="connection"):
            factory._tool_runtime.get_runtime(node_id="personal", node_data=node.node_data, variable_pool=None)

    get_runtime.assert_not_called()
