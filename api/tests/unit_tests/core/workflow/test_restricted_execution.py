"""Capability admission ordering and the complete native HTTP protocol boundary."""

import json
import math
from copy import deepcopy
from typing import TypedDict, cast
from unittest.mock import MagicMock

import pytest

from core.dify_builder.execution_policy import BuilderExecutionPolicyError, admitted_node_bindings
from graphon.http import HttpClientProtocol
from graphon.nodes.http_request.node import HttpRequestNode
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import GraphRuntimeState, VariablePool
from tests.unit_tests.core.dify_builder.test_execution_policy import fixture, graph, snapshot
from tests.unit_tests.core.workflow.graph_engine.test_builder_restricted_native import (
    forbid_live as forbid_live,  # noqa: PLC0414
)
from tests.unit_tests.core.workflow.graph_engine.test_builder_restricted_native import (
    prepare_native,
    receipts,
)
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414


class RawNode(TypedDict):
    id: str
    data: dict[str, object]


class RawGraph(TypedDict):
    nodes: list[RawNode]
    edges: list[dict[str, str]]


@pytest.mark.parametrize("method", ["get", "head", "post", "put", "delete", "patch"])
def test_all_protocol_methods_serve_text_and_append_distinct_attempts(owned, method):
    from core.workflow.restricted_execution import PolicyTransportError, RestrictedHttpClient

    factory, context, recorder = prepare_native(owned, "http_text.yml", samples=(fixture(body="你好"),))
    node = factory.create_node(factory.graph_init_params.graph_config["nodes"][1])
    assert isinstance(node, HttpRequestNode)
    client = node.http_client
    assert isinstance(client, RestrictedHttpClient)
    typed_client: HttpClientProtocol = client
    assert typed_client.request_error is PolicyTransportError
    assert typed_client.max_retries_exceeded_error is not PolicyTransportError
    for _ in range(2):
        result = getattr(typed_client, method)("https://sample.invalid/resolved", max_retries=0)
        assert result.status_code == 201
        assert result.text == "你好"
        assert result.headers["content-type"] == "text/plain; charset=utf-8"
    saved = receipts(owned)
    assert len(saved) == 2
    assert len({o["observation_id"] for o in saved}) == 2
    assert len({o["invocation_id"] for o in saved}) == 2
    assert "https://" not in json.dumps(saved)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"files": [("f", b"private")]},
        {"files": {}},
        {"auth": "private"},
        {"cookies": {}},
        {"headers": {"Authorization": "private"}},
        {"headers": {"Content-Type": "application/json; charset=latin-1"}},
        {"headers": {"Content-Type": "APPLICATION/XML"}},
        {"headers": {"Content-Type": "APPLICATION/JSON; CHARSET=LATIN-1"}},
        {"headers": {"Content-Type": "APPLICATION/JSON; CHARSET=UTF-8; BOUNDARY=private"}},
        {"headers": {"Content-Type": "text/plain", "content-type": "text/plain"}},
        {"timeout": (1, float("inf"), 1)},
        {"timeout": (True, 1, 1)},
        {"timeout": (10**400, 1, 1)},
        {"json": ("tuple",)},
        {"json": {"nested": ("tuple",)}},
        {"timeout": object()},
        {"max_retries": True},
        {"max_retries": 1},
        {"ssl_verify": None},
        {"ssl_verify": "false"},
        {"follow_redirects": "true"},
        {"content": b"file"},
        {"content": "x" * 65537},
        {"json": {"v": math.nan}},
        {"json": {"file": object()}},
        {"params": {"k": object()}},
        {"data": {"key": "form data"}},
        {"unknown": None},
    ],
)
def test_runtime_kwargs_deny_before_fixture_return_and_append_receipt(owned, kwargs):
    from core.workflow.restricted_execution import PolicyTransportError

    factory, _, _ = prepare_native(owned, "http_text.yml", samples=(fixture(),))
    node = factory.create_node(factory.graph_init_params.graph_config["nodes"][1])
    assert isinstance(node, HttpRequestNode)
    client = node.http_client
    with pytest.raises(PolicyTransportError, match="execution_policy: http_request_arguments"):
        client.get("https://sample.invalid/private", **kwargs)
    assert receipts(owned)[0]["kind"] == "effect_blocked"
    assert "private" not in json.dumps(receipts(owned))


@pytest.mark.parametrize(
    "entry", ["download", "build_from_mapping", "create_file_by_raw", "get_file_generator_by_tool_file_id", "factory"]
)
def test_file_collaborators_deny_and_record(owned, entry):
    from core.workflow.restricted_execution import PolicyTransportError

    factory, _, _ = prepare_native(owned, "http_text.yml", samples=(fixture(),))
    node = factory.create_node(factory.graph_init_params.graph_config["nodes"][1])
    assert isinstance(node, HttpRequestNode)

    def invoke():
        if entry == "download":
            node._file_manager.download(MagicMock())
        elif entry == "build_from_mapping":
            node._file_reference_factory.build_from_mapping(mapping={})
        elif entry == "factory":
            node._tool_file_manager_factory()
        else:
            getattr(node._file_manager, entry)(
                **({"file_binary": b"x", "mimetype": "x"} if entry == "create_file_by_raw" else {"tool_file_id": "x"})
            )

    with pytest.raises(PolicyTransportError, match="execution_policy: http_file_capability"):
        invoke()
    assert receipts(owned)[0]["kind"] == "effect_blocked"


@pytest.mark.parametrize("node_type", ["llm", "tool", "agent", "code", "template-transform", "iteration", "new-effect"])
def test_forbidden_raw_type_refused_before_concrete_validation_or_model_resolution(owned, monkeypatch, node_type):

    factory, _, _ = prepare_native(owned, "scalar.yml", inputs={"text": "x"})
    forbidden = MagicMock(side_effect=AssertionError("effectful class validation reached"))
    monkeypatch.setattr(factory, "_validate_resolved_node_data", forbidden)
    monkeypatch.setattr(factory, "_resolve_llm_model_reference", forbidden)
    if node_type != "new-effect":
        forbidden_class = factory._resolve_node_class(
            node_type=node_type, node_version="1", node_data={"type": node_type}
        )
        monkeypatch.setattr(forbidden_class, "validate_node_data", forbidden)
        monkeypatch.setattr(forbidden_class, "__init__", forbidden)
    node = deepcopy(factory.graph_init_params.graph_config["nodes"][0])
    node["data"]["type"] = node_type
    with pytest.raises(BuilderExecutionPolicyError):
        factory.create_node(node)
    forbidden.assert_not_called()


@pytest.mark.parametrize("entry", ["create", "graph_init", "constructor"])
@pytest.mark.parametrize("mutation", ["class", "unknown_version", "latest", "config"])
def test_raw_identity_and_config_gate_runs_before_concrete_validation(owned, monkeypatch, mutation, entry):
    from core.workflow.node_factory import DifyNodeFactory
    from graphon.graph import Graph

    factory, _, _ = prepare_native(owned, "scalar.yml", inputs={"text": "x"})
    node = deepcopy(factory.graph_init_params.graph_config["nodes"][0])
    forbidden = MagicMock(side_effect=AssertionError("concrete validation reached"))
    monkeypatch.setattr(StartNode, "validate_node_data", forbidden)
    if mutation == "class":

        class ChangedStart:
            validate_node_data = forbidden

            @staticmethod
            def version() -> str:
                return "1"

        ChangedStart.__module__ = StartNode.__module__
        ChangedStart.__qualname__ = StartNode.__qualname__
        monkeypatch.setattr(DifyNodeFactory, "_resolve_node_class", staticmethod(lambda **_: ChangedStart))
    elif mutation == "config":
        node["data"]["new_extra"] = "changed"
    else:
        node["data"]["version"] = "latest" if mutation == "latest" else "999"
    config = deepcopy(factory.graph_init_params.graph_config)
    config["nodes"][0] = node

    def invoke():
        if entry == "create":
            return factory.create_node(node)
        if entry == "graph_init":
            return Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
        return DifyNodeFactory(
            factory.graph_init_params.model_copy(update={"graph_config": config}),
            factory.graph_runtime_state,
            execution_recorder=factory.execution_recorder,
        )

    with pytest.raises(BuilderExecutionPolicyError):
        invoke()
    forbidden.assert_not_called()


def test_with_runtime_state_keeps_exact_policy_recorder_and_private_key(owned):
    factory, context, recorder = prepare_native(owned, "http_text.yml", samples=(fixture(),))
    state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
    clone = factory.with_runtime_state(state)
    assert clone.execution_recorder is recorder
    assert clone._dify_context.builder_execution is context
    assert clone._dify_context.builder_execution.http_fixtures is context.http_fixtures
    assert clone._request_hmac_key is factory._request_hmac_key
    node = clone.create_node(clone.graph_init_params.graph_config["nodes"][1])
    assert isinstance(node, HttpRequestNode)
    node.http_client.get("https://sample.invalid/clone")
    assert len(receipts(owned)) == 1


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "array[file]", "key": "body", "value": []},
        {"type": "object", "key": "body", "value": {}},
        {"type": "number", "key": "status_code", "value": True},
        {"type": "number", "key": "status_code", "value": float("inf")},
        {"type": "string", "key": "unknown", "value": "x"},
        {"type": "string", "key": "body", "value": "x" * 65537},
        {"type": "string", "key": "body", "value": "\ud800"},
        {"type": "string", "key": "body", "value": "x", "extra": "x"},
    ],
)
def test_http_defaults_stay_bounded_scalar_and_known_keys(bad):
    value = cast(RawGraph, graph(http=True))
    value["nodes"][1]["data"]["default_value"] = [bad]
    with pytest.raises(BuilderExecutionPolicyError):
        admitted_node_bindings(snapshot(value))


def test_fixed_utf8_header_and_scalar_defaults_are_admitted():
    value = cast(RawGraph, graph(http=True))
    value["nodes"][1]["data"].update(
        headers="Content-Type: application/json; charset=utf-8",
        default_value=[
            {"type": "string", "key": "body", "value": "default"},
            {"type": "number", "key": "status_code", "value": 599},
        ],
        error_strategy="default-value",
    )
    assert len(admitted_node_bindings(snapshot(value))) == 3


@pytest.mark.parametrize("name", ["code_increment.yml", "template_greeting.yml"])
def test_reserved_sandbox_fixtures_are_unavailable_before_sandbox_owner(owned, name):
    with pytest.raises(BuilderExecutionPolicyError, match="unsupported_node_implementation"):
        prepare_native(owned, name, inputs={"n": 41, "name": "Ada"})


@pytest.mark.parametrize("change", ["fixture_digest", "fixture_node", "fixture_body", "context_digest"])
def test_wrong_fixture_or_context_cannot_construct_native_adapter(owned, change):
    from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY
    from core.dify_builder.execution_policy import context_digest
    from core.workflow.node_factory import DifyNodeFactory

    factory, context, recorder = prepare_native(owned, "http_text.yml", samples=(fixture(),))
    if change == "fixture_digest":
        altered = context.model_copy(update={"fixture_digest": "a" * 64})
    elif change == "fixture_node":
        altered = context.model_copy(update={"http_fixtures": (fixture(node_id="end"),)})
    elif change == "fixture_body":
        altered = context.model_copy(update={"http_fixtures": (fixture(body="changed"),)})
    else:
        altered = context.model_copy(update={"context_digest": "a" * 64})
    if change != "context_digest":
        altered = altered.model_copy(update={"context_digest": context_digest(altered)})
    dify_context = factory._dify_context.model_copy(update={"builder_execution": altered})
    params = factory.graph_init_params.model_copy(update={"run_context": {DIFY_RUN_CONTEXT_KEY: dify_context}})
    with pytest.raises(BuilderExecutionPolicyError):
        DifyNodeFactory(params, factory.graph_runtime_state, execution_recorder=recorder)
    assert receipts(owned) == []


@pytest.mark.parametrize(
    "raw", [{"body": b"file"}, {"content_type": "application/octet-stream"}, {"files": []}, {"node_version": "latest"}]
)
def test_response_file_or_unknown_fixture_payload_is_rejected(raw):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        fixture(**raw)


@pytest.mark.parametrize(
    "mutation", ["defaults_alias", "duplicate_defaults", "header_variable", "header_charset", "hidden_auth", "options"]
)
def test_unreviewed_raw_http_shapes_remain_unavailable(mutation):
    value = cast(RawGraph, graph(http=True))
    data = value["nodes"][1]["data"]
    if mutation == "defaults_alias":
        data["default_values"] = [{"key": "body", "type": "string", "value": "x"}]
    elif mutation == "duplicate_defaults":
        data["default_value"] = [{"key": "body", "type": "string", "value": "x"}] * 2
    elif mutation == "header_variable":
        data["headers"] = "Content-Type: {{#start.text#}}"
    elif mutation == "header_charset":
        data["headers"] = "Content-Type: text/plain; charset=latin-1"
    elif mutation == "hidden_auth":
        cast(dict[str, object], data["authorization"])["config"] = {"type": "bearer", "api_key": "private"}
    else:
        data["method"] = "OPTIONS"
    with pytest.raises(BuilderExecutionPolicyError):
        admitted_node_bindings(snapshot(value))


def test_actual_resolved_class_is_guarded_before_its_validator_when_registry_changes(owned, monkeypatch):
    factory, _, _ = prepare_native(owned, "scalar.yml", inputs={"text": "x"})
    forbidden = MagicMock(side_effect=AssertionError("unreviewed concrete validator reached"))

    class ChangedStart:
        validate_node_data = forbidden

        @staticmethod
        def version() -> str:
            return "1"

    ChangedStart.__module__ = StartNode.__module__
    ChangedStart.__qualname__ = StartNode.__qualname__
    classes = iter((StartNode, StartNode, ChangedStart))
    monkeypatch.setattr(factory, "_resolve_node_class", lambda **_: next(classes))
    with pytest.raises(BuilderExecutionPolicyError):
        factory.create_node(factory.graph_init_params.graph_config["nodes"][0])
    forbidden.assert_not_called()


@pytest.mark.parametrize("change", ["binding", "implementation_version"])
def test_typed_capability_recheck_requires_same_exact_binding_and_version(owned, monkeypatch, change):
    from core.workflow.restricted_execution import validate_restricted_node

    factory, context, _ = prepare_native(owned, "scalar.yml", inputs={"text": "x"})
    data = StartNode.validate_node_data(factory.graph_init_params.graph_config["nodes"][0]["data"])
    if change == "binding":
        binding = context.admitted_nodes[0].model_copy(update={"implementation": "unreviewed.StartNode"})
        context = context.model_copy(update={"admitted_nodes": (binding, *context.admitted_nodes[1:])})
    else:
        monkeypatch.setattr(StartNode, "version", classmethod(lambda _cls: "2"))
    with pytest.raises(BuilderExecutionPolicyError):
        validate_restricted_node(context=context, node_id="start", node_class=StartNode, resolved_node_data=data)
