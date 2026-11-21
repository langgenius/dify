import base64
import json

import pytest
from dify_trace_langfuse.config import LangfuseConfig
from dify_trace_langfuse.provider import MAX_REQUEST_BYTES, LangfuseProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.ids import span_id_for
from dify_trace_sdk.model import Cost, Trace
from dify_trace_sdk.testing import (
    MESSAGE_ID,
    RecordingEgress,
    message_trace,
    otlp_attributes,
    otlp_spans,
    response,
    tool_fragment,
    workflow_trace,
)
from opentelemetry.proto.trace.v1.trace_pb2 import Status
from pydantic import JsonValue

CONFIG = LangfuseConfig(public_key="pk-lf-1", secret_key="sk-lf-1", host="https://cloud.langfuse.com")
OTEL_URL = "https://cloud.langfuse.com/api/public/otel/v1/traces"
# Langfuse replies with its queued job, not an OTLP acknowledgment.
ACK = response(200, {"name": "otel-ingestion-job", "data": {"id": "job-1"}, "opts": {"attempts": 6}, "progress": 0})


def _provider(*responses: EgressResponse | Exception) -> tuple[LangfuseProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return LangfuseProvider(egress), egress


def _sent_attributes(egress: RecordingEgress) -> list[dict[str, object]]:
    return [otlp_attributes(span) for span in otlp_spans(egress)]


def test_verify_resolves_the_project() -> None:
    provider, egress = _provider(response(200, {"data": [{"id": "project-1", "name": "Dify"}]}))
    verified = provider.verify(CONFIG)
    assert verified.project_key == "project-1"
    assert provider.project_url(verified) == "https://cloud.langfuse.com/project/project-1"
    (sent,) = egress.requests
    assert sent.method == "GET"
    assert sent.url == "https://cloud.langfuse.com/api/public/projects"
    assert sent.headers["Authorization"] == "Basic " + base64.b64encode(b"pk-lf-1:sk-lf-1").decode()


def test_legacy_config_keeps_project_and_trace_links_without_verification() -> None:
    provider, egress = _provider(ACK)
    config = LangfuseConfig.model_validate(
        {
            "public_key": "pk-lf-1",
            "secret_key": "sk-lf-1",
            "host": "https://collector.example/langfuse",
            "project_url": "https://dashboard.example/langfuse/project/legacy-project/",
        }
    )
    trace = message_trace()

    result = provider.send(config, trace)

    assert provider.project_url(config) == config.project_url
    trace_url = f"https://dashboard.example/langfuse/project/legacy-project/traces/{trace.trace_id}"
    assert result.trace_url == trace_url
    assert result.span_urls == {span.span_id: f"{trace_url}?observation={span.span_id}" for span in trace.spans}
    assert [request.url for request in egress.requests] == [
        "https://collector.example/langfuse/api/public/otel/v1/traces"
    ]
    verified = config.model_copy(update={"project_key": "new-project"})
    assert provider.project_url(verified) == "https://collector.example/langfuse/project/new-project"


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


def test_send_posts_otlp_protobuf_with_v4_ingestion_header() -> None:
    provider, egress = _provider(ACK)

    provider.send(CONFIG, message_trace())

    (sent,) = egress.requests
    assert (sent.method, sent.url) == ("POST", OTEL_URL)
    assert sent.headers["Authorization"] == "Basic " + base64.b64encode(b"pk-lf-1:sk-lf-1").decode()
    assert sent.headers["Content-Type"] == "application/x-protobuf"
    assert sent.headers["x-langfuse-ingestion-version"] == "4"


def test_message_trace_becomes_a_root_observation_and_a_generation() -> None:
    provider, egress = _provider(ACK)
    trace = message_trace()

    result = provider.send(CONFIG.model_copy(update={"project_key": "project-1"}), trace)

    root, llm = otlp_spans(egress)
    assert root.trace_id.hex() == llm.trace_id.hex() == trace.trace_id
    assert root.span_id.hex() == trace.spans[0].span_id
    assert root.parent_span_id == b""
    assert llm.parent_span_id.hex() == trace.spans[0].span_id
    root_attributes, llm_attributes = otlp_attributes(root), otlp_attributes(llm)
    assert root_attributes["langfuse.observation.type"] == "chain"
    assert root_attributes["langfuse.observation.metadata.app_id"] == "app-1"
    assert json.loads(str(root_attributes["langfuse.observation.output"])) == [
        {"role": "assistant", "content": "An LLM application platform."}
    ]
    assert llm_attributes["langfuse.observation.type"] == "generation"
    assert llm_attributes["langfuse.observation.model.name"] == "gpt-4o"
    assert json.loads(str(llm_attributes["langfuse.observation.usage_details"])) == {
        "input": 12,
        "output": 8,
        "total": 20,
    }
    assert json.loads(str(llm_attributes["langfuse.observation.cost_details"])) == {"total": 0.0004}
    assert llm_attributes["langfuse.observation.completion_start_time"] == "2026-10-01T08:00:00.250000+00:00"
    assert json.loads(str(llm_attributes["langfuse.observation.input"])) == [
        {"role": "user", "content": "What is Dify?"}
    ]
    assert result.trace_id == trace.trace_id
    assert result.trace_url == f"https://cloud.langfuse.com/project/project-1/traces/{trace.trace_id}"
    assert result.span_urls[trace.spans[1].span_id] == f"{result.trace_url}?observation={trace.spans[1].span_id}"


def test_trace_fields_are_repeated_on_every_span() -> None:
    provider, egress = _provider(ACK)

    provider.send(CONFIG, workflow_trace())

    for attributes in _sent_attributes(egress):
        assert attributes["langfuse.trace.name"] == "workflow"
        assert attributes["langfuse.user.id"] == "account-1"
        assert attributes["langfuse.session.id"] == workflow_trace().session_id


@pytest.mark.parametrize(
    ("inputs", "expected"),
    [
        ("Hello", [{"role": "user", "content": "Hello"}]),
        (
            [{"role": "system", "text": "Be brief", "files": []}, {"role": "user", "text": "Hello"}],
            [{"role": "system", "content": "Be brief", "files": []}, {"role": "user", "content": "Hello"}],
        ),
        (
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Describe this"},
                        {"type": "image_url", "image_url": {"url": "https://example.com/image.png"}},
                    ],
                }
            ],
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Describe this"},
                        {"type": "image_url", "image_url": {"url": "https://example.com/image.png"}},
                    ],
                }
            ],
        ),
        ({"text": "workflow data"}, {"text": "workflow data"}),
        ([{"text": "retrieval data"}], [{"text": "retrieval data"}]),
    ],
)
def test_chat_inputs_keep_the_langfuse_preview_format(inputs: JsonValue, expected: JsonValue) -> None:
    provider, egress = _provider(ACK)
    trace = message_trace()
    trace = trace.model_copy(update={"spans": (trace.root, trace.spans[1].model_copy(update={"inputs": inputs}))})
    source = trace.model_dump()

    provider.send(CONFIG, trace)

    _, generation = _sent_attributes(egress)
    assert json.loads(str(generation["langfuse.observation.input"])) == expected
    assert trace.model_dump() == source


def test_absent_values_are_omitted() -> None:
    provider, egress = _provider(ACK)
    trace = message_trace()
    llm = trace.spans[1].model_copy(
        update={"inputs": None, "outputs": None, "usage": None, "cost": None, "time_to_first_token": None}
    )
    trace = trace.model_copy(update={"spans": (trace.root, llm), "user_id": None, "session_id": None})

    provider.send(CONFIG, trace)

    _, generation = _sent_attributes(egress)
    for key in (
        "langfuse.observation.input",
        "langfuse.observation.output",
        "langfuse.observation.usage_details",
        "langfuse.observation.cost_details",
        "langfuse.observation.completion_start_time",
        "langfuse.user.id",
        "langfuse.session.id",
    ):
        assert key not in generation


def test_cost_in_another_currency_is_left_to_langfuse_pricing() -> None:
    provider, egress = _provider(ACK)
    trace = message_trace()
    llm = trace.spans[1].model_copy(update={"cost": Cost(amount=0.003, currency="CNY")})

    provider.send(CONFIG, trace.model_copy(update={"spans": (trace.root, llm)}))

    _, generation = _sent_attributes(egress)
    assert "langfuse.observation.cost_details" not in generation
    assert "langfuse.observation.usage_details" in generation


def test_workflow_spans_keep_hierarchy_and_errors() -> None:
    provider, egress = _provider(ACK)
    trace = workflow_trace()

    provider.send(CONFIG, trace)

    _, llm, tool = otlp_spans(egress)
    assert llm.parent_span_id.hex() == trace.spans[0].span_id
    assert tool.parent_span_id.hex() == trace.spans[1].span_id
    assert otlp_attributes(tool)["langfuse.observation.type"] == "tool"
    assert tool.status.code == Status.STATUS_CODE_ERROR
    assert tool.status.message == "Tool failed"
    assert otlp_attributes(llm)["langfuse.observation.type"] == "generation"
    assert llm.status.code == Status.STATUS_CODE_OK


def test_fragment_joins_the_message_trace_without_renaming_it() -> None:
    provider, egress = _provider(ACK)

    provider.send(CONFIG, tool_fragment())

    (tool,) = otlp_spans(egress)
    assert tool.trace_id.hex() == message_trace().trace_id
    assert tool.parent_span_id.hex() == span_id_for(MESSAGE_ID)
    attributes = otlp_attributes(tool)
    assert "langfuse.trace.name" not in attributes
    assert attributes["langfuse.user.id"] == "end-user-1"


def test_root_carries_the_trace_metadata() -> None:
    provider, egress = _provider(ACK)
    trace = message_trace()

    provider.send(CONFIG, trace)

    root, llm = _sent_attributes(egress)
    assert {key: value for key, value in root.items() if key.startswith("langfuse.trace.metadata.")} == {
        "langfuse.trace.metadata.message_id": MESSAGE_ID,
        "langfuse.trace.metadata.app_id": "app-1",
        "langfuse.trace.metadata.tenant_id": "tenant-1",
        "langfuse.trace.metadata.dify_trace_id": trace.trace_id,
    }
    assert not any(key.startswith("langfuse.trace.metadata.") for key in llm)


def test_external_trace_id_is_kept_as_trace_metadata() -> None:
    provider, egress = _provider(ACK)
    trace = message_trace().model_copy(update={"external_trace_id": "caller-trace-1"})

    assert provider.send(CONFIG, trace).trace_id == trace.trace_id

    root, _ = _sent_attributes(egress)
    assert root["langfuse.trace.metadata.external_trace_id"] == "caller-trace-1"


def test_fragment_does_not_overwrite_the_trace_metadata() -> None:
    provider, egress = _provider(ACK)

    provider.send(CONFIG, tool_fragment())

    (tool,) = _sent_attributes(egress)
    assert not any(key.startswith("langfuse.trace.metadata.") for key in tool)


def test_span_ids_are_stable_across_redelivery() -> None:
    first, first_egress = _provider(ACK)
    second, second_egress = _provider(ACK)
    first.send(CONFIG, workflow_trace())
    second.send(CONFIG, workflow_trace())
    assert [span.span_id for span in otlp_spans(first_egress)] == [span.span_id for span in otlp_spans(second_egress)]


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (response(401, {}), ExportRejectedError),
        (response(413, {}), ExportRejectedError),
        (response(503, {}), ExportRetryableError),
        (EgressError("refused", request_sent=False), ExportRetryableError),
        # Not retried: Langfuse would duplicate spans it already accepted.
        (EgressError("read timeout", request_sent=True), ExportOutcomeUnknownError),
    ],
)
def test_send_failures_are_classified(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
    provider, _ = _provider(outcome)
    with pytest.raises(expected):
        provider.send(CONFIG, message_trace())


@pytest.mark.parametrize(
    "accepted",
    [
        response(200, {}),
        EgressResponse(status_code=200, headers={}, content=b""),
        EgressResponse(status_code=204, headers={"content-type": "text/plain"}, content=b"accepted"),
    ],
)
def test_any_success_status_means_the_request_was_accepted(accepted: EgressResponse) -> None:
    provider, _ = _provider(accepted)
    assert provider.send(CONFIG, message_trace()).trace_id == message_trace().trace_id


def _wide_trace() -> Trace:
    trace = message_trace()
    return trace.model_copy(
        update={
            "spans": tuple(span.model_copy(update={"inputs": "中" * (MAX_REQUEST_BYTES // 4)}) for span in trace.spans)
        }
    )


def test_large_units_are_split_by_size() -> None:
    provider, egress = _provider(ACK, ACK)

    provider.send(CONFIG, _wide_trace())

    assert len(egress.requests) == 2
    assert all(len(request.content or b"") <= MAX_REQUEST_BYTES for request in egress.requests)
    assert [span.span_id.hex() for span in otlp_spans(egress)] == [span.span_id for span in _wide_trace().spans]


def test_a_failure_after_an_accepted_part_is_not_resent() -> None:
    provider, _ = _provider(ACK, response(503, {}))
    with pytest.raises(ExportOutcomeUnknownError):
        provider.send(CONFIG, _wide_trace())


def test_a_failure_of_the_first_part_is_resent() -> None:
    provider, egress = _provider(response(503, {}))
    with pytest.raises(ExportRetryableError):
        provider.send(CONFIG, _wide_trace())
    assert len(egress.requests) == 1
