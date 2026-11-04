import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import NoReturn
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from contexts.wrapper import RecyclableContextVar
from core.plugin.entities.plugin_daemon import PluginToolProviderEntity
from core.plugin.impl.tool import PluginToolManager
from core.tools import tool_manager
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import (
    ApiProviderSchemaType,
    ToolEntity,
    ToolIdentity,
    ToolParameter,
    ToolProviderEntityWithPlugin,
    ToolProviderIdentity,
    ToolProviderType,
)
from core.tools.tool_manager import ToolManager
from graphon.enums import BuiltinNodeTypes
from models.model import AppMode
from models.tools import ApiToolProvider, MCPToolProvider, WorkflowToolProvider
from services.tools import tool_sources
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.mcp_tools_manage_service import MCPToolManageService
from services.tools.tool_sources import ToolSource, resolve_tool
from services.tools.workflow_tools_manage_service import WorkflowToolManageService
from tests.helpers.unit.model_factories import make_account, make_app, make_workflow

TENANT_ID = "tenant-1"
USER_ID = "user-1"


class _FakeSession:
    def __enter__(self) -> "_FakeSession":
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


class _FakeSessionFactory:
    @staticmethod
    def create_session() -> _FakeSession:
        return _FakeSession()


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
    calls: list[tuple[str, tuple[object, ...]]] = []

    def recorder(name: str) -> Callable[..., list[ToolProviderApiEntity]]:
        def record(*args: str) -> list[ToolProviderApiEntity]:
            calls.append((name, args))
            return []

        return record

    monkeypatch.setattr(BuiltinToolManageService, "list_builtin_tools", recorder("builtin"))
    monkeypatch.setattr(WorkflowToolManageService, "list_tenant_workflow_tools", recorder("workflow"))
    monkeypatch.setattr(ApiToolManageService, "list_api_tools", recorder("api"))

    def list_mcp(
        _self: MCPToolManageService, *, tenant_id: str, include_sensitive: bool
    ) -> list[ToolProviderApiEntity]:
        calls.append(("mcp", (tenant_id, include_sensitive)))
        return []

    monkeypatch.setattr(MCPToolManageService, "list_providers", list_mcp)
    monkeypatch.setattr(tool_sources, "session_factory", _FakeSessionFactory())

    for source in ToolSource:
        assert source.list_providers(tenant_id=TENANT_ID, user_id=USER_ID) == []

    assert calls == [
        ("builtin", (USER_ID, TENANT_ID)),
        ("workflow", (USER_ID, TENANT_ID)),
        ("api", (TENANT_ID,)),
        ("mcp", (TENANT_ID, False)),
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
    def not_found(_tenant_id: str, provider_id: str) -> NoReturn:
        raise tool_sources.ToolProviderNotFoundError(provider_id)

    monkeypatch.setattr(ToolManager, "get_api_provider_controller", not_found)

    assert resolve_tool(tenant_id=TENANT_ID, provider_type="api", provider_id="p", tool_name="x") is None


def test_resolve_an_unlistable_provider_type_is_none() -> None:
    assert resolve_tool(tenant_id=TENANT_ID, provider_type="app", provider_id="p", tool_name="x") is None


def test_resolve_never_builds_a_tool_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("get_tool_runtime decrypts credentials")

    monkeypatch.setattr(ToolManager, "get_tool_runtime", forbidden)

    assert resolve_tool(tenant_id=TENANT_ID, provider_type="builtin", provider_id="time", tool_name="weekday")


def test_a_malformed_provider_is_not_reported_as_an_unknown_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(_tenant_id: str, _provider_id: str) -> NoReturn:
        raise ValidationError.from_exception_data("Provider", [])

    monkeypatch.setattr(ToolManager, "get_mcp_provider_controller", broken)

    with pytest.raises(ValidationError):
        resolve_tool(tenant_id=TENANT_ID, provider_type="mcp", provider_id="p", tool_name="x")


def _declared(tool: ToolApiEntity | None) -> list[tuple[str, str, bool]]:
    assert tool is not None
    return [(p.name, str(p.form), p.required) for p in tool.parameters or []]


def _parameter(name: str, form: ToolParameter.ToolParameterForm) -> ToolParameter:
    return ToolParameter(
        name=name,
        label=I18nObject(en_US=name),
        human_description=I18nObject(en_US=name),
        type=ToolParameter.ToolParameterType.STRING,
        form=form,
        llm_description=name,
        required=True,
    )


def test_resolve_a_plugin_tool_returns_its_declared_parameters(monkeypatch: pytest.MonkeyPatch) -> None:
    # A new request context, so no controller another test cached is served.
    RecyclableContextVar.increment_thread_recycles()
    plugin_id = "acme/search"
    declaration = ToolProviderEntityWithPlugin(
        identity=ToolProviderIdentity(
            author="acme",
            name="search",
            description=I18nObject(en_US="Search"),
            icon="icon.svg",
            label=I18nObject(en_US="Search"),
        ),
        credentials_schema=[],
        plugin_id=plugin_id,
        tools=[
            ToolEntity(
                identity=ToolIdentity(
                    author="acme", name="web_search", label=I18nObject(en_US="Web search"), provider="search"
                ),
                parameters=[
                    _parameter("query", ToolParameter.ToolParameterForm.LLM),
                    _parameter("region", ToolParameter.ToolParameterForm.FORM),
                ],
            )
        ],
    )

    def fetch_tool_provider(_self: PluginToolManager, _tenant_id: str, _provider: str) -> PluginToolProviderEntity:
        return PluginToolProviderEntity(
            provider="search",
            plugin_unique_identifier=f"{plugin_id}:1.0.0@{'a' * 32}",
            plugin_id=plugin_id,
            declaration=declaration,
        )

    monkeypatch.setattr(PluginToolManager, "fetch_tool_provider", fetch_tool_provider)

    tool = resolve_tool(
        tenant_id=TENANT_ID,
        provider_type=ToolProviderType.PLUGIN,
        provider_id=f"{plugin_id}/search",
        tool_name="web_search",
    )

    assert _declared(tool) == [("query", "llm", True), ("region", "form", True)]


def test_resolve_a_workflow_tool_returns_its_declared_parameters(sqlite_session: Session) -> None:
    account = make_account(account_id=None)
    app = make_app(app_id=str(uuid4()), tenant_id=TENANT_ID, mode=AppMode.WORKFLOW)
    start = {
        "id": "start",
        "data": {
            "type": BuiltinNodeTypes.START,
            "variables": [{"variable": "topic", "label": "Topic", "type": "text-input", "required": True}],
        },
    }
    workflow = make_workflow(
        tenant_id=TENANT_ID, app_id=app.id, version="1", graph={"nodes": [start], "edges": []}, created_by=account.id
    )
    provider = WorkflowToolProvider(
        name="summarize",
        label="Summarize",
        icon="icon.svg",
        app_id=app.id,
        version="1",
        user_id=account.id,
        tenant_id=TENANT_ID,
        description="Summarize a topic",
        parameter_configuration=json.dumps([{"name": "topic", "description": "The topic", "form": "llm"}]),
    )
    sqlite_session.add_all([account, app, workflow, provider])
    sqlite_session.commit()

    tool = resolve_tool(
        tenant_id=TENANT_ID, provider_type=ToolProviderType.WORKFLOW, provider_id=provider.id, tool_name="summarize"
    )

    assert _declared(tool) == [("topic", "llm", True)]


@dataclass(frozen=True)
class _Database:
    session: scoped_session[Session]
    engine: Engine


@pytest.fixture
def tool_manager_db(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> Iterator[None]:
    """ToolManager reads API and MCP providers through Flask-SQLAlchemy's `db`; serve it from SQLite."""
    session = scoped_session(sqlite_session_factory)
    monkeypatch.setattr(tool_manager, "db", _Database(session=session, engine=sqlite_engine))
    yield
    session.remove()


@pytest.mark.usefixtures("tool_manager_db")
def test_resolve_an_api_tool_returns_its_declared_parameters(sqlite_session: Session) -> None:
    bundle = ApiToolBundle(
        server_url="https://api.example.com/items",
        method="GET",
        summary="List items",
        operation_id="list_items",
        parameters=[_parameter("query", ToolParameter.ToolParameterForm.LLM)],
        author="author",
        openapi={"parameters": []},
    )
    provider = ApiToolProvider(
        name="items",
        icon="icon.svg",
        schema="{}",
        schema_type_str=ApiProviderSchemaType.OPENAPI,
        user_id=str(uuid4()),
        tenant_id=TENANT_ID,
        description="Items",
        tools_str=json.dumps([bundle.model_dump(mode="json")]),
        credentials_str='{"auth_type":"none"}',
    )
    sqlite_session.add(provider)
    sqlite_session.commit()

    tool = resolve_tool(
        tenant_id=TENANT_ID, provider_type=ToolProviderType.API, provider_id=provider.id, tool_name="list_items"
    )

    assert _declared(tool) == [("query", "llm", True)]


@pytest.mark.usefixtures("tool_manager_db")
def test_resolve_an_mcp_tool_returns_its_declared_parameters(sqlite_session: Session) -> None:
    remote_tool = {
        "name": "lookup",
        "description": "Look a word up",
        "inputSchema": {
            "type": "object",
            "properties": {"word": {"type": "string", "description": "The word"}},
            "required": ["word"],
        },
    }
    provider = MCPToolProvider(
        name="Dictionary",
        server_identifier="dictionary",
        server_url="https://mcp.example.com",
        server_url_hash="server-url-hash",
        icon="icon.svg",
        tenant_id=TENANT_ID,
        user_id=str(uuid4()),
        encrypted_credentials="{}",
        authed=True,
        tools=json.dumps([remote_tool]),
        timeout=30,
        sse_read_timeout=300,
        encrypted_headers="{}",
    )
    sqlite_session.add(provider)
    sqlite_session.commit()

    tool = resolve_tool(
        tenant_id=TENANT_ID, provider_type=ToolProviderType.MCP, provider_id="dictionary", tool_name="lookup"
    )

    assert _declared(tool) == [("word", "llm", True)]
