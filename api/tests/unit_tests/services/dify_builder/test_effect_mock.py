import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from graphon.engine_events import NodeRunStartedEvent, NodeRunSucceededEvent
from graphon.enums import BuiltinNodeTypes, ErrorStrategy, WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.nodes.http_request import HttpRequestNode
from graphon.nodes.tool.tool_node import ToolNode
from graphon.runtime import InitParams, RuntimeState, VariablePool
from services.dify_builder.effect_mock import MOCKED_PROCESS_KEY, mocked_node_class
from services.workflow_runtime.agent_node import DifyAgentNode
from services.workflow_runtime.node_factory import DifyNodeFactory
from tests.unit_tests.config_override import apply_config_overrides


def _factory(mocked: frozenset[str]) -> DifyNodeFactory:
    run_context = build_dify_run_context(
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        builder_mocked_node_ids=mocked,
    )
    return DifyNodeFactory(
        init_params=InitParams(
            run_context=run_context, workflow_id="workflow", graph_config={"nodes": [], "edges": []}, call_depth=0
        ),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
    )


def _tool_config(node_id: str) -> dict[str, object]:
    return {
        "id": node_id,
        "data": {
            "type": BuiltinNodeTypes.TOOL,
            "title": "Send",
            "provider_id": "slack",
            "provider_type": "builtin",
            "provider_name": "slack",
            "tool_name": "send_message",
            "tool_label": "Send message",
            "tool_configurations": {},
            "tool_parameters": {},
        },
    }


def test_only_the_listed_node_is_mocked_and_it_never_dispatches() -> None:
    factory = _factory(frozenset({"send"}))

    mocked = factory.create_node(_tool_config("send"))
    real = factory.create_node(_tool_config("other"))

    assert type(real) is ToolNode
    assert isinstance(mocked, ToolNode)
    result = mocked._run()
    assert isinstance(result, NodeRunResult)
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {"text": "", "files": [], "json": []}
    assert result.process_data == {MOCKED_PROCESS_KEY: True}


def test_ordinary_runs_carry_no_mocked_nodes() -> None:
    node = _factory(frozenset()).create_node(_tool_config("send"))

    assert type(node) is ToolNode


def _agent_config(**data: object) -> dict[str, object]:
    return {
        "id": "agent",
        "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent", "title": "Agent", **data},
    }


def test_mocked_agent_needs_no_backend_client_or_native_constructor(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, AGENT_BACKEND_BASE_URL=None)
    apply_config_overrides(monkeypatch, AGENT_BACKEND_USE_FAKE=False)

    def forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("mocked Agent must not initialize native clients or resources")

    monkeypatch.setattr(DifyAgentNode, "__init__", forbidden)
    node = _factory(frozenset({"agent"})).create_node(_agent_config())
    node.bind_execution_id("mock-execution")
    events = list(node.run())
    terminal = events[-1]

    assert isinstance(node, DifyAgentNode)
    assert isinstance(terminal, NodeRunSucceededEvent)
    assert terminal.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert terminal.node_run_result.outputs == {"text": ""}
    assert terminal.node_run_result.process_data == {MOCKED_PROCESS_KEY: True}


def test_legacy_agent_mock_start_event_preserves_strategy_without_presentation_resources(
    caplog: pytest.LogCaptureFixture,
) -> None:
    node = _factory(frozenset({"agent"})).create_node(
        {
            "id": "agent",
            "data": {
                "type": "agent",
                "version": "1",
                "title": "Legacy Agent",
                "agent_strategy_provider_name": "langgenius/agent/agent",
                "agent_strategy_name": "function_calling",
            },
        }
    )
    node.bind_execution_id("legacy-mock-execution")

    events = list(node.run())

    start, terminal = events[0], events[-1]
    assert isinstance(start, NodeRunStartedEvent)
    assert start.extras == {"agent_strategy": {"name": "function_calling"}}
    assert isinstance(terminal, NodeRunSucceededEvent)
    assert terminal.node_run_result.process_data == {MOCKED_PROCESS_KEY: True}
    assert "Failed to populate start event" not in caplog.text


def test_mocked_agent_preserves_declared_output_shapes_without_fabricating_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, AGENT_BACKEND_USE_FAKE=True)
    node = _factory(frozenset({"agent"})).create_node(
        _agent_config(
            agent_declared_outputs=[
                {"name": "summary", "type": "string"},
                {"name": "count", "type": "number"},
                {"name": "accepted", "type": "boolean"},
                {"name": "record", "type": "object", "children": [{"name": "label", "type": "string"}]},
                {"name": "items", "type": "array", "array_item": {"type": "number"}},
                {"name": "attachment", "type": "file"},
                {"name": "attachments", "type": "array", "array_item": {"type": "file"}},
            ]
        )
    )

    result = node._run()
    assert isinstance(result, NodeRunResult)
    assert result.outputs == {
        "text": "",
        "summary": "",
        "count": 0,
        "accepted": False,
        "record": {"label": ""},
        "items": [],
        "attachment": None,
        "attachments": [],
    }


def test_mocked_agent_selects_a_configured_route_for_downstream_execution(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, AGENT_BACKEND_USE_FAKE=True)
    node = _factory(frozenset({"agent"})).create_node(
        _agent_config(
            agent_output_routes={
                "enabled": True,
                "routes": [
                    {"id": "approved", "name": "Approved"},
                    {"id": "rejected", "name": "Rejected"},
                ],
            }
        )
    )

    result = node._run()

    assert isinstance(result, NodeRunResult)
    assert result.outputs == {"text": "", "switch": "approved"}
    assert result.edge_source_handle == "approved"


@pytest.mark.parametrize("mocked", [frozenset(), frozenset({"agent"})])
def test_agent_routes_reject_node_default_value_in_both_real_and_mock_runs(
    monkeypatch: pytest.MonkeyPatch, mocked: frozenset[str]
) -> None:
    apply_config_overrides(monkeypatch, AGENT_BACKEND_USE_FAKE=True)
    config = _agent_config(
        error_strategy=ErrorStrategy.DEFAULT_VALUE,
        agent_output_routes={
            "enabled": True,
            "routes": [{"id": "approved", "name": "Approved"}, {"id": "rejected", "name": "Rejected"}],
        },
    )

    with pytest.raises(ValueError, match="Output routes do not support the node-level default-value error strategy"):
        _factory(mocked).create_node(config)


def test_mocked_class_is_cached_and_never_replaces_the_native_registration() -> None:
    mocked = mocked_node_class(HttpRequestNode)

    assert mocked is mocked_node_class(HttpRequestNode)
    assert issubclass(mocked, HttpRequestNode)
    assert Node._registry[BuiltinNodeTypes.HTTP_REQUEST][HttpRequestNode.version()] is HttpRequestNode
    assert Node._registry[BuiltinNodeTypes.HTTP_REQUEST]["latest"] is not mocked


def test_nested_factories_share_the_run_owned_credential_binding_map() -> None:
    bindings = {"send": "approved-account-version"}
    run_context = build_dify_run_context(
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        builder_tool_credential_bindings=bindings,
    )
    factory = DifyNodeFactory(
        init_params=InitParams(
            run_context=run_context, workflow_id="workflow", graph_config={"nodes": [], "edges": []}, call_depth=0
        ),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0),
    )
    nested = factory.with_runtime_state(RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0))
    record = factory._tool_runtime._credential_refresh_recorder("send")
    record("authorized-native-refresh-version")

    assert nested._dify_context.builder_tool_credential_bindings is not None
    assert nested._dify_context.builder_tool_credential_bindings["send"] == "authorized-native-refresh-version"
    assert bindings["send"] == "authorized-native-refresh-version"
