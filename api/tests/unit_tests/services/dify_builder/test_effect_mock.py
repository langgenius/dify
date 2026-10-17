from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from core.workflow.node_factory import DifyNodeFactory
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.nodes.base.node import Node
from graphon.nodes.http_request import HttpRequestNode
from services.dify_builder.effect_mock import MOCKED_PROCESS_KEY, mocked_node_class


class _DummyToolNode:
    node_type = BuiltinNodeTypes.TOOL

    def __init__(self, *, node_id, **kwargs):
        self.id = node_id
        self.kwargs = kwargs

    def _run(self):
        raise AssertionError("a mocked node must never dispatch")


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
        graph_init_params=SimpleNamespace(run_context=run_context, workflow_id="workflow"),
        graph_runtime_state=SimpleNamespace(),
    )


@pytest.fixture(autouse=True)
def dummy_tool(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("core.workflow.node_factory.resolve_workflow_node_class", lambda **_kwargs: _DummyToolNode)
    monkeypatch.setattr(DifyNodeFactory, "_validate_resolved_node_data", staticmethod(lambda _node_class, data: data))


def _tool_config(node_id: str) -> dict:
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


def test_only_the_listed_node_is_mocked_and_it_never_dispatches():
    factory = _factory(frozenset({"send"}))

    mocked = factory.create_node(_tool_config("send"))
    real = factory.create_node(_tool_config("other"))

    assert type(real) is _DummyToolNode
    assert isinstance(mocked, _DummyToolNode)
    result = mocked._run()
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs == {"text": "", "files": [], "json": []}
    assert result.process_data == {MOCKED_PROCESS_KEY: True}


def test_ordinary_runs_carry_no_mocked_nodes():
    node = _factory(frozenset()).create_node(_tool_config("send"))

    assert type(node) is _DummyToolNode


def test_mocked_class_is_cached_and_never_replaces_the_native_registration():
    mocked = mocked_node_class(HttpRequestNode)

    assert mocked is mocked_node_class(HttpRequestNode)
    assert issubclass(mocked, HttpRequestNode)
    assert Node._registry[BuiltinNodeTypes.HTTP_REQUEST][HttpRequestNode.version()] is HttpRequestNode
    assert Node._registry[BuiltinNodeTypes.HTTP_REQUEST]["latest"] is not mocked
