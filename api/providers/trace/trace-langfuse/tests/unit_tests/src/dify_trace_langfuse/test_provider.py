import base64

import pytest
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langfuse.provider import MAX_BATCH_BYTES, LangfuseProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.ids import span_uuid
from dify_trace_sdk.testing import (
    MESSAGE_ID,
    WORKFLOW_RUN_ID,
    RecordingEgress,
    message_trace,
    nested_workflow_fragment,
    response,
    tool_fragment,
    workflow_trace,
)

CONFIG = LangfuseConfig(public_key="pk-lf-1", secret_key="sk-lf-1", host="https://cloud.langfuse.com")


def _provider(*responses: EgressResponse | Exception) -> tuple[LangfuseProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return LangfuseProvider(egress), egress


def _sent_events(egress: RecordingEgress) -> list[dict]:
    (sent,) = egress.requests
    body = sent.json()
    assert isinstance(body, dict)
    return body["batch"]


def test_verify_resolves_the_project() -> None:
    provider, egress = _provider(response(200, {"data": [{"id": "project-1", "name": "Dify"}]}))
    verified = provider.verify(CONFIG)
    assert verified.project_key == "project-1"
    assert provider.project_url(verified) == "https://cloud.langfuse.com/project/project-1"
    (sent,) = egress.requests
    assert sent.method == "GET"
    assert sent.url == "https://cloud.langfuse.com/api/public/projects"
    assert sent.headers["Authorization"] == "Basic " + base64.b64encode(b"pk-lf-1:sk-lf-1").decode()


@pytest.mark.parametrize(
    ("outcome", "code"),
    [
        (response(401, {}), "authentication_failed"),
        (response(500, {}), "endpoint_unavailable"),
        (response(200, {"data": []}), "project_not_found"),
        (response(200, b"not json"), "malformed_response"),
        (EgressError("refused", request_sent=False), "connection_failed"),
    ],
)
def test_verify_failures_have_stable_codes(outcome: EgressResponse | Exception, code: str) -> None:
    provider, _ = _provider(outcome)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == code


def test_message_trace_becomes_trace_and_generation() -> None:
    provider, egress = _provider(response(207, {"successes": [], "errors": []}))
    trace = message_trace()
    result = provider.send(CONFIG.model_copy(update={"project_key": "project-1"}), trace)

    trace_event, generation = _sent_events(egress)
    assert trace_event["type"] == "trace-create"
    assert trace_event["body"]["id"] == MESSAGE_ID
    assert trace_event["body"]["sessionId"] == "conversation-1"
    assert trace_event["body"]["userId"] == "end-user-1"
    assert generation["type"] == "generation-create"
    body = generation["body"]
    assert body["traceId"] == MESSAGE_ID
    assert "parentObservationId" not in body
    assert body["model"] == "gpt-4o"
    assert body["usage"] == {"input": 12, "output": 8, "total": 20, "unit": "TOKENS", "totalCost": 0.0004}
    assert body["completionStartTime"] == "2026-10-01T08:00:00.250000+00:00"
    assert result.trace_id == MESSAGE_ID
    assert result.trace_url == f"https://cloud.langfuse.com/project/project-1/traces/{MESSAGE_ID}"


def test_workflow_spans_keep_hierarchy_and_errors() -> None:
    provider, egress = _provider(response(200, {}))
    trace = workflow_trace()
    provider.send(CONFIG, trace)

    _, llm, tool = _sent_events(egress)
    assert "parentObservationId" not in llm["body"]
    assert tool["body"]["parentObservationId"] == str(span_uuid(trace.trace_id, trace.spans[1].span_id))
    assert tool["type"] == "span-create"
    assert tool["body"]["level"] == "ERROR"
    assert tool["body"]["statusMessage"] == "Tool failed"


def test_fragment_joins_the_message_trace_without_recreating_it() -> None:
    provider, egress = _provider(response(207, {"successes": [{"id": "x", "status": 201}], "errors": []}))
    provider.send(CONFIG, tool_fragment())

    (tool,) = _sent_events(egress)
    assert tool["type"] == "span-create"
    assert tool["body"]["traceId"] == MESSAGE_ID
    assert "parentObservationId" not in tool["body"]


def test_nested_workflow_hangs_from_the_tool_node_that_started_it() -> None:
    provider, egress = _provider(response(207, {"successes": [{"id": "x", "status": 201}], "errors": []}))
    fragment = nested_workflow_fragment()
    assert fragment.parent is not None

    provider.send(CONFIG, fragment)

    run, node = _sent_events(egress)
    assert [run["type"], node["type"]] == ["span-create", "span-create"]
    assert run["body"]["traceId"] == node["body"]["traceId"] == WORKFLOW_RUN_ID
    assert run["body"]["parentObservationId"] == str(span_uuid(fragment.trace_id, fragment.parent.span_id))
    assert node["body"]["parentObservationId"] == run["body"]["id"]


def test_external_trace_id_is_kept_verbatim() -> None:
    provider, egress = _provider(response(200, {}))
    trace = message_trace().model_copy(update={"external_trace_id": "caller-trace-1"})
    assert provider.send(CONFIG, trace).trace_id == "caller-trace-1"
    trace_event, generation = _sent_events(egress)
    assert trace_event["body"]["id"] == "caller-trace-1"
    assert generation["body"]["traceId"] == "caller-trace-1"


def test_event_ids_are_stable_across_redelivery() -> None:
    first, first_egress = _provider(response(200, {}))
    second, second_egress = _provider(response(200, {}))
    first.send(CONFIG, workflow_trace())
    second.send(CONFIG, workflow_trace())
    assert [event["id"] for event in _sent_events(first_egress)] == [
        event["id"] for event in _sent_events(second_egress)
    ]


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (
            response(207, {"successes": [], "errors": [{"id": "e", "status": 400, "message": "bad"}]}),
            ExportRejectedError,
        ),
        (
            response(207, {"successes": [], "errors": [{"id": "e", "status": 500, "message": "busy"}]}),
            ExportRetryableError,
        ),
        (response(401, {}), ExportRejectedError),
        (EgressError("read timeout", request_sent=True), ExportRetryableError),
    ],
)
def test_send_failures_are_classified(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
    provider, _ = _provider(outcome)
    with pytest.raises(expected):
        provider.send(CONFIG, message_trace())


def test_unreadable_ingestion_bodies_are_resent() -> None:
    provider, _ = _provider(EgressResponse(status_code=200, headers={}, content=b"<html>proxy</html>"))
    with pytest.raises(ExportRetryableError):
        provider.send(CONFIG, message_trace())


def test_batches_are_sized_in_bytes() -> None:
    wide = message_trace().model_copy(
        update={
            "spans": tuple(
                span.model_copy(update={"inputs": "中" * (MAX_BATCH_BYTES // 4)}) for span in message_trace().spans
            )
        }
    )
    provider, egress = _provider(
        response(207, {"successes": [], "errors": []}), response(207, {"successes": [], "errors": []})
    )

    provider.send(CONFIG, wide)

    assert len(egress.requests) >= 2
    assert all(len(request.content or b"") <= MAX_BATCH_BYTES * 1.1 for request in egress.requests)
