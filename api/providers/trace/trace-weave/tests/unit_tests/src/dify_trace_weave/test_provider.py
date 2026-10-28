import base64
import subprocess
import sys
from typing import Any
from uuid import UUID, uuid5

import pytest
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.model import Trace
from dify_trace_sdk.provider import SendResult
from dify_trace_sdk.testing import (
    MESSAGE_ID,
    WORKFLOW_RUN_ID,
    RecordedRequest,
    RecordingEgress,
    message_trace,
    nested_workflow_fragment,
    response,
    tool_fragment,
    workflow_trace,
)
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.provider import WeaveProvider
from pydantic import JsonValue

CONFIG = WeaveConfig(api_key="weave-key", entity="team", project="demo")
AUTHORIZATION = "Basic " + base64.b64encode(b"api:weave-key").decode()
TRACE_SERVER = "https://trace.wandb.ai"
CALLS_URL = "https://wandb.ai/team/demo/r/call"
PROJECT = {"id": "project-1", "name": "demo", "entityName": "team", "readOnly": False}
PROJECT_ANSWER = response(200, {"data": {"viewer": {"id": "viewer-1"}, "project": PROJECT}})
STATS = response(200, {"count": 0})


def _provider(*responses: EgressResponse | Exception) -> tuple[WeaveProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return WeaveProvider(egress), egress


def _body(request: RecordedRequest) -> dict[str, Any]:
    body = request.json()
    assert isinstance(body, dict)
    return body


def _call_id(trace: Trace, span_id: str) -> str:
    return str(uuid5(UUID(hex=trace.trace_id), span_id))


def _acknowledgments(trace: Trace) -> list[EgressResponse | Exception]:
    """What the trace server answers to every call start and end of ``trace``."""
    trace_key = str(UUID(hex=trace.trace_id))
    starts: list[EgressResponse | Exception] = [
        response(200, {"id": _call_id(trace, span.span_id), "trace_id": trace_key}) for span in trace.spans
    ]
    return starts + [response(200, {}) for _ in trace.spans]


def _with_root(trace: Trace, **fields: JsonValue) -> Trace:
    return trace.model_copy(update={"spans": (trace.root.model_copy(update=fields), *trace.spans[1:])})


def test_verify_checks_the_project_and_trace_server_with_read_only_requests() -> None:
    provider, egress = _provider(PROJECT_ANSWER, STATS)
    assert provider.verify(CONFIG) == CONFIG

    graphql, stats = egress.requests
    assert graphql.url == "https://api.wandb.ai/graphql"
    query = _body(graphql)
    assert "mutation" not in query["query"]
    assert query["variables"] == {"entity": "team", "project": "demo"}
    assert stats.url == "https://trace.wandb.ai/calls/query_stats"
    assert _body(stats) == {"project_id": "team/demo", "limit": 1}
    assert all(request.method == "POST" for request in egress.requests)
    assert all(request.headers["Authorization"] == AUTHORIZATION for request in egress.requests)


@pytest.mark.parametrize(
    ("entity", "project", "lookups"),
    [("team", "demo", 0), (None, "team/demo", 0), (" team ", " demo ", 0), (None, "demo", 1)],
)
def test_verify_resolves_the_entity_and_project(entity: str | None, project: str, lookups: int) -> None:
    viewer = response(200, {"data": {"viewer": {"id": "viewer-1", "entity": "team"}}})
    provider, egress = _provider(*([viewer] * lookups), PROJECT_ANSWER, STATS)
    verified = provider.verify(WeaveConfig(api_key="weave-key", entity=entity, project=project))
    assert (verified.entity, verified.project) == ("team", "demo")
    assert len(egress.requests) == lookups + 2


def test_verify_keeps_private_path_prefixes() -> None:
    config = WeaveConfig(
        api_key="weave-key",
        entity="team",
        project="demo",
        host="http://wandb.internal/wandb/",
        endpoint="https://trace.internal/proxy/",
    )
    provider, egress = _provider(PROJECT_ANSWER, STATS)
    provider.verify(config)
    assert [request.url for request in egress.requests] == [
        "http://wandb.internal/wandb/graphql",
        "https://trace.internal/proxy/calls/query_stats",
    ]


@pytest.mark.parametrize(
    ("entity", "project"),
    [
        ("team", ""),
        ("team", ".."),
        ("/", "demo"),
        (None, "/demo"),
        (None, "team/"),
        (None, "team/sub/demo"),
        ("other", "team/demo"),
        ("team", "de\\mo"),
        ("team", "de\nmo"),
    ],
)
def test_verify_rejects_unusable_names_before_any_request(entity: str | None, project: str) -> None:
    provider, egress = _provider()
    with pytest.raises(VerificationError) as caught:
        provider.verify(WeaveConfig(api_key="weave-key", entity=entity, project=project))
    assert caught.value.code == "invalid_project"
    assert egress.requests == []


def test_verify_requires_an_api_key() -> None:
    provider, egress = _provider()
    with pytest.raises(VerificationError) as caught:
        provider.verify(WeaveConfig(api_key=" ", entity="team", project="demo"))
    assert caught.value.code == "authentication_failed"
    assert egress.requests == []


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        (response(401, {"error": "DO_NOT_EXPOSE"}), "authentication_failed"),
        (response(403, {}), "permission_denied"),
        (response(302, {}), "endpoint_unavailable"),
        (response(404, {}), "endpoint_unavailable"),
        (response(429, {}), "endpoint_unavailable"),
        (response(503, {}), "endpoint_unavailable"),
        (response(200, b"not json"), "malformed_response"),
        (response(200, []), "malformed_response"),
        (response(200, {"errors": [{"message": "DO_NOT_EXPOSE"}]}), "graphql_error"),
        (response(200, {"errors": "DO_NOT_EXPOSE"}), "malformed_response"),
        (response(200, {"data": []}), "malformed_response"),
        (response(200, {"data": {}}), "malformed_response"),
        (EgressError("DO_NOT_EXPOSE", request_sent=True), "connection_failed"),
        (EgressBlockedError("DO_NOT_EXPOSE"), "connection_failed"),
    ],
)
def test_verify_failures_have_stable_codes(outcome: EgressResponse | Exception, code: str) -> None:
    provider, egress = _provider(outcome)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == code
    assert str(caught.value) == code
    assert len(egress.requests) == 1


@pytest.mark.parametrize(
    ("data", "code"),
    [
        ({"viewer": {"id": "viewer-1"}, "project": None}, "project_not_found_or_inaccessible"),
        ({"viewer": None, "project": PROJECT}, "authentication_failed"),
        ({"viewer": {"id": ""}, "project": PROJECT}, "malformed_response"),
        ({"viewer": {"id": "viewer-1"}}, "malformed_response"),
        ({"viewer": {"id": "viewer-1"}, "project": {**PROJECT, "readOnly": True}}, "project_read_only"),
        ({"viewer": {"id": "viewer-1"}, "project": {**PROJECT, "readOnly": None}}, "project_permission_unknown"),
        ({"viewer": {"id": "viewer-1"}, "project": {**PROJECT, "readOnly": "false"}}, "malformed_response"),
        ({"viewer": {"id": "viewer-1"}, "project": {**PROJECT, "id": ""}}, "malformed_response"),
        ({"viewer": {"id": "viewer-1"}, "project": {**PROJECT, "name": "other"}}, "invalid_project"),
        ({"viewer": {"id": "viewer-1"}, "project": {**PROJECT, "entityName": "other"}}, "invalid_project"),
    ],
)
def test_verify_requires_an_existing_writable_project(data: dict[str, object], code: str) -> None:
    provider, egress = _provider(response(200, {"data": data}))
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == code
    assert len(egress.requests) == 1


@pytest.mark.parametrize(
    ("data", "code"),
    [
        ({}, "malformed_response"),
        ({"viewer": None}, "authentication_failed"),
        ({"viewer": {"id": "viewer-1", "entity": None}}, "invalid_project"),
        ({"viewer": {"id": "viewer-1", "entity": "team/other"}}, "invalid_project"),
        ({"viewer": {"id": "viewer-1", "entity": 7}}, "malformed_response"),
    ],
)
def test_verify_needs_a_default_entity_when_none_is_configured(data: dict[str, object], code: str) -> None:
    provider, egress = _provider(response(200, {"data": data}))
    with pytest.raises(VerificationError) as caught:
        provider.verify(WeaveConfig(api_key="weave-key", project="demo"))
    assert caught.value.code == code
    assert len(egress.requests) == 1


@pytest.mark.parametrize("count", [-1, True, "0", None])
def test_verify_rejects_unusable_trace_server_answers(count: object) -> None:
    provider, egress = _provider(PROJECT_ANSWER, response(200, {"count": count}))
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == "malformed_response"
    assert len(egress.requests) == 2


@pytest.mark.parametrize(
    ("config", "url"),
    [
        (CONFIG, "https://wandb.ai/team/demo"),
        (WeaveConfig(api_key="k", project="team/demo"), "https://wandb.ai/team/demo"),
        (WeaveConfig(api_key="k", project="demo"), "https://wandb.ai"),
        (WeaveConfig(api_key="k", project="team/sub/demo"), "https://wandb.ai"),
        (
            WeaveConfig(api_key="k", entity="team", project="demo", host="https://API.WANDB.AI:443/"),
            "https://wandb.ai/team/demo",
        ),
        (
            WeaveConfig(api_key="k", entity="team one", project="demo & notes#", host="http://wandb.internal/wandb/"),
            "http://wandb.internal/wandb/team%20one/demo%20%26%20notes%23",
        ),
    ],
)
def test_project_url_makes_no_requests(config: WeaveConfig, url: str) -> None:
    provider, egress = _provider()
    assert provider.project_url(config) == url
    assert egress.requests == []


def test_message_trace_wire_format() -> None:
    trace = message_trace()
    provider, egress = _provider(*_acknowledgments(trace))
    result = provider.send(CONFIG, trace)

    message, llm = trace.spans
    message_call, llm_call = _call_id(trace, message.span_id), _call_id(trace, llm.span_id)
    assert [request.url for request in egress.requests] == [
        f"{TRACE_SERVER}/call/start",
        f"{TRACE_SERVER}/call/start",
        f"{TRACE_SERVER}/call/end",
        f"{TRACE_SERVER}/call/end",
    ]
    assert all(request.method == "POST" for request in egress.requests)
    assert all(request.headers["Authorization"] == AUTHORIZATION for request in egress.requests)
    assert all(request.headers["Content-Type"] == "application/json" for request in egress.requests)
    assert [_body(request) for request in egress.requests] == [
        {
            "start": {
                "project_id": "team/demo",
                "id": message_call,
                "op_name": "message",
                "display_name": "message",
                "trace_id": MESSAGE_ID,
                "parent_id": None,
                "thread_id": "conversation-1",
                "turn_id": message_call,
                "started_at": "2026-10-01T08:00:00+00:00",
                "attributes": {
                    "message_id": MESSAGE_ID,
                    "app_id": "app-1",
                    "tenant_id": "tenant-1",
                    "dify_span_kind": "chain",
                    "dify_span_id": message.span_id,
                },
                "inputs": {"query": "What is Dify?"},
            }
        },
        {
            "start": {
                "project_id": "team/demo",
                "id": llm_call,
                "op_name": "llm",
                "display_name": "llm",
                "trace_id": MESSAGE_ID,
                "parent_id": message_call,
                "thread_id": "conversation-1",
                "turn_id": message_call,
                "started_at": "2026-10-01T08:00:00+00:00",
                "attributes": {"message_id": MESSAGE_ID, "dify_span_kind": "llm", "dify_span_id": llm.span_id},
                "inputs": {"input": [{"role": "user", "content": "What is Dify?"}]},
            }
        },
        {
            "end": {
                "project_id": "team/demo",
                "id": llm_call,
                "ended_at": "2026-10-01T08:00:02+00:00",
                "exception": None,
                "output": "An LLM application platform.",
                "summary": {
                    "usage": {
                        "gpt-4o": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20, "requests": 1}
                    }
                },
            }
        },
        {
            "end": {
                "project_id": "team/demo",
                "id": message_call,
                "ended_at": "2026-10-01T08:00:02+00:00",
                "exception": None,
                "output": "An LLM application platform.",
                "summary": {},
            }
        },
    ]
    assert result == SendResult(
        trace_id=MESSAGE_ID,
        trace_url=f"{CALLS_URL}/{message_call}",
        span_urls={message.span_id: f"{CALLS_URL}/{message_call}", llm.span_id: f"{CALLS_URL}/{llm_call}"},
    )


def test_workflow_trace_wire_format() -> None:
    trace = workflow_trace()
    provider, egress = _provider(*_acknowledgments(trace))
    provider.send(CONFIG, trace)

    run, llm, tool = trace.spans
    run_call, llm_call, tool_call = (_call_id(trace, span.span_id) for span in trace.spans)
    assert [request.url.rsplit("/", 1)[1] for request in egress.requests] == ["start"] * 3 + ["end"] * 3
    assert [_body(request) for request in egress.requests] == [
        {
            "start": {
                "project_id": "team/demo",
                "id": run_call,
                "op_name": "workflow",
                "display_name": "workflow",
                "trace_id": WORKFLOW_RUN_ID,
                "parent_id": None,
                "thread_id": WORKFLOW_RUN_ID,
                "turn_id": run_call,
                "started_at": "2026-10-01T08:00:00+00:00",
                "attributes": {
                    "workflow_run_id": WORKFLOW_RUN_ID,
                    "app_id": "app-1",
                    "dify_span_kind": "chain",
                    "dify_span_id": run.span_id,
                },
                "inputs": {"topic": "tracing"},
            }
        },
        {
            "start": {
                "project_id": "team/demo",
                "id": llm_call,
                "op_name": "llm_Summarize",
                "display_name": "llm_Summarize",
                "trace_id": WORKFLOW_RUN_ID,
                "parent_id": run_call,
                "thread_id": WORKFLOW_RUN_ID,
                "turn_id": run_call,
                "started_at": "2026-10-01T08:00:01+00:00",
                "attributes": {
                    "node_execution_id": "node-execution-llm",
                    "node_type": "llm",
                    "dify_span_kind": "llm",
                    "dify_span_id": llm.span_id,
                },
                "inputs": {"input": [{"role": "user", "content": "Summarize tracing"}]},
            }
        },
        {
            "start": {
                "project_id": "team/demo",
                "id": tool_call,
                "op_name": "tool_Search",
                "display_name": "tool_Search",
                "trace_id": WORKFLOW_RUN_ID,
                "parent_id": llm_call,
                "thread_id": WORKFLOW_RUN_ID,
                "turn_id": run_call,
                "started_at": "2026-10-01T08:00:03+00:00",
                "attributes": {
                    "node_execution_id": "node-execution-tool",
                    "node_type": "tool",
                    "dify_span_kind": "tool",
                    "dify_span_id": tool.span_id,
                },
                "inputs": {"query": "tracing"},
            }
        },
        {
            "end": {
                "project_id": "team/demo",
                "id": tool_call,
                "ended_at": "2026-10-01T08:00:05+00:00",
                "exception": "Tool failed",
                "output": {},
                "summary": {},
            }
        },
        {
            "end": {
                "project_id": "team/demo",
                "id": llm_call,
                "ended_at": "2026-10-01T08:00:03+00:00",
                "exception": None,
                "output": {"text": "Tracing records execution."},
                "summary": {
                    "usage": {
                        "gpt-4o": {"prompt_tokens": 30, "completion_tokens": 10, "total_tokens": 40, "requests": 1}
                    }
                },
            }
        },
        {
            "end": {
                "project_id": "team/demo",
                "id": run_call,
                "ended_at": "2026-10-01T08:00:05+00:00",
                "exception": "Tool failed",
                "output": {},
                "summary": {},
            }
        },
    ]


def test_fragment_joins_the_message_call_without_naming_a_turn() -> None:
    message = message_trace()
    message_provider, message_egress = _provider(*_acknowledgments(message))
    message_provider.send(CONFIG, message)
    message_start = _body(message_egress.requests[0])["start"]

    fragment = tool_fragment()
    provider, egress = _provider(*_acknowledgments(fragment))
    result = provider.send(CONFIG, fragment)

    tool = fragment.root
    tool_call = _call_id(fragment, tool.span_id)
    start, end = (_body(request) for request in egress.requests)
    assert start == {
        "start": {
            "project_id": "team/demo",
            "id": tool_call,
            "op_name": "weather",
            "display_name": "weather",
            "trace_id": message_start["trace_id"],
            "parent_id": message_start["id"],
            "thread_id": "conversation-1",
            "turn_id": None,
            "started_at": "2026-10-01T08:00:00.500000+00:00",
            "attributes": {"message_id": MESSAGE_ID, "dify_span_kind": "tool", "dify_span_id": tool.span_id},
            "inputs": {"city": "Berlin"},
        }
    }
    assert end == {
        "end": {
            "project_id": "team/demo",
            "id": tool_call,
            "ended_at": "2026-10-01T08:00:01+00:00",
            "exception": None,
            "output": "Sunny",
            "summary": {},
        }
    }
    assert result == SendResult(
        trace_id=MESSAGE_ID,
        trace_url=f"{CALLS_URL}/{message_start['id']}",
        span_urls={tool.span_id: f"{CALLS_URL}/{tool_call}"},
    )


def test_nested_workflow_hangs_from_the_tool_node_call_that_started_it() -> None:
    fragment = nested_workflow_fragment()
    assert fragment.parent is not None
    assert fragment.trace_root is not None
    provider, egress = _provider(*_acknowledgments(fragment))

    result = provider.send(CONFIG, fragment)

    run_start, node_start = (_body(request)["start"] for request in egress.requests[:2])
    assert (run_start["trace_id"], node_start["trace_id"]) == (WORKFLOW_RUN_ID, WORKFLOW_RUN_ID)
    assert run_start["parent_id"] == _call_id(fragment, fragment.parent.span_id)
    assert node_start["parent_id"] == run_start["id"]
    assert run_start["turn_id"] is None
    assert result.trace_url == f"{CALLS_URL}/{_call_id(fragment, fragment.trace_root.span_id)}"


def test_unit_without_session_has_no_thread_or_turn() -> None:
    trace = message_trace().model_copy(update={"session_id": None})
    provider, egress = _provider(*_acknowledgments(trace))
    provider.send(CONFIG, trace)
    starts = [_body(request)["start"] for request in egress.requests[:2]]
    assert [(start["thread_id"], start["turn_id"]) for start in starts] == [(None, None), (None, None)]


@pytest.mark.parametrize(
    ("inputs", "expected"),
    [(None, {}), ("What is Dify?", {"input": "What is Dify?"}), ({"query": "q"}, {"query": "q"})],
)
def test_call_inputs_are_objects(inputs: JsonValue, expected: dict[str, JsonValue]) -> None:
    trace = _with_root(message_trace(), inputs=inputs)
    provider, egress = _provider(*_acknowledgments(trace))
    provider.send(CONFIG, trace)
    assert _body(egress.requests[0])["start"]["inputs"] == expected


def test_names_are_cut_to_the_trace_server_limits() -> None:
    trace = _with_root(message_trace(), name="n" * 2000)
    provider, egress = _provider(*_acknowledgments(trace))
    provider.send(CONFIG, trace)
    start = _body(egress.requests[0])["start"]
    assert (start["op_name"], start["display_name"]) == ("n" * 128, "n" * 1024)


def test_redelivery_sends_identical_requests() -> None:
    first, first_egress = _provider(*_acknowledgments(workflow_trace()))
    second, second_egress = _provider(*_acknowledgments(workflow_trace()))
    assert first.send(CONFIG, workflow_trace()) == second.send(CONFIG, workflow_trace())
    assert [request.content for request in first_egress.requests] == [
        request.content for request in second_egress.requests
    ]


def test_send_resolves_an_unset_entity_with_the_configured_key() -> None:
    trace = message_trace()
    viewer = response(200, {"data": {"viewer": {"id": "viewer-1", "entity": "default-team"}}})
    provider, egress = _provider(viewer, *_acknowledgments(trace))
    result = provider.send(WeaveConfig(api_key="weave-key", project="demo", host="https://wandb.internal/w/"), trace)

    lookup, *calls = egress.requests
    assert lookup.url == "https://wandb.internal/w/graphql"
    assert lookup.headers["Authorization"] == AUTHORIZATION
    assert "mutation" not in _body(lookup)["query"]
    assert {_body(request)["start"]["project_id"] for request in calls[:2]} == {"default-team/demo"}
    root_call = _call_id(trace, trace.root.span_id)
    assert result.trace_url == f"https://wandb.internal/w/default-team/demo/r/call/{root_call}"


def test_send_takes_the_entity_from_a_project_path() -> None:
    provider, egress = _provider(*_acknowledgments(message_trace()))
    provider.send(WeaveConfig(api_key="weave-key", project="team/demo"), message_trace())
    assert _body(egress.requests[0])["start"]["project_id"] == "team/demo"


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (response(200, {"data": {"viewer": None}}), ExportRejectedError),
        (response(200, {"data": {"viewer": {"id": "viewer-1", "entity": "team/other"}}}), ExportRejectedError),
        (response(200, {"errors": [{"message": "DO_NOT_EXPOSE"}]}), ExportRejectedError),
        (response(200, b"not json"), ExportRejectedError),
        (response(401, {"error": "DO_NOT_EXPOSE"}), ExportRejectedError),
        (response(503, {}), ExportRetryableError),
        (EgressError("DO_NOT_EXPOSE", request_sent=True), ExportRetryableError),
    ],
)
def test_entity_lookup_failures_write_no_calls(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
    provider, egress = _provider(outcome)
    with pytest.raises(expected) as caught:
        provider.send(WeaveConfig(api_key="weave-key", project="demo"), message_trace())
    assert "DO_NOT_EXPOSE" not in str(caught.value)
    assert len(egress.requests) == 1


@pytest.mark.parametrize(("entity", "project"), [("team", "other/demo"), (None, "team/sub/demo"), ("team", "..")])
def test_send_rejects_unusable_names_before_any_request(entity: str | None, project: str) -> None:
    provider, egress = _provider()
    with pytest.raises(ExportRejectedError):
        provider.send(WeaveConfig(api_key="weave-key", entity=entity, project=project), message_trace())
    assert egress.requests == []


def test_numbers_json_cannot_represent_are_rejected_before_any_request() -> None:
    provider, egress = _provider()
    with pytest.raises(ExportRejectedError):
        provider.send(CONFIG, _with_root(message_trace(), outputs=float("nan")))
    assert egress.requests == []


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (response(503, {"detail": "DO_NOT_EXPOSE"}), ExportRetryableError),
        (response(429, {}), ExportRetryableError),
        (response(401, {"detail": "DO_NOT_EXPOSE"}), ExportRejectedError),
        (EgressError("DO_NOT_EXPOSE", request_sent=False), ExportRetryableError),
        (EgressError("DO_NOT_EXPOSE", request_sent=True), ExportOutcomeUnknownError),
        (EgressBlockedError("DO_NOT_EXPOSE"), ExportRejectedError),
        (response(200, b"not json"), ExportOutcomeUnknownError),
    ],
)
def test_first_call_failures_are_classified(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
    provider, egress = _provider(outcome)
    with pytest.raises(expected) as caught:
        provider.send(CONFIG, message_trace())
    assert "DO_NOT_EXPOSE" not in str(caught.value)
    assert "weave-key" not in str(caught.value)
    assert len(egress.requests) == 1


@pytest.mark.parametrize("failing_request", [1, 2, 3])
@pytest.mark.parametrize(
    "outcome",
    [response(503, {}), response(400, {}), EgressError("connection refused", request_sent=False)],
)
def test_failure_after_an_accepted_call_is_outcome_unknown(
    failing_request: int, outcome: EgressResponse | Exception
) -> None:
    trace = message_trace()
    provider, egress = _provider(*_acknowledgments(trace)[:failing_request], outcome)
    with pytest.raises(ExportOutcomeUnknownError):
        provider.send(CONFIG, trace)
    assert len(egress.requests) == failing_request + 1


@pytest.mark.parametrize("field", ["id", "trace_id"])
@pytest.mark.parametrize("failing_start", [0, 1])
def test_call_start_must_echo_the_submitted_ids(field: str, failing_start: int) -> None:
    trace = message_trace()
    acknowledgment = {"id": _call_id(trace, trace.spans[failing_start].span_id), "trace_id": MESSAGE_ID}
    acknowledgment[field] = "00000000-0000-4000-8000-000000000000"
    provider, egress = _provider(*_acknowledgments(trace)[:failing_start], response(200, acknowledgment))
    with pytest.raises(ExportOutcomeUnknownError):
        provider.send(CONFIG, trace)
    assert len(egress.requests) == failing_start + 1


def test_call_start_may_spell_the_echoed_ids_differently() -> None:
    trace = message_trace()
    starts = [
        response(200, {"id": UUID(_call_id(trace, span.span_id)).hex.upper(), "trace_id": f"{{{MESSAGE_ID}}}"})
        for span in trace.spans
    ]
    provider, egress = _provider(*starts, *(response(200, {}) for _ in trace.spans))
    provider.send(CONFIG, trace)
    assert len(egress.requests) == 4


def test_the_weave_package_is_never_imported() -> None:
    # Importing ``weave`` patches PIL for the whole process.
    check = "import sys, dify_trace_weave.provider; sys.exit('weave' in sys.modules)"
    assert subprocess.run([sys.executable, "-c", check], check=False).returncode == 0
