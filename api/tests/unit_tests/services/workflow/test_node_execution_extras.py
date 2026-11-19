import json
from dataclasses import dataclass
from unittest.mock import Mock

import pytest

from constants.trigger import TRIGGER_PLUGIN_NODE_TYPE
from core.plugin.impl.trigger import PluginTriggerClient
from core.tools.entities.tool_entities import ToolProviderType
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from models.utils.trigger_endpoint import generate_trigger_plugin_icon_url
from models.workflow import WorkflowNodeExecutionModel
from services.tools.tool_manager import ToolManager
from services.workflow.node_execution_extras import node_execution_extras


@dataclass
class _ToolProviderIconsStub:
    def icon(self, *, tenant_id: str, provider_type: ToolProviderType, provider_id: str) -> str | None:
        del tenant_id, provider_type, provider_id
        return None


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
    tool_providers = _ToolProviderIconsStub()
    execution = _execution(
        node_type=BuiltinNodeTypes.TOOL,
        metadata={"tool_info": {"provider_type": provider_type, "provider_id": "acme/calendar/calendar"}},
    )

    def get_tool_icon(**kwargs: object) -> str:
        assert kwargs == {
            "tenant_id": "tenant-1",
            "provider_type": provider_type,
            "provider_id": "acme/calendar/calendar",
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

    assert node_execution_extras(execution, tool_providers=_ToolProviderIconsStub()) == {"icon": "datasource-icon"}


def test_trigger_extras_resolve_plugin_icon(monkeypatch: pytest.MonkeyPatch) -> None:
    execution = _execution(
        node_type=TRIGGER_PLUGIN_NODE_TYPE,
        metadata={WorkflowNodeExecutionMetadataKey.TRIGGER_INFO: {"provider_id": "acme/calendar/calendar"}},
    )

    provider = Mock()
    provider.declaration.identity.icon = "icon.svg"
    fetch = Mock(return_value=provider)
    monkeypatch.setattr(PluginTriggerClient, "fetch_trigger_provider", fetch)
    assert node_execution_extras(execution, tool_providers=_ToolProviderIconsStub()) == {
        "icon": generate_trigger_plugin_icon_url("tenant-1", "icon.svg")
    }
    assert fetch.call_args.args[0] == "tenant-1"


def test_extras_are_empty_without_supported_metadata() -> None:
    execution = _execution(node_type=BuiltinNodeTypes.TOOL, metadata={})

    assert node_execution_extras(execution, tool_providers=_ToolProviderIconsStub()) == {}
