import pytest

from core.plugin.impl.tool import PluginToolManager
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.tool_manager import ToolManager
from services.tools import tool_sources
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.tool_sources import ToolSource, resolve_tool
from services.tools.workflow_tools_manage_service import WorkflowToolManageService

TENANT_ID = "tenant-1"
USER_ID = "user-1"


def test_members_and_values_are_unchanged() -> None:
    assert [(s.name, str(s)) for s in ToolSource] == [
        ("BUILTIN", "builtin"),
        ("WORKFLOW", "workflow"),
        ("API", "api"),
        ("MCP", "mcp"),
    ]


def test_plugin_nodes_are_served_by_the_builtin_source() -> None:
    assert ToolSource.of_node(ToolProviderType.PLUGIN) is ToolSource.BUILTIN


@pytest.mark.parametrize("source", list(ToolSource))
def test_node_provider_type_of_each_source_maps_back_to_it(source: ToolSource) -> None:
    assert ToolSource.of_node(str(source)) is source


@pytest.mark.parametrize("provider_type", ["app", "dataset-retrieval", "", "nope"])
def test_unlistable_node_provider_types_have_no_source(provider_type: str) -> None:
    assert ToolSource.of_node(provider_type) is None


def test_each_source_lists_through_its_own_service(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, tuple]] = []

    def recorder(name: str):
        def record(*args: str) -> list:
            calls.append((name, args))
            return []

        return record

    monkeypatch.setattr(BuiltinToolManageService, "list_builtin_tools", recorder("builtin"))
    monkeypatch.setattr(WorkflowToolManageService, "list_tenant_workflow_tools", recorder("workflow"))
    monkeypatch.setattr(ApiToolManageService, "list_api_tools", recorder("api"))

    for source in (ToolSource.BUILTIN, ToolSource.WORKFLOW, ToolSource.API):
        assert source.list_providers(tenant_id=TENANT_ID, user_id=USER_ID) == []

    assert calls == [
        ("builtin", (USER_ID, TENANT_ID)),
        ("workflow", (USER_ID, TENANT_ID)),
        ("api", (TENANT_ID,)),
    ]


def test_resolve_a_builtin_tool_returns_its_declared_parameters() -> None:
    tool = resolve_tool(
        tenant_id=TENANT_ID, provider_type=ToolProviderType.BUILT_IN, provider_id="time", tool_name="current_time"
    )

    assert tool is not None
    assert tool.name == "current_time"
    assert [(p.name, str(p.form), p.default) for p in tool.parameters or []] == [
        ("format", "form", "%Y-%m-%d %H:%M:%S"),
        ("timezone", "form", "UTC"),
    ]


def test_resolve_an_unknown_tool_of_a_known_provider_is_none() -> None:
    assert resolve_tool(tenant_id=TENANT_ID, provider_type="builtin", provider_id="time", tool_name="nope") is None


def test_resolve_an_unknown_provider_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(PluginToolManager, "fetch_tool_provider", lambda _self, _tenant_id, _provider: None)

    assert resolve_tool(tenant_id=TENANT_ID, provider_type="builtin", provider_id="nope", tool_name="x") is None


def test_resolve_a_missing_api_provider_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    def not_found(_tenant_id: str, provider_id: str):
        raise tool_sources.ToolProviderNotFoundError(provider_id)

    monkeypatch.setattr(ToolManager, "get_api_provider_controller", not_found)

    assert resolve_tool(tenant_id=TENANT_ID, provider_type="api", provider_id="p", tool_name="x") is None


def test_resolve_an_unlistable_provider_type_is_none() -> None:
    assert resolve_tool(tenant_id=TENANT_ID, provider_type="app", provider_id="p", tool_name="x") is None


def test_resolve_never_builds_a_tool_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*_args: object, **_kwargs: object):
        raise AssertionError("get_tool_runtime decrypts credentials")

    monkeypatch.setattr(ToolManager, "get_tool_runtime", forbidden)

    assert resolve_tool(tenant_id=TENANT_ID, provider_type="builtin", provider_id="time", tool_name="weekday")
