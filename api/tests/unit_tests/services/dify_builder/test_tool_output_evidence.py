"""Successful same-Run Tool observations are bounded structure, never values or schemas."""

import json
from copy import deepcopy

import pytest

from core.dify_builder.models import Graph, NodeOutput, Run
from services.dify_builder.agent import fix
from services.dify_builder.cognition_model_gateway import PolicyModelInstance
from services.dify_builder.condition_evidence import MAX_CONTEXT_BYTES, build_evidence
from tests.unit_tests.services.dify_builder.test_api_tool_output_context import CapturingModel
from tests.unit_tests.services.dify_builder.typed_fixtures import dictionary


def tool_graph() -> Graph:
    return {
        "nodes": [
            {
                "id": "tool",
                "data": {
                    "type": "tool",
                    "provider_type": "builtin",
                    "provider_id": "fixture/provider",
                    "tool_name": "records",
                    "plugin_unique_identifier": "fixture/plugin:1",
                },
            },
            {"id": "consumer", "data": {"type": "code", "code": "def main(): return {}", "outputs": {}}},
        ],
        "edges": [{"source": "tool", "target": "consumer"}],
    }


def tool_rows(text: str = '[{"url":"https://private.example/release","count":7}]') -> list[NodeOutput]:
    return [
        NodeOutput(
            node_id="tool",
            status="succeeded",
            outputs_available=True,
            outputs={"text": text, "json": [{"data": []}], "files": [{"url": "private-file"}]},
        ),
        NodeOutput(node_id="consumer", status="failed", error="missing field"),
    ]


def observe(graph: Graph, rows: list[NodeOutput], history: Graph | None = None) -> dict[str, object]:
    return build_evidence(Run(status="failed"), graph, history if history is not None else graph, rows)[3]


def test_text_json_and_native_json_remain_distinct_without_values() -> None:
    evidence = observe(tool_graph(), tool_rows())
    observations = evidence["tool_output_observations"]
    assert isinstance(observations, list)
    assert len(observations) == 1
    item = observations[0]
    assert item["node_id"] == "tool"
    assert item["provider_id"] == "fixture/provider"
    assert item["scope"] == "same_run_observation_not_schema"
    assert item["channels"]["text"]["parsed_json"]["items"][0] == {
        "type": "object",
        "observed_fields": 2,
        "sampled_fields": [{"type": "string"}, {"type": "number"}],
        "omitted_fields": 0,
        "field_names": "unknown",
    }
    assert item["channels"]["json"]["items"][0]["sampled_fields"][0] == {
        "type": "array",
        "observed_length": 0,
        "sampled_items": 0,
        "items": [],
        "truncated": False,
    }
    assert "files" not in item["channels"]
    encoded = json.dumps(evidence)
    for value in ("https://private.example/release", "private-file", '"count": 7'):
        assert value not in encoded


@pytest.mark.parametrize(
    "case", ["missing-history", "drift", "duplicate", "unavailable", "failed", "unrelated", "retry", "loop"]
)
def test_unknown_or_ambiguous_provenance_has_no_tool_shape(case: str) -> None:
    graph, rows = tool_graph(), tool_rows()
    history = deepcopy(graph)
    if case == "missing-history":
        history.clear()
    elif case == "drift":
        graph["nodes"][0]["data"]["tool_name"] = "other"
    elif case == "duplicate":
        rows.insert(0, deepcopy(rows[0]))
    elif case == "unavailable":
        rows[0].outputs_available = False
    elif case == "failed":
        rows[0].status = "failed"
    elif case == "unrelated":
        history["edges"].clear()
        graph["edges"].clear()
    elif case == "retry":
        history["nodes"][0]["data"]["retry_config"] = {"retry_enabled": True}
        graph = deepcopy(history)
    else:
        history["nodes"][0]["data"]["isInIteration"] = True
        graph = deepcopy(history)
    assert observe(graph, rows, history)["tool_output_observations"] == []


@pytest.mark.parametrize(
    ("text", "state"),
    [
        ("not json", "malformed"),
        ("x" * 20000, "oversized"),
        ("[]", "parsed"),
        ('[1,{"name":"private"},null]', "parsed"),
    ],
)
def test_text_parse_state_and_samples_never_claim_universal_items(text: str, state: str) -> None:
    evidence = observe(tool_graph(), tool_rows(text))
    observed = evidence["tool_output_observations"]
    assert isinstance(observed, list)
    channel = observed[0]["channels"]["text"]
    assert channel["json_parse_state"] == state
    assert "required" not in json.dumps(observed)
    assert "private" not in json.dumps(observed)


def test_structure_limits_and_unsafe_dynamic_keys_are_explicit() -> None:
    value: object = {"name": "private"}
    for _ in range(12):
        nested: dict[str, object] = {"nested": value}
        value = nested
    rows = tool_rows(
        json.dumps(
            {
                "safe": value,
                "https://private.example/key": "secret",
                "client_secret": "secret",
                "a" * 200: "secret",
                "records": list(range(50)),
            }
        )
    )
    evidence = observe(tool_graph(), rows)
    encoded = json.dumps(evidence)
    assert "omitted_fields" in encoded
    assert '"truncated": true' in encoded
    assert "private.example" not in encoded
    assert "client_secret" not in encoded
    assert "secret" not in encoded
    assert "a" * 200 not in encoded
    assert len(encoded.encode()) <= MAX_CONTEXT_BYTES


def test_projection_reaches_existing_diagnose_and_propose_requests() -> None:
    graph, rows = (
        tool_graph(),
        tool_rows(json.dumps({"AliceSmith": {"MapleAcquisition": "https://private.example/release"}})),
    )
    rows[0].outputs["json"] = {"CustomerAccount": {"account123": "private-value"}}
    run, safe_graph, safe_rows, evidence = build_evidence(Run(status="failed"), graph, graph, rows)
    capture = CapturingModel()
    model = PolicyModelInstance(lambda: capture)
    diagnosis = fix.diagnose(model, run, safe_graph, safe_rows, evidence=evidence)
    fix.propose_repair(model, diagnosis, graph)
    assert len(capture.message_batches) == 2
    for messages in capture.message_batches:
        user = str(messages[1].content)
        system = str(messages[0].content)
        assert "tool_output_observations" in user
        assert "same_run_observation_not_schema" in user
        assert "observation" in system
        assert "universal" in system
        for value in (
            "https://private.example/release",
            "AliceSmith",
            "MapleAcquisition",
            "CustomerAccount",
            "account123",
            "private-value",
        ):
            assert value not in user
            assert value not in system
    assert diagnosis.condition_evidence == evidence


def test_tool_count_and_combined_byte_limits_report_omissions() -> None:
    graph, rows = tool_graph(), tool_rows()
    for index in range(12):
        node = deepcopy(graph["nodes"][0])
        node["id"] = f"tool-{index}"
        graph["nodes"].append(node)
        graph["edges"].append({"source": node["id"], "target": "consumer"})
        row = deepcopy(rows[0])
        row.node_id = node["id"]
        rows.append(row)
    evidence = observe(graph, rows)
    observed = evidence["tool_output_observations"]
    assert isinstance(observed, list)
    assert len(observed) <= 8
    assert evidence["tool_output_observations_omitted"] is True
    assert len(json.dumps(evidence).encode()) <= MAX_CONTEXT_BYTES


def test_malformed_tool_identity_is_never_copied_as_runtime_values() -> None:
    graph = tool_graph()
    graph["nodes"][0]["data"]["provider_id"] = {"url": "https://private.example"}
    assert observe(graph, tool_rows())["tool_output_observations"] == []


@pytest.mark.parametrize(
    "key",
    [
        "api_key",
        "apiKey",
        "access-token",
        "privateKey",
        "BearerToken",
        "client_secret",
        "https://private.example",
        "user@example.com",
        "123e4567-e89b-12d3-a456-426614174000",
    ],
)
def test_unsafe_field_names_are_omitted_even_when_they_look_like_identifiers(key: str) -> None:
    evidence = observe(tool_graph(), tool_rows(json.dumps({"records": {key: "private", "name": "private"}})))
    encoded = json.dumps(evidence)
    assert key not in encoded
    assert '"sampled_fields": [{"type": "string"}, {"type": "string"}]' in encoded
    assert '"observed_fields": 2' in encoded
    assert '"omitted_fields": 0' in encoded


@pytest.mark.parametrize("text", [chr(0xD800), chr(0xDFFF), '{"name":"' + chr(0xD800) + '"}'])
def test_invalid_unicode_text_is_malformed_without_losing_independent_json_structure(text: str) -> None:
    from services.dify_builder.tool_output_evidence import tool_output_observations

    rows = tool_rows(text)
    original = deepcopy(rows)
    observations, omitted = tool_output_observations(tool_graph(), rows, "consumer")
    assert omitted is False
    channels = dictionary(observations[0]["channels"])
    assert channels["text"] == {"type": "string", "json_parse_state": "malformed"}
    assert dictionary(channels["json"])["type"] == "array"
    assert rows == original
    assert len(json.dumps(observations).encode()) <= MAX_CONTEXT_BYTES


@pytest.mark.parametrize("channel", ["json", "text"])
def test_runtime_data_keys_have_no_field_provenance_in_either_channel(channel: str) -> None:
    from services.dify_builder.tool_output_evidence import tool_output_observations

    keys = [
        "AliceSmith",
        "MapleAcquisition",
        "CustomerAccount",
        "account123",
        "客户账户",
        "mApLe",
        "api_key",
        "BearerToken",
        "client_secret",
    ]
    payload = {"privateRecords": [{key: {"amount": 37, "status": "confidential"}} for key in keys]}
    rows = tool_rows()
    rows[0].outputs = {channel: json.dumps(payload) if channel == "text" else payload}
    observations, omitted = tool_output_observations(tool_graph(), rows, "consumer")
    encoded = json.dumps(observations, ensure_ascii=False)
    assert omitted is False
    for value in [*keys, "privateRecords", "amount", "status", "confidential"]:
        assert value not in encoded
    channels = dictionary(observations[0]["channels"])
    shape = dictionary(channels[channel])
    if channel == "text":
        assert shape["json_parse_state"] == "parsed"
        shape = dictionary(shape["parsed_json"])
    assert shape["type"] == "object"
    assert shape["observed_fields"] == 1
    assert shape["field_names"] == "unknown"
    fields = shape["sampled_fields"]
    assert isinstance(fields, list)
    assert len(fields) == 1
    records = dictionary(fields[0])
    assert records["observed_length"] == 9
    assert records["sampled_items"] == 8
    assert records["truncated"] is True
    items = records["items"]
    assert isinstance(items, list)
    assert dictionary(items[0])["sampled_fields"] == [
        {
            "type": "object",
            "observed_fields": 2,
            "sampled_fields": [{"type": "number"}, {"type": "string"}],
            "omitted_fields": 0,
            "field_names": "unknown",
        }
    ]


def test_anonymous_object_samples_preserve_empty_heterogeneity_and_all_shape_limits() -> None:
    from services.dify_builder.tool_output_evidence import tool_output_observations

    rows = tool_rows()
    rows[0].outputs = {"json": [{}, {"AliceSmith": 9}, [], None, False, "private"]}
    observations, omitted = tool_output_observations(tool_graph(), rows, "consumer")
    assert omitted is False
    shape = dictionary(dictionary(observations[0]["channels"])["json"])
    assert shape == {
        "type": "array",
        "observed_length": 6,
        "sampled_items": 6,
        "truncated": False,
        "items": [
            {
                "type": "object",
                "observed_fields": 0,
                "sampled_fields": [],
                "omitted_fields": 0,
                "field_names": "unknown",
            },
            {
                "type": "object",
                "observed_fields": 1,
                "sampled_fields": [{"type": "number"}],
                "omitted_fields": 0,
                "field_names": "unknown",
            },
            {"type": "array", "observed_length": 0, "sampled_items": 0, "items": [], "truncated": False},
            {"type": "null"},
            {"type": "boolean"},
            {"type": "string"},
        ],
    }
    rows[0].outputs = {"json": {f"Customer{index}": "private" for index in range(30)}}
    observations, _ = tool_output_observations(tool_graph(), rows, "consumer")
    assert dictionary(dictionary(observations[0]["channels"])["json"]) == {
        "type": "object",
        "observed_fields": 30,
        "sampled_fields": [{"type": "string"}] * 24,
        "omitted_fields": 6,
        "field_names": "unknown",
    }
    rows[0].outputs = {"json": [{f"Customer{index}": list(range(20)) for index in range(30)} for _ in range(20)]}
    observations, _ = tool_output_observations(tool_graph(), rows, "consumer")
    bounded = dictionary(dictionary(observations[0]["channels"])["json"])
    items = bounded["items"]
    assert isinstance(items, list)
    first = dictionary(items[0])
    assert first["observed_fields"] == 30
    fields = first["sampled_fields"]
    assert isinstance(fields, list)
    assert len(fields) == 14
    assert first["omitted_fields"] == 30 - len(fields)
    assert bounded["sampled_items"] == 1
    assert bounded["truncated"] is True
    assert len(json.dumps(observations).encode()) <= MAX_CONTEXT_BYTES
