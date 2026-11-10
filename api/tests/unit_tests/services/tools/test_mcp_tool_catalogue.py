"""Installed cached MCP definitions reach Builder and the ordinary native Tool adapter.

The database and schema converter are real. Discovery forbids network/decryption;
native execution uses a recording local transport, never a live MCP service.
"""

import json
from copy import deepcopy
from typing import NoReturn, NotRequired, TypedDict
from uuid import uuid4

import pytest
from sqlalchemy import delete, insert, update
from sqlalchemy.engine import Engine

from core.tools.tool_manager import ToolManager
from core.workflow.generator.tool_catalogue import (
    ToolCatalogueEntry,
    build_tool_catalogue,
    find_tool_entry,
    format_tool_builder_context,
    format_tool_catalogue,
)
from core.workflow.generator.types import GraphDict
from models.tools import MCPToolProvider
from services.dify_builder.agent import resources
from services.dify_builder.effect_disclosure import disclose
from services.dify_builder.resource_grounding import (
    ResourceBindingError,
    resource_fingerprint,
    validate_changed_resources,
)
from tests.unit_tests.services.dify_builder.installed_tool_inventory import (
    ACCOUNT_A,
    ACCOUNT_B,
    OTHER_TENANT_ID,
    TENANT_ID,
    FakeToolDaemon,
    bind_database,
    install_fake_daemon,
    record_sql,
)

SERVER = "owned-microsoft-docs"
ACTION = "microsoft_docs_search"
OUTPUT: dict[str, object] = {
    "type": "object",
    "properties": {"results": {"type": "array", "items": {"type": "string"}}},
}


class CachedDeclaration(TypedDict):
    name: str
    title: str
    description: str
    inputSchema: dict[str, object]
    outputSchema: NotRequired[dict[str, object]]


def definition() -> CachedDeclaration:
    return {
        "name": ACTION,
        "title": "Microsoft documentation search",
        "description": "Search Microsoft documentation using the user's question.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "The user's documentation question."}},
            "required": ["query"],
        },
        "outputSchema": deepcopy(OUTPUT),
    }


def add_provider(engine: Engine, *, tenant_id: str = TENANT_ID, authed: bool = True, tools: object = None) -> None:
    with engine.begin() as connection:
        connection.execute(
            insert(MCPToolProvider).values(
                id=str(uuid4()),
                tenant_id=tenant_id,
                user_id=ACCOUNT_B,
                name="Microsoft Docs (display only)",
                server_identifier=SERVER,
                server_url="encrypted-url-marker",
                server_url_hash="synthetic-hash",
                encrypted_headers='{"secret":"encrypted-header-marker"}',
                encrypted_credentials='{"secret":"encrypted-credential-marker"}',
                icon="docs.svg",
                authed=authed,
                tools=json.dumps([definition()] if tools is None else tools),
            )
        )


@pytest.fixture
def inventory(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> Engine:
    from core.entities.mcp_provider import MCPProviderEntity
    from services.tools.mcp_tools_manage_service import MCPToolManageService

    bind_database(monkeypatch, sqlite_engine)
    install_fake_daemon(monkeypatch, FakeToolDaemon())
    monkeypatch.setattr(resources, "_list_models", lambda _tenant: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant, _account: [])

    def forbidden(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("Discovery cannot decrypt, resolve credentials or contact MCP")

    for name in ("decrypt_server_url", "decrypt_headers", "decrypt_credentials", "retrieve_tokens"):
        monkeypatch.setattr(MCPProviderEntity, name, forbidden)
    monkeypatch.setattr(MCPToolManageService, "list_provider_tools", forbidden)
    monkeypatch.setattr(ToolManager, "get_mcp_provider_controller", forbidden)
    return sqlite_engine


def test_cached_mcp_discovery_reads_only_public_columns_and_exact_native_identity(inventory: Engine) -> None:
    add_provider(inventory)
    statements = record_sql(inventory)
    entries = build_tool_catalogue(TENANT_ID)
    entry = find_tool_entry(entries, SERVER, ACTION)
    assert entry is not None
    assert entry["provider_type"] == "mcp"
    assert entry["provider_label"] == "Microsoft Docs (display only)"
    assert entry["tool_label"] == "Microsoft documentation search"
    assert entry["output_schema"] == OUTPUT
    assert entry["input_schema"] == definition()["inputSchema"]
    assert json.dumps(definition()["inputSchema"]) in format_tool_builder_context(entry)
    assert [(p["name"], p["type"], p["required"]) for p in entry["parameters"]] == [("query", "string", True)]
    assert entry["parameters"][0]["llm_description"] == "The user's documentation question."
    prompt = format_tool_catalogue([entry])
    assert 'provider_type="mcp"' in prompt
    assert f'provider_id="{SERVER}"' in prompt
    queries = [sql.lower() for sql in statements if "tool_mcp_providers" in sql.lower()]
    assert queries
    assert all("tenant_id =" in sql for sql in queries)
    assert all(
        not any(secret in sql for secret in ("server_url", "encrypted_headers", "encrypted_credentials"))
        for sql in queries
    )
    assert "encrypted-" not in repr(entry)


def test_mcp_configuration_does_not_borrow_builtin_credentials(
    inventory: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_provider(inventory)

    def forbidden(*_args: object) -> NoReturn:
        raise AssertionError("MCP cannot use builtin credential visibility")

    monkeypatch.setattr(resources, "_authorized_providers", forbidden)
    refs = resources.list_tenant_resources(TENANT_ID).tools
    ref = next(ref for ref in refs if ref.id == f"{SERVER}/{ACTION}")
    assert ref.readiness == "ready"
    assert ref.binding["provider_type"] == "mcp"
    assert ref.availability["runtime"] == "unverified"
    with inventory.begin() as connection:
        connection.execute(update(MCPToolProvider).values(authed=False))
    current = resources.list_tenant_resources(TENANT_ID)
    revoked = next(item for item in current.tools if item.id == ref.id)
    assert revoked.readiness == "missing_config"
    assert resource_fingerprint(revoked) != resource_fingerprint(ref)


@pytest.mark.parametrize("mutation", ["foreign", "deleted", "schema", "input_schema", "revoked"])
def test_selected_mcp_binding_rejects_stale_or_foreign_declarations(inventory: Engine, mutation: str) -> None:
    add_provider(inventory)
    catalogue = resources.list_tenant_resources(TENANT_ID)
    ref = next((item for item in catalogue.tools if item.id == f"{SERVER}/{ACTION}"), None)
    assert ref is not None
    graph = bound_graph(build_tool_catalogue(TENANT_ID))
    with inventory.begin() as connection:
        if mutation == "foreign":
            connection.execute(update(MCPToolProvider).values(tenant_id=OTHER_TENANT_ID))
        elif mutation == "deleted":
            connection.execute(delete(MCPToolProvider))
        elif mutation == "revoked":
            connection.execute(update(MCPToolProvider).values(authed=False))
        else:
            changed = definition()
            if mutation == "input_schema":
                changed["inputSchema"]["additionalProperties"] = False
            else:
                changed["outputSchema"] = {"type": "object", "properties": {"unexpected": {"type": "string"}}}
            connection.execute(update(MCPToolProvider).values(tools=json.dumps([changed])))
    with pytest.raises(ResourceBindingError) as caught:
        validate_changed_resources(
            {"nodes": []},
            dict(graph),
            resources.list_tenant_resources(TENANT_ID),
            confirmed_ids=[f"tool:{ref.id}"],
            expected_fingerprints={f"tool:{ref.id}": resource_fingerprint(ref)},
        )
    assert caught.value.reason_code == (
        "resource_not_in_catalogue" if mutation in {"foreign", "deleted"} else "resource_catalogue_changed"
    )


def bound_graph(entries: list[ToolCatalogueEntry]) -> GraphDict:
    from services.workflow_generation.runner import WorkflowGenerator

    graph: GraphDict = {
        "nodes": [
            {
                "id": "start",
                "type": "custom",
                "position": {"x": 0, "y": 0},
                "data": {
                    "type": "start",
                    "title": "Start",
                    "variables": [
                        {
                            "variable": "question",
                            "label": "Question",
                            "type": "text-input",
                            "required": True,
                            "max_length": 200,
                        }
                    ],
                },
            },
            {
                "id": "search",
                "type": "custom",
                "position": {"x": 300, "y": 0},
                "data": {
                    "type": "tool",
                    "title": "Search docs",
                    "tool_configurations": {},
                    "tool_parameters": {"query": {"type": "mixed", "value": "{{#start.question#}}"}},
                },
            },
            {
                "id": "end",
                "type": "custom",
                "position": {"x": 600, "y": 0},
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [{"variable": "results", "value_selector": ["search", "results"]}],
                },
            },
        ],
        "edges": [
            {"id": "start-search", "type": "custom", "source": "start", "target": "search"},
            {"id": "search-end", "type": "custom", "source": "search", "target": "end"},
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    WorkflowGenerator._hydrate_tool_nodes(
        graph=graph,
        plan_nodes=[{"id": "search", "node_type": "tool", "tool": {"provider_id": SERVER, "tool_name": ACTION}}],
        tool_catalogue_entries=entries,
    )
    return graph


def test_mcp_catalogue_constructs_bound_graph_without_schema_or_identity_guesses(inventory: Engine) -> None:
    add_provider(inventory)
    graph = bound_graph(build_tool_catalogue(TENANT_ID))
    data = graph["nodes"][1]["data"]
    assert data["provider_type"] == "mcp"
    assert data["provider_id"] == SERVER
    assert data["tool_name"] == ACTION
    assert data["output_schema"] == OUTPUT
    assert data["tool_parameters"]["query"] == {"type": "mixed", "value": "{{#start.question#}}"}
    validate_changed_resources({"nodes": []}, dict(graph), resources.list_tenant_resources(TENANT_ID))
    data["tool_parameters"] = {"invented": {"type": "constant", "value": "wrong"}}
    with pytest.raises(ResourceBindingError, match="resource_configuration_incompatible"):
        validate_changed_resources({"nodes": []}, dict(graph), resources.list_tenant_resources(TENANT_ID))


def test_search_named_mcp_still_requires_explicit_confirmation() -> None:
    graph = {
        "nodes": [
            {
                "id": "search",
                "data": {"type": "tool", "provider_type": "mcp", "provider_id": SERVER, "tool_name": ACTION},
            }
        ]
    }
    disclosure = disclose(graph)
    assert disclosure.items[0].tier == "side_effect"
    assert disclosure.mocked_node_ids({}) == frozenset({"search"})
    assert disclosure.mocked_node_ids(disclosure.confirmation(["search"])) == frozenset()


def test_bound_mcp_graph_uses_native_tool_adapter_and_end_returns_transport_output(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import time
    from typing import Self

    import core.tools.mcp_tool.tool as mcp_module
    from core.entities.mcp_provider import MCPProviderEntity
    from core.mcp.types import CallToolResult, TextContent
    from extensions import ext_database
    from graphon.enums import WorkflowNodeExecutionStatus
    from graphon.graph.graph import Graph
    from graphon.node_events import StreamCompletedEvent
    from graphon.nodes.end.end_node import EndNode
    from graphon.nodes.start.start_node import StartNode
    from graphon.nodes.tool.tool_node import ToolNode
    from graphon.runtime import RuntimeState, VariablePool
    from services.dify_builder.agent.build import bind_resources
    from services.workflow_runtime.node_factory import DifyNodeFactory
    from tests.unit_tests.services.dify_builder.installed_tool_inventory import InventoryDatabase
    from tests.workflow_test_utils import build_test_graph_init_params

    bind_database(monkeypatch, sqlite_engine)
    monkeypatch.setattr(ext_database, "db", InventoryDatabase(sqlite_engine))
    install_fake_daemon(monkeypatch, FakeToolDaemon())
    monkeypatch.setattr(resources, "_list_models", lambda _tenant: [])
    monkeypatch.setattr(resources, "_list_datasets", lambda _tenant, _account: [])
    add_provider(sqlite_engine)
    plan = bind_resources(None, TENANT_ID, ["Search Microsoft documentation"], [f"{SERVER}/{ACTION}"])
    assert f"[{SERVER}/{ACTION}]" in plan[0]
    graph_config = bound_graph(build_tool_catalogue(TENANT_ID))
    calls: list[tuple[str, dict[str, object]]] = []

    class RecordingMCPTransport:
        def __init__(self, *, server_url: str, headers: dict[str, str], **_kwargs: object) -> None:
            assert server_url == "https://controlled-transport.invalid/mcp"
            assert headers == {}

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            pass

        def invoke_tool(self, *, tool_name: str, tool_args: dict[str, object]) -> CallToolResult:
            calls.append((tool_name, tool_args))
            return CallToolResult(
                content=[TextContent(type="text", text="Controlled documentation match")],
                structuredContent={"results": ["Controlled result from native MCP transport"]},
            )

    monkeypatch.setattr(mcp_module, "MCPClientWithAuthRetry", RecordingMCPTransport)
    monkeypatch.setattr(
        MCPProviderEntity, "decrypt_server_url", lambda _self: "https://controlled-transport.invalid/mcp"
    )
    monkeypatch.setattr(MCPProviderEntity, "decrypt_headers", lambda _self: {})
    monkeypatch.setattr(MCPProviderEntity, "retrieve_tokens", lambda _self: None)
    pool = VariablePool()
    pool.add(["start", "question"], "How does Azure work?")
    state = RuntimeState(workflow_id="controlled-workflow", variable_pool=pool, start_at=time.perf_counter())
    init = build_test_graph_init_params(tenant_id=TENANT_ID, user_id=ACCOUNT_A, graph_config=graph_config)
    factory = DifyNodeFactory(init_params=init, runtime_state=state)
    graph = Graph.init(graph_config=graph_config, node_factory=factory, root_node_id="start")
    start_node = graph.nodes["start"]
    assert isinstance(start_node, StartNode)
    start = start_node._run()
    assert start.outputs["question"] == "How does Azure work?"
    search = graph.nodes["search"]
    assert isinstance(search, ToolNode)
    search.bind_execution_id("controlled-search-execution")
    completed = [event.node_run_result for event in search._run() if isinstance(event, StreamCompletedEvent)]
    assert len(completed) == 1
    assert completed[0].status == WorkflowNodeExecutionStatus.SUCCEEDED, completed[0].error
    assert calls == [(ACTION, {"query": "How does Azure work?"})]
    assert completed[0].outputs["results"] == ["Controlled result from native MCP transport"]
    for name, value in completed[0].outputs.items():
        pool.add(["search", name], value)
    end_node = graph.nodes["end"]
    assert isinstance(end_node, EndNode)
    end = end_node._run()
    assert end.outputs == {"results": ["Controlled result from native MCP transport"]}


@pytest.mark.parametrize(
    "bad_tools", [None, [], [{"name": "bad", "inputSchema": {"type": "object", "properties": []}}]]
)
def test_empty_or_malformed_mcp_cache_never_fabricates_tools(inventory: Engine, bad_tools: object) -> None:
    add_tools = "null" if bad_tools is None else json.dumps(bad_tools)
    add_provider(inventory, tools=[])
    with inventory.begin() as connection:
        connection.execute(update(MCPToolProvider).values(tools=add_tools))
    assert all(entry["provider_type"] != "mcp" for entry in build_tool_catalogue(TENANT_ID))


@pytest.mark.usefixtures("inventory")
def test_mcp_inventory_failure_is_reported_without_losing_other_tool_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import core.workflow.generator.tool_catalogue as catalogue_module

    def unavailable(_tenant: str) -> NoReturn:
        raise RuntimeError("controlled metadata source failure")

    monkeypatch.setattr(catalogue_module, "list_mcp_tool_metadata", unavailable)
    failures: list[str] = []
    entries = build_tool_catalogue(TENANT_ID, on_source_error=failures.append)
    assert failures == ["mcp_tool_inventory"]
    assert any(entry["provider_name"] == "time" for entry in entries)
    current = resources.list_tenant_resources(TENANT_ID)
    assert current.tool_source_error == "inventory_unavailable"


@pytest.mark.parametrize("mutation", ["foreign", "deleted", "revoked"])
def test_native_mcp_adapter_rechecks_current_owned_provider_before_dispatch(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
) -> None:
    from core.workflow.node_runtime import DifyToolNodeRuntime
    from graphon.nodes.tool.entities import ToolNodeData
    from graphon.nodes.tool.exc import ToolRuntimeResolutionError
    from graphon.runtime import VariablePool
    from tests.workflow_test_utils import build_test_run_context

    bind_database(monkeypatch, sqlite_engine)
    add_provider(sqlite_engine)
    runtime = DifyToolNodeRuntime(build_test_run_context(tenant_id=TENANT_ID, user_id=ACCOUNT_A))
    node_data = ToolNodeData.model_validate(
        {
            "type": "tool",
            "title": "Search docs",
            "provider_id": SERVER,
            "provider_name": SERVER,
            "provider_type": "mcp",
            "tool_name": ACTION,
            "tool_label": "Search docs",
            "tool_parameters": {},
            "tool_configurations": {},
        }
    )
    # The ordinary native owner can initially resolve this exact installed action.
    runtime.get_runtime(node_id="search", node_data=node_data, variable_pool=VariablePool())
    with sqlite_engine.begin() as connection:
        if mutation == "foreign":
            connection.execute(update(MCPToolProvider).values(tenant_id=OTHER_TENANT_ID))
        elif mutation == "deleted":
            connection.execute(delete(MCPToolProvider))
        else:
            # Native revoke clears cached actions as well as cached auth state.
            connection.execute(update(MCPToolProvider).values(authed=False, tools="[]"))
    with pytest.raises(ToolRuntimeResolutionError):
        runtime.get_runtime(node_id="search", node_data=node_data, variable_pool=VariablePool())


def test_mcp_without_output_declaration_keeps_native_generic_outputs(inventory: Engine) -> None:
    tool = definition()
    tool.pop("outputSchema")
    add_provider(inventory, tools=[tool])
    entry = find_tool_entry(build_tool_catalogue(TENANT_ID), SERVER, ACTION)
    assert entry is not None
    assert entry["output_schema"] == {}
    ref = next(item for item in resources.list_tenant_resources(TENANT_ID).tools if item.id == f"{SERVER}/{ACTION}")
    assert ref.output_schema_state == "absent"
    assert bound_graph([entry])["nodes"][1]["data"]["output_schema"] == {}


def test_mcp_destructive_evidence_remains_unconfirmable() -> None:
    graph = {
        "nodes": [
            {
                "id": "delete",
                "data": {
                    "type": "tool",
                    "provider_type": "mcp",
                    "provider_id": SERVER,
                    "tool_name": "delete_documents",
                },
            }
        ]
    }
    disclosure = disclose(graph)
    assert disclosure.items[0].tier == "destructive"
    assert disclosure.confirmation(["delete"]) == {}
    assert disclosure.mocked_node_ids({}) == frozenset({"delete"})


def test_malformed_mcp_action_does_not_hide_other_cached_actions(inventory: Engine) -> None:
    add_provider(inventory, tools=[{"name": "bad", "inputSchema": {"type": "impossible"}}, definition()])
    entries = [entry for entry in build_tool_catalogue(TENANT_ID) if entry["provider_type"] == "mcp"]
    assert [entry["tool_name"] for entry in entries] == [ACTION]
