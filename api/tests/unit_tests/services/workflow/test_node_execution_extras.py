import json
from typing import cast

import pytest

from core.tools.entities.tool_entities import ToolProviderType
from core.trigger.constants import TRIGGER_PLUGIN_NODE_TYPE
from core.trigger.trigger_manager import TriggerManager
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from models.workflow import WorkflowNodeExecutionModel
from services.tools.provider_queries import ToolProviderIcons
from services.tools.tool_manager import ToolManager
from services.workflow.node_execution_extras import node_execution_extras


def _execution(*, node_type: str, metadata: dict[str, object]) -> WorkflowNodeExecutionModel:
    return WorkflowNodeExecutionModel(
        tenant_id="tenant-1",
        node_type=node_type,
        execution_metadata=json.dumps(metadata),
    )


@pytest.mark.parametrize(
    ("provider_type", "expected"),
    [
        (ToolProviderType.BUILT_IN, {"icon": "tool-icon"}),
        (ToolProviderType.WORKFLOW, {"workflow_tool": True, "icon": "tool-icon"}),
    ],
)
def test_tool_extras_use_injected_provider_icons(
    monkeypatch: pytest.MonkeyPatch,
    provider_type: ToolProviderType,
    expected: dict[str, object],
) -> None:
    tool_providers = cast(ToolProviderIcons, object())
    execution = _execution(
        node_type=BuiltinNodeTypes.TOOL,
        metadata={"tool_info": {"provider_type": provider_type, "provider_id": "provider-1"}},
    )

    def get_tool_icon(**kwargs: object) -> str:
        assert kwargs == {
            "tenant_id": "tenant-1",
            "provider_type": provider_type,
            "provider_id": "provider-1",
            "tool_providers": tool_providers,
        }
        return "tool-icon"

    monkeypatch.setattr(ToolManager, "get_tool_icon", get_tool_icon)

    assert node_execution_extras(execution, tool_providers=tool_providers) == expected


def test_datasource_extras_preserve_persisted_icon() -> None:
    execution = _execution(
        node_type=BuiltinNodeTypes.DATASOURCE,
        metadata={"datasource_info": {"icon": "datasource-icon"}},
    )

    assert node_execution_extras(execution, tool_providers=cast(ToolProviderIcons, object())) == {
        "icon": "datasource-icon"
    }


def test_trigger_extras_resolve_plugin_icon(monkeypatch: pytest.MonkeyPatch) -> None:
    execution = _execution(
        node_type=TRIGGER_PLUGIN_NODE_TYPE,
        metadata={WorkflowNodeExecutionMetadataKey.TRIGGER_INFO: {"provider_id": "provider-1"}},
    )

    def get_trigger_plugin_icon(*, tenant_id: str, provider_id: str) -> str:
        assert (tenant_id, provider_id) == ("tenant-1", "provider-1")
        return "trigger-icon"

    monkeypatch.setattr(TriggerManager, "get_trigger_plugin_icon", get_trigger_plugin_icon)

    assert node_execution_extras(execution, tool_providers=cast(ToolProviderIcons, object())) == {
        "icon": "trigger-icon"
    }


def test_extras_are_empty_without_supported_metadata() -> None:
    execution = _execution(node_type=BuiltinNodeTypes.TOOL, metadata={})

    assert node_execution_extras(execution, tool_providers=cast(ToolProviderIcons, object())) == {}
