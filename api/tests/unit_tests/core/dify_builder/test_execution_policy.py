"""Pure restricted admission controls: no runtime transport is exercised here."""

import importlib
from typing import TYPE_CHECKING, cast

import pytest
from pydantic import ValidationError

if TYPE_CHECKING:
    from core.dify_builder.execution_policy import ExecutionEvidenceSummary


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


def _confirmed_summary(**changes: object) -> "ExecutionEvidenceSummary":
    values: dict[str, object] = {
        "request_id": "request-1",
        "policy_version": "builder-confirmed-gmail-read-v1",
        "mode": "confirmed_tool",
        "sealed": True,
        "safety_outcome": "confirmed_tool_completed",
        "sandbox_profile": "disabled",
        "native_run_id": "native-1",
        "consent_id": "consent-1",
        "action_state": "completed",
        "action_reason_code": "message_returned",
        **changes,
    }
    return policy().ExecutionEvidenceSummary.model_validate(values)


def test_confirmed_evidence_literals_and_sanitized_action_metadata() -> None:
    summary = _confirmed_summary()
    assert (summary.mode, summary.safety_outcome, summary.fixture_digest) == (
        "confirmed_tool",
        "confirmed_tool_completed",
        None,
    )
    unknown = _confirmed_summary(safety_outcome="execution_evidence_unknown", action_state=None, native_run_id=None)
    assert unknown.consent_id == "consent-1"


@pytest.mark.parametrize(
    "changes",
    [
        {"policy_version": "builder-restricted-v1"},
        {"mode": "restricted"},
        {"consent_id": None},
        {"action_state": "unknown"},
        {"native_run_id": None},
        {"sealed": False},
        {"fixture_digest": "a" * 64},
        {"action_reason_code": "Provider said: invalid_grant"},
        {"safety_outcome": "restricted_execution_completed"},
    ],
)
def test_confirmed_completion_cannot_be_constructed_without_complete_confirmed_shape(
    changes: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        _confirmed_summary(**changes)


@pytest.mark.parametrize(
    "changes",
    [
        {"consent_id": "consent-1"},
        {"action_state": "completed"},
        {"safety_outcome": "confirmed_tool_completed"},
        {"fixture_digest": None},
        {"mode": "confirmed_tool"},
    ],
)
def test_restricted_summary_cannot_carry_confirmed_metadata(changes: dict[str, object]) -> None:
    values: dict[str, object] = {
        "request_id": "request-1",
        "mode": "restricted",
        "sealed": True,
        "safety_outcome": "restricted_execution_completed",
        "sandbox_profile": "disabled",
        "fixture_digest": "a" * 64,
        **changes,
    }
    with pytest.raises(ValidationError):
        policy().ExecutionEvidenceSummary.model_validate(values)


def test_trusted_completion_accepts_either_context_variant_and_rejects_unknown_tags() -> None:
    p = policy()
    values: dict[str, object] = {
        "request_id": "request-1",
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "actor_id": "actor-1",
        "session_id": "session-1",
        "test_input_id": "input-1",
        "execution_revision": "a" * 64,
        "graph_revision": "b" * 64,
        "submitted_inputs_digest": "c" * 64,
        "effective_inputs_digest": "d" * 64,
        "mode": "confirmed_tool",
        "sandbox_profile": "disabled",
        "admitted_nodes": (),
        "consent_id": "consent-1",
        "scope_digest": "e" * 64,
        "command_id": "command-1",
        "policy_version": "builder-confirmed-gmail-read-v1",
    }
    initial = p.ConfirmedToolExecutionContext.model_validate({**values, "context_digest": "0" * 64})
    context = initial.model_copy(update={"context_digest": p.context_digest(initial)})
    completion = p.TrustedExecutionCompletion(
        context=context,
        native_run_id="native-1",
        task_id="task-1",
        worker_finished=True,
        worker_exit="returned",
        recorder_healthy=True,
        response_completed=True,
    )
    decoded = p.TrustedExecutionCompletion.model_validate(completion.model_dump(mode="json"))
    assert isinstance(decoded.context, p.ConfirmedToolExecutionContext)
    raw = completion.model_dump(mode="json")
    raw["context"]["policy_version"] = "builder-unknown-v9"
    with pytest.raises(ValidationError):
        p.TrustedExecutionCompletion.model_validate(raw)


def test_json_evidence_variant_and_receipt_are_strict() -> None:
    p = policy()
    summary = p.ExecutionEvidenceSummary(
        request_id="request-1",
        policy_version="builder-json-parse-v1",
        mode="restricted",
        sealed=True,
        safety_outcome="restricted_execution_completed",
        sandbox_profile="disabled",
        native_run_id="run-1",
    )
    assert summary.policy_version == "builder-json-parse-v1"
    for mutation in (
        {"fixture_digest": "a" * 64},
        {"consent_id": "consent-1"},
        {"mode": "mock"},
        {"sandbox_profile": "network-disabled-v1"},
        {"native_run_id": None},
    ):
        with pytest.raises(ValidationError):
            p.ExecutionEvidenceSummary.model_validate({**summary.model_dump(mode="json"), **mutation})

    receipt = p.BuilderExecutionObservation(
        observation_id="receipt-1",
        invocation_id="invocation-1",
        request_id="request-1",
        node_id="node2",
        kind="qualified_json_completed",
        implementation_version="graphon.nodes.tool.tool_node.ToolNode:1",
        reason_code="json_parse_completed",
        native_node_execution_id="execution-1",
        qualification_digest="a" * 64,
        installed_binding_digest="b" * 64,
        final_parameters_digest="c" * 64,
        pre_binding_digest="b" * 64,
        post_binding_digest="b" * 64,
        native_text_output_digest="d" * 64,
        text_bytes=65536,
        text_messages=8,
    )
    assert receipt.kind == "qualified_json_completed"
    for mutation in (
        {"text_bytes": 65537},
        {"text_messages": 9},
        {"fixture_digest": "e" * 64},
        {"native_node_execution_id": None},
        {"kind": "fixture_served"},
    ):
        with pytest.raises(ValidationError):
            p.BuilderExecutionObservation.model_validate({**receipt.model_dump(mode="json"), **mutation})


@pytest.mark.parametrize(
    ("sealed", "admitted"),
    [(True, True), (False, False), (1, False), ("true", False), (None, False)],
    ids=["true", "false", "integer-one", "string-true", "null"],
)
def test_json_success_evidence_requires_raw_boolean_seal(sealed, admitted):
    p = policy()
    values = {
        "request_id": "request-1",
        "policy_version": "builder-json-parse-v1",
        "mode": "restricted",
        "sealed": sealed,
        "safety_outcome": "restricted_execution_completed",
        "sandbox_profile": "disabled",
        "native_run_id": "run-1",
    }
    if admitted:
        assert p.ExecutionEvidenceSummary.model_validate(values).sealed is True
    else:
        with pytest.raises(ValidationError):
            p.ExecutionEvidenceSummary.model_validate(values)


def test_json_non_success_evidence_allows_exact_false_seal_and_legacy_coercion_is_unchanged():
    p = policy()
    json_values = {
        "request_id": "request-1",
        "policy_version": "builder-json-parse-v1",
        "mode": "restricted",
        "sealed": False,
        "safety_outcome": "execution_evidence_unknown",
        "sandbox_profile": "disabled",
    }
    assert p.ExecutionEvidenceSummary.model_validate(json_values).sealed is False
    for legacy_seal in (1, "true"):
        restricted = {
            **json_values,
            "policy_version": "builder-restricted-v1",
            "fixture_digest": "a" * 64,
            "sealed": legacy_seal,
        }
        confirmed = {
            **json_values,
            "policy_version": "builder-confirmed-gmail-read-v1",
            "mode": "confirmed_tool",
            "consent_id": "consent-1",
            "sealed": legacy_seal,
        }
        assert p.ExecutionEvidenceSummary.model_validate(restricted).sealed is True
        assert p.ExecutionEvidenceSummary.model_validate(confirmed).sealed is True


def normal_workflow_features(*, citation=True):
    """Literal metadata produced by ordinary Workflow creation/save."""
    return {
        "retriever_resource": {"enabled": citation},
        "file_upload": {},
        "text_to_speech": {"enabled": False, "voice": "", "language": ""},
        "sensitive_word_avoidance": {"enabled": False},
    }


@pytest.mark.parametrize("citation", [True, False], ids=["enabled", "disabled"])
def test_normal_workflow_citation_display_metadata_admits_native_template(citation):
    from tests.unit_tests.services.dify_builder.test_template_execution import template_graph

    value = snapshot(template_graph(), features=normal_workflow_features(citation=citation))
    bindings = policy().admitted_node_bindings(value)
    assert [binding.node_id for binding in bindings] == ["start", "template", "end"]
    assert value.features["retriever_resource"] == {"enabled": citation}
    assert value.features["file_upload"] == {}


@pytest.mark.parametrize("features", [{}, {"retriever_resource": {}}], ids=["absent", "empty"])
def test_citation_display_absent_or_empty_metadata_compatibility(features):
    value = snapshot(features=features)
    policy().admit_raw_execution_metadata(value)
    assert value.features == features


@pytest.mark.parametrize(
    "citation",
    [
        pytest.param(None, id="not-mapping"),
        pytest.param({"enabled": 1}, id="integer-one"),
        pytest.param({"enabled": 0}, id="integer-zero"),
        pytest.param({"enabled": "true"}, id="string"),
        pytest.param({"enabled": None}, id="null"),
        pytest.param({"enabled": []}, id="container"),
        pytest.param({"enabled": True, "unknown": "PRIVATE-METADATA"}, id="enabled-unknown-key"),
        pytest.param({"enabled": False, "unknown": "PRIVATE-METADATA"}, id="disabled-unknown-key"),
        pytest.param({"enabled": True, "config": {}}, id="extra-config"),
    ],
)
def test_citation_display_metadata_rejects_non_boolean_or_unknown_shape(citation):
    features = normal_workflow_features()
    features["retriever_resource"] = citation
    with pytest.raises(policy().BuilderExecutionPolicyError) as error:
        policy().admit_raw_execution_metadata(snapshot(features=features))
    assert error.value.reason_code == "unsupported_features"
    assert "PRIVATE-METADATA" not in str(error.value)


@pytest.mark.parametrize(
    "feature", ["file_upload", "text_to_speech", "speech_to_text", "sensitive_word_avoidance", "external_data_tools"]
)
def test_citation_display_flag_never_admits_enabled_external_features(feature):
    features = normal_workflow_features()
    features[feature] = [{"endpoint": "PRIVATE-METADATA"}] if feature == "external_data_tools" else {"enabled": True}
    with pytest.raises(policy().BuilderExecutionPolicyError) as error:
        policy().admit_raw_execution_metadata(snapshot(features=features))
    assert error.value.reason_code == "unsupported_features"
    assert "PRIVATE-METADATA" not in str(error.value)


@pytest.mark.parametrize("node_type", ["knowledge-retrieval", "llm", "tool"])
def test_citation_display_flag_never_admits_retrieval_model_or_tool_nodes(node_type):
    from tests.unit_tests.services.dify_builder.test_template_execution import template_graph

    raw_graph = template_graph()
    raw_graph["nodes"][1]["data"]["type"] = node_type
    with pytest.raises(policy().BuilderExecutionPolicyError) as error:
        policy().admitted_node_bindings(snapshot(raw_graph, features=normal_workflow_features()))
    assert error.value.reason_code == "unsupported_node_implementation"
