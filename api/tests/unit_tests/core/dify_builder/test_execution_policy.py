"""Pure restricted admission controls: no runtime transport is exercised here."""

import importlib
from typing import cast

import pytest
from pydantic import ValidationError


def policy():
    return importlib.import_module("core.dify_builder.execution_policy")


def fixture(**overrides):
    return policy().HttpResponseFixtureV1(
        **{
            "node_id": "http",
            "source": "user_sample",
            "status_code": 201,
            "content_type": "text/plain",
            "body": "sample",
            **overrides,
        }
    )


def graph(http=False):
    nodes = [
        {"id": "start", "data": {"type": "start", "variables": []}},
        {"id": "end", "data": {"type": "end", "outputs": []}},
    ]
    if http:
        nodes.insert(
            1,
            {
                "id": "http",
                "data": {
                    "type": "http-request",
                    "method": "GET",
                    "url": "https://example.invalid",
                    "authorization": {"type": "no-auth"},
                    "headers": "",
                    "params": "",
                },
            },
        )
    return {"nodes": nodes, "edges": [{"source": a["id"], "target": b["id"]} for a, b in zip(nodes, nodes[1:])]}


def test_fixture_strict_integer_and_immutable():
    value = fixture()
    assert value.model_dump(mode="json")["status_code"] == 201
    with pytest.raises(ValidationError):
        fixture(status_code=True)
    with pytest.raises(ValidationError):
        value.body = "changed"


@pytest.mark.parametrize(
    "overrides",
    [
        {"body": "\ud800"},
        {"body": "x" * 65537},
        {"body": "NaN", "content_type": "application/json"},
        {"body": '{"n":1e999}', "content_type": "application/json"},
        {"headers": {}},
        {"node_version": "latest"},
        {"node_id": ""},
        {"schema_version": True},
    ],
)
def test_invalid_fixture_rejected(overrides):
    with pytest.raises(ValidationError):
        fixture(**overrides)


def test_untrusted_fixture_decoder_is_strict_and_sanitized():
    p = policy()
    sample = fixture().model_dump(mode="json")
    sample.pop("source")
    assert p.decode_http_fixture_submission([sample])[0].source == "user_sample"
    for raw in (None, {}, [dict(sample, source="generated_sample")], [dict(sample, body="private", status_code=True)]):
        with pytest.raises(p.BuilderExecutionPolicyError) as error:
            p.decode_http_fixture_submission(raw)
        assert "private" not in str(error.value)
    with pytest.raises(p.BuilderExecutionPolicyError):
        p.decode_http_fixture_submission([sample, sample])


def test_canonical_digests_reject_nonfinite_and_surrogates_preserve_array_order():
    p = policy()
    assert p.canonical_digest({"a": 1, "b": 2}) == p.canonical_digest({"b": 2, "a": 1})
    assert p.canonical_digest([1, 2]) != p.canonical_digest([2, 1])
    for raw in (float("nan"), float("inf"), "\ud800", object(), {1: "x"}):
        with pytest.raises(p.BuilderExecutionPolicyError):
            p.canonical_digest(raw)


@pytest.mark.parametrize("field", ["has_environment_variables", "has_conversation_variables", "has_external_tracing"])
def test_raw_metadata_denied(field):
    p = policy()
    snapshot = p.RestrictedAdmissionSnapshot(
        app_mode="workflow",
        workflow_kind="standard",
        graph=graph(),
        input_schema={"variables": []},
        features={},
        has_environment_variables=False,
        has_conversation_variables=False,
        has_external_tracing=False,
    ).model_copy(update={field: True})
    with pytest.raises(p.BuilderExecutionPolicyError):
        p.admit_raw_execution_metadata(snapshot)


@pytest.mark.parametrize("values", [{"extra": []}, {"extra": {}}, {"extra": float("inf")}, {"extra": "\ud800"}])
def test_all_submitted_values_must_be_scalars(values):
    with pytest.raises(policy().BuilderExecutionPolicyError):
        policy().scalar_inputs_digest(values)


def snapshot(graph_value=None, features=None):
    p = policy()
    return p.RestrictedAdmissionSnapshot(
        app_mode="workflow",
        workflow_kind="standard",
        graph=graph_value or graph(),
        input_schema={"variables": []},
        features=features or {},
        has_environment_variables=False,
        has_conversation_variables=False,
        has_external_tracing=False,
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "unknown",
        "latest",
        "cycle",
        "unreachable",
        "branch",
        "container",
        "file_start",
        "auth",
        "header",
        "body_file",
        "environment_selector",
        "file_default",
    ],
)
def test_admission_rejects_unsupported_effect_shapes(mutation):
    p = policy()
    value = graph(http=True)
    data = value["nodes"][1]["data"]
    if mutation == "unknown":
        data["type"] = "llm"
    elif mutation == "latest":
        data["version"] = "latest"
    elif mutation == "cycle":
        value["edges"].append({"source": "end", "target": "start"})
    elif mutation == "unreachable":
        value["nodes"].append({"id": "stray", "data": dict(data)})
    elif mutation == "branch":
        value["edges"].append({"source": "start", "target": "end"})
    elif mutation == "container":
        value["nodes"][1]["parentId"] = "container"
    elif mutation == "file_start":
        value["nodes"][0]["data"]["variables"] = [{"type": "file", "variable": "f", "label": "File", "required": False}]
    elif mutation == "auth":
        data["authorization"]["config"] = {"type": "bearer", "api_key": "private"}
    elif mutation == "header":
        data["headers"] = "Authorization:private"
    elif mutation == "body_file":
        data["body"] = {"type": "json", "data": [{"type": "file", "file": ["start", "f"]}]}
    elif mutation == "environment_selector":
        data["url"] = "{{#env.secret#}}"
    else:
        data["default_value"] = [{"value_type": "file", "value": "private"}]
    with pytest.raises(p.BuilderExecutionPolicyError) as error:
        p.admitted_node_bindings(snapshot(value))
    assert "private" not in str(error.value)


def test_exact_implementation_identity_precedes_native_validation(monkeypatch):
    from core.workflow import node_factory

    class Unreviewed:
        @staticmethod
        def validate_node_data(_data):
            pytest.fail("unreviewed node validated")

    monkeypatch.setattr(node_factory, "resolve_workflow_node_class", lambda **_kwargs: Unreviewed)
    with pytest.raises(policy().BuilderExecutionPolicyError, match="unsupported_node_implementation"):
        policy().admitted_node_bindings(snapshot())


def test_native_start_end_identity_and_raw_digest_binding():
    p = policy()
    bindings = p.admitted_node_bindings(snapshot())
    assert bindings[0].implementation == "graphon.nodes.start.start_node.StartNode"
    assert bindings[1].implementation == "graphon.nodes.end.end_node.EndNode"
    assert bindings[0].normalized_config_digest == p.canonical_digest(
        {"type": "start", "variables": [], "version": "1"}
    )


@pytest.mark.parametrize(
    "value", [10**400, -(10**400), 10**309, -(10**309)], ids=["huge", "negative-huge", "overflow", "negative-overflow"]
)
def test_http_default_large_integer_refused_before_native_validation(monkeypatch, value):
    from graphon.nodes.http_request.node import HttpRequestNode

    p = policy()
    raw_graph = graph(http=True)
    data = cast(dict[str, object], raw_graph["nodes"][1]["data"])
    data["default_value"] = [{"type": "number", "key": "status_code", "value": value}]
    assert p.canonical_digest(raw_graph)

    def forbidden(_data):
        pytest.fail("oversized default reached native validation")

    monkeypatch.setattr(HttpRequestNode, "validate_node_data", forbidden)
    with pytest.raises(p.BuilderExecutionPolicyError) as error:
        p.admitted_node_bindings(snapshot(raw_graph))
    assert error.value.reason_code == "unsupported_http_defaults"
    assert str(error.value) == "Builder execution policy refused: unsupported_http_defaults"


@pytest.mark.parametrize(
    "value", [599, 599.5, 10**308, -(10**308)], ids=["integer", "float", "large-finite", "negative-finite"]
)
def test_http_default_finite_number_preserves_raw_binding(value):
    p = policy()
    raw_graph = graph(http=True)
    data = cast(dict[str, object], raw_graph["nodes"][1]["data"])
    data["default_value"] = [{"type": "number", "key": "status_code", "value": value}]
    bindings = p.admitted_node_bindings(snapshot(raw_graph))
    assert bindings[1].normalized_config_digest == p.canonical_digest({**data, "version": "1"})


@pytest.mark.parametrize(
    "features",
    [
        {
            "file_upload": {
                "enabled": False,
                "image": {"enabled": False, "transfer_methods": ["local_file", "remote_url"]},
            }
        },
        {"text_to_speech": {"enabled": False, "voice": "", "language": ""}, "retriever_resource": {"enabled": False}},
        {"sensitive_word_avoidance": {"enabled": False, "type": "", "configs": []}},
    ],
)
def test_known_native_disabled_defaults_pass(features):
    policy().admit_raw_execution_metadata(snapshot(features=features))


@pytest.mark.parametrize(
    "features",
    [
        {"text_to_speech": {"enabled": False, "unreviewed": True}},
        {"file_upload": {"enabled": False, "image": {"enabled": False, "unreviewed": True}}},
        {"file_upload": {"enabled": False, "number_limits": True}},
        {"text_to_speech": {"enabled": False, "voice": []}},
    ],
)
def test_unknown_or_malformed_disabled_feature_forms_refuse(features):
    with pytest.raises(policy().BuilderExecutionPolicyError, match="unsupported_features"):
        policy().admit_raw_execution_metadata(snapshot(features=features))


@pytest.mark.parametrize("field", ["node_type", "edge_source", "selector_source"])
def test_malformed_graph_identifiers_are_sanitized_refusals(field):
    value = graph()
    if field == "node_type":
        value["nodes"][0]["data"]["type"] = []
    elif field == "edge_source":
        value["edges"][0]["source"] = {}
    else:
        value["nodes"][1]["data"]["outputs"] = [
            {"variable": "out", "value_type": "string", "value_selector": [[], "value"]}
        ]
    with pytest.raises(policy().BuilderExecutionPolicyError):
        policy().admitted_node_bindings(snapshot(value))
