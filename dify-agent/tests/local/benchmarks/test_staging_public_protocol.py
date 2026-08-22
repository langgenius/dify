from __future__ import annotations

from collections.abc import Callable
import json
from typing import cast

import httpx
import pytest
from pydantic import SecretStr

from benchmarks.capacity_protocol import RequestMetric
from benchmarks.staging_public_protocol import (
    StagingPublicProtocolSettings,
    StagingPublicServiceClient,
    build_staging_public_chat_request,
    probe_staging_public_edge,
    validate_public_benchmark_markers,
)
from benchmarks.staging_public_schemas import StagingPublicScenarioId


_API_KEY = "public-service-key-never-serialize"
_CONFIG_SHA256 = "a" * 64
_CONVERSATION_ID = "019ff510-0000-7000-8000-000000000001"
_TASK_ID = "task-1"


@pytest.fixture
def settings() -> StagingPublicProtocolSettings:
    return StagingPublicProtocolSettings(
        service_api_base_url="https://api-staging.example/v1",
        api_key=SecretStr(_API_KEY),
        config_expected_sha256=_CONFIG_SHA256,
    )


def _marker(
    run_id: str,
    scenario_id: StagingPublicScenarioId,
    *,
    round_number: int,
    kind: str,
) -> str:
    payload = json.dumps(
        {
            "benchmark_run_id": run_id,
            "kind": kind,
            "round": round_number,
            "scenario_id": scenario_id,
            "scenario_version": 1,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return f"DIFY_BENCHMARK_MARKER:{payload}"


def _event(
    event_type: str,
    *,
    conversation_id: str = _CONVERSATION_ID,
    task_id: str = _TASK_ID,
    **values: object,
) -> dict[str, object]:
    return {
        "event": event_type,
        "conversation_id": conversation_id,
        "message_id": "message-1",
        "created_at": 1,
        "task_id": task_id,
        **values,
    }


def _sse_response(
    events: list[dict[str, object]],
    *,
    include_ping: bool = True,
    content_type: str = "text/event-stream; charset=utf-8",
) -> httpx.Response:
    body = "event: ping\n\n" if include_ping else ""
    body += "".join(f"data: {json.dumps(event)}\n\n" for event in events)
    return httpx.Response(
        200,
        text=body,
        headers={"Content-Type": content_type, "x-version": "1.16.1", "server": "cloudflare"},
    )


def _basic_events(run_id: str) -> list[dict[str, object]]:
    marker = _marker(run_id, "basic", round_number=1, kind="terminal")
    return [
        _event("message", answer=marker),
        _event("message_end", id="message-1", metadata={}, files=[]),
    ]


def _shell_events(run_id: str) -> list[dict[str, object]]:
    tool_call = _marker(run_id, "shell", round_number=1, kind="tool_call")
    terminal = _marker(run_id, "shell", round_number=2, kind="terminal")
    return [
        _event("agent_thought", thought=tool_call, observation="", tool="shell_run"),
        _event(
            "agent_thought",
            thought=tool_call,
            observation=_shell_observation(f"DIFY_BENCHMARK_SHELL_OK|{tool_call}"),
            tool="shell_run",
        ),
        _event("message", answer=terminal),
        _event("message_end", id="message-1", metadata={}, files=[]),
    ]


def _escaped_tool_input(marker: str) -> str:
    """Mirror the Service API's JSON-string echo of a tool input."""

    return json.dumps({"script": f"printf '{marker}'"})


def _shell_observation(output: str, *, done: bool = True, exit_code: int | None = 0) -> str:
    metadata = json.dumps(
        {"job_id": "job-1", "status": "exited", "done": done, "exit_code": exit_code},
        separators=(",", ":"),
    )
    return f"<metadata>\n{metadata}\n</metadata>\n\n<output>\n{output}\n</output>"


def _config_events(run_id: str, *, digest: str = _CONFIG_SHA256) -> list[dict[str, object]]:
    tool_call = _marker(run_id, "config", round_number=1, kind="tool_call")
    terminal = _marker(run_id, "config", round_number=2, kind="terminal")
    evidence = f"DIFY_BENCHMARK_CONFIG_SHA256|{tool_call}|items=13|bytes=53248|sha256={digest}"
    return [
        _event("agent_thought", thought=tool_call, observation="", tool="shell_run"),
        _event("agent_thought", thought=tool_call, observation=_shell_observation(evidence), tool="shell_run"),
        _event("message", answer=terminal),
        _event("message_end", id="message-1", metadata={}, files=[]),
    ]


def _client(
    *,
    settings: StagingPublicProtocolSettings,
    handler: Callable[[httpx.Request], httpx.Response],
    metrics: list[RequestMetric] | None = None,
) -> StagingPublicServiceClient:
    sink = metrics if metrics is not None else []
    return StagingPublicServiceClient(
        settings=settings,
        end_user="benchmark-public-user-0",
        recorder=sink.append,
        transport=httpx.MockTransport(handler),
    )


def test_settings_normalize_v1_base_and_never_serialize_key() -> None:
    settings = StagingPublicProtocolSettings(
        service_api_base_url="https://api-staging.example/v1/",
        api_key=SecretStr(_API_KEY),
        config_expected_sha256=_CONFIG_SHA256.upper(),
    )

    assert settings.service_api_base_url == "https://api-staging.example/v1/"
    assert settings.config_expected_sha256 == _CONFIG_SHA256
    assert _API_KEY not in repr(settings)
    assert _API_KEY not in settings.model_dump_json()
    assert "api_key" not in settings.model_dump()

    with pytest.raises(ValueError, match="end with /v1/"):
        _ = StagingPublicProtocolSettings(
            service_api_base_url="https://api-staging.example/api",
            api_key=SecretStr(_API_KEY),
            config_expected_sha256=_CONFIG_SHA256,
        )


def test_edge_probe_uses_read_only_v1_relative_url_without_credentials() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            405,
            headers={"x-version": " 1.16.1 ", "server": "cloudflare"},
        )

    evidence = probe_staging_public_edge(
        "https://api-staging.example/v1",
        transport=httpx.MockTransport(handler),
    )

    assert len(seen) == 1
    assert seen[0].method == "OPTIONS"
    assert seen[0].url == httpx.URL("https://api-staging.example/v1/chat-messages")
    assert "authorization" not in seen[0].headers
    assert evidence.http_status_code == 405
    assert evidence.edge_version == "1.16.1"
    assert evidence.edge_server == "cloudflare"
    assert evidence.proxy_mode == "disabled"


@pytest.mark.parametrize(
    "headers",
    ({}, {"x-version": " "}, {"x-version": "x" * 121}),
)
def test_edge_probe_rejects_missing_or_unsafe_version_header(
    headers: dict[str, str],
) -> None:
    with pytest.raises(RuntimeError, match="x-version"):
        _ = probe_staging_public_edge(
            "https://api-staging.example/v1/",
            transport=httpx.MockTransport(lambda _request: httpx.Response(200, headers=headers)),
        )


def test_request_uses_public_contract_and_omits_new_conversation_id() -> None:
    payload = build_staging_public_chat_request(
        benchmark_run_id="invocation.basic.1",
        scenario_id="basic",
        scenario_version=1,
        end_user="benchmark-public-user-0",
        conversation_id=None,
    )

    assert payload == {
        "inputs": {},
        "query": (
            "DIFY_BENCHMARK_REQUEST:"
            '{"benchmark_run_id":"invocation.basic.1","scenario_id":"basic","scenario_version":1}'
        ),
        "response_mode": "streaming",
        "user": "benchmark-public-user-0",
        "auto_generate_name": False,
    }
    reused = build_staging_public_chat_request(
        benchmark_run_id="invocation.shell.1",
        scenario_id="shell",
        scenario_version=1,
        end_user="benchmark-public-user-0",
        conversation_id=_CONVERSATION_ID,
    )
    assert reused["conversation_id"] == _CONVERSATION_ID


def test_basic_stream_uses_v1_relative_url_and_records_public_timings(
    settings: StagingPublicProtocolSettings,
) -> None:
    seen: list[httpx.Request] = []
    metrics: list[RequestMetric] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.headers["Authorization"] == f"Bearer {_API_KEY}"
        assert request.headers["Accept"] == "text/event-stream"
        return _sse_response(_basic_events("invocation.basic.1"))

    with _client(settings=settings, handler=handler, metrics=metrics) as client:
        observation = client.run_once(
            benchmark_run_id="invocation.basic.1",
            scenario_id="basic",
            scenario_version=1,
        )

    assert seen[0].url == httpx.URL("https://api-staging.example/v1/chat-messages")
    assert "conversation_id" not in json.loads(seen[0].content)
    sample = observation.sample
    assert sample.succeeded is True
    assert sample.admitted is True
    assert sample.http_status_code == 200
    assert sample.conversation_reused is False
    assert sample.response_headers_ms is not None
    assert sample.time_to_first_sse_ms is not None
    assert sample.time_to_first_answer_ms is not None
    assert sample.terminal_e2e_ms is not None
    assert sample.event_count == 2
    assert sample.answer_bytes > 0
    assert sample.edge_version == "1.16.1"
    assert sample.edge_server == "cloudflare"
    assert [metric.name for metric in metrics] == [
        "POST /v1/chat-messages headers",
        "POST /v1/chat-messages first_sse",
        "POST /v1/chat-messages first_answer",
        "basic",
    ]
    assert _CONVERSATION_ID not in observation.model_dump_json()
    assert _TASK_ID not in repr(observation)


def test_one_client_reuses_conversation_and_cleanup_deletes_it(
    settings: StagingPublicProtocolSettings,
) -> None:
    seen_payloads: list[dict[str, object]] = []
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        if request.method == "DELETE":
            assert request.url.path == f"/v1/conversations/{_CONVERSATION_ID}"
            assert json.loads(request.content) == {"user": "benchmark-public-user-0"}
            return httpx.Response(204)
        payload = cast(dict[str, object], json.loads(request.content))
        seen_payloads.append(payload)
        if len(seen_payloads) == 1:
            assert "conversation_id" not in payload
            return _sse_response(_basic_events("invocation.basic.1"))
        assert payload["conversation_id"] == _CONVERSATION_ID
        return _sse_response(_shell_events("invocation.shell.1"))

    with _client(settings=settings, handler=handler) as client:
        basic = client.run_once(
            benchmark_run_id="invocation.basic.1",
            scenario_id="basic",
            scenario_version=1,
        )
        shell = client.run_once(
            benchmark_run_id="invocation.shell.1",
            scenario_id="shell",
            scenario_version=1,
        )
        cleanup = client.cleanup_conversation()
        empty_cleanup = client.cleanup_conversation()

    assert basic.sample.succeeded is True
    assert shell.sample.succeeded is True
    assert shell.sample.conversation_reused is True
    assert shell.sample.shell_evidence_valid is True
    assert cleanup.attempted is True
    assert cleanup.http_status_code == 204
    assert cleanup.conversation_deleted is True
    assert cleanup.complete is True
    assert empty_cleanup.attempted is False
    assert empty_cleanup.complete is True
    assert seen_paths == [
        "/v1/chat-messages",
        "/v1/chat-messages",
        f"/v1/conversations/{_CONVERSATION_ID}",
    ]


def test_conversation_lifecycle_callback_records_allocation_then_deletion(
    settings: StagingPublicProtocolSettings,
) -> None:
    lifecycle: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            return httpx.Response(204)
        return _sse_response(_basic_events("invocation.basic.lifecycle"))

    client = StagingPublicServiceClient(
        settings=settings,
        end_user="benchmark-public-user-0",
        recorder=lambda _metric: None,
        transport=httpx.MockTransport(handler),
        conversation_lifecycle=lambda event, conversation_id: lifecycle.append((event, conversation_id)),
    )
    try:
        observation = client.run_once(
            benchmark_run_id="invocation.basic.lifecycle",
            scenario_id="basic",
            scenario_version=1,
        )
        cleanup = client.cleanup_conversation()
    finally:
        client.close()

    assert observation.sample.succeeded is True
    assert cleanup.complete is True
    assert lifecycle == [
        ("allocated", _CONVERSATION_ID),
        ("deleted", _CONVERSATION_ID),
    ]


def test_conversation_allocation_evidence_failure_is_not_capacity_saturation(
    settings: StagingPublicProtocolSettings,
) -> None:
    client = StagingPublicServiceClient(
        settings=settings,
        end_user="benchmark-public-user-0",
        recorder=lambda _metric: None,
        transport=httpx.MockTransport(
            lambda _request: _sse_response(_basic_events("invocation.basic.lifecycle-failure"))
        ),
        conversation_lifecycle=lambda _event, _conversation_id: (_ for _ in ()).throw(
            RuntimeError("private journal failed")
        ),
    )
    try:
        observation = client.run_once(
            benchmark_run_id="invocation.basic.lifecycle-failure",
            scenario_id="basic",
            scenario_version=1,
        )
    finally:
        client.close()

    assert observation.sample.succeeded is False
    assert observation.sample.error_type == "validation_error"
    assert "private journal failed" not in (observation.sample.error or "")


def test_admitted_cold_request_without_conversation_fails_cleanup_closed(
    settings: StagingPublicProtocolSettings,
) -> None:
    response = httpx.Response(
        200,
        text="event: ping\n\n",
        headers={"Content-Type": "text/event-stream"},
    )

    with _client(settings=settings, handler=lambda _request: response) as client:
        observation = client.run_once(
            benchmark_run_id="invocation.basic.missing-conversation",
            scenario_id="basic",
            scenario_version=1,
        )
        cleanup = client.cleanup_conversation()

    assert observation.sample.admitted is True
    assert observation.sample.succeeded is False
    assert cleanup.attempted is False
    assert cleanup.complete is False
    assert cleanup.error == "an admitted cold request did not expose a Conversation identity for cleanup"


def test_shell_accepts_only_agent_thought_observation_as_execution_evidence(
    settings: StagingPublicProtocolSettings,
) -> None:
    run_id = "invocation.shell.echo"
    tool_call = _marker(run_id, "shell", round_number=1, kind="tool_call")
    terminal = _marker(run_id, "shell", round_number=2, kind="terminal")
    echoed_evidence = f"DIFY_BENCHMARK_SHELL_OK|{tool_call}"
    events = [
        _event(
            "agent_thought",
            thought=tool_call,
            observation="",
            tool="shell_run",
            tool_input=json.dumps({"script": f"printf {echoed_evidence!r}"}),
        ),
        _event("message", answer=terminal),
        _event("message_end", id="message-1", metadata={}, files=[]),
    ]

    with _client(settings=settings, handler=lambda _request: _sse_response(events)) as client:
        observation = client.run_once(
            benchmark_run_id=run_id,
            scenario_id="shell",
            scenario_version=1,
        )

    assert observation.sample.succeeded is False
    assert observation.sample.shell_evidence_valid is False
    assert observation.sample.error_type == "validation_error"
    assert "Shell execution evidence count was 0" in cast(str, observation.sample.error)


def test_shell_ignores_escaped_marker_echo_when_observation_is_present(
    settings: StagingPublicProtocolSettings,
) -> None:
    run_id = "invocation.shell.valid"
    tool_call = _marker(run_id, "shell", round_number=1, kind="tool_call")
    events = _shell_events(run_id)
    events[0]["tool_input"] = _escaped_tool_input(tool_call)

    with _client(settings=settings, handler=lambda _request: _sse_response(events)) as client:
        observation = client.run_once(
            benchmark_run_id=run_id,
            scenario_id="shell",
            scenario_version=1,
        )

    assert observation.sample.succeeded is True
    assert observation.sample.shell_evidence_valid is True


@pytest.mark.parametrize(
    ("tool_name", "tool_observation", "error_fragment"),
    [
        (
            "different_tool",
            _shell_observation("placeholder"),
            "Shell execution evidence count was 0",
        ),
        (
            "shell_run",
            _shell_observation("placeholder", done=False, exit_code=None),
            "did not finish successfully with exit code 0",
        ),
        (
            "shell_run",
            _shell_observation("placeholder", exit_code=1),
            "did not finish successfully with exit code 0",
        ),
    ],
)
def test_shell_requires_successful_shell_run_observation(
    settings: StagingPublicProtocolSettings,
    tool_name: str,
    tool_observation: str,
    error_fragment: str,
) -> None:
    run_id = "invocation.shell.failure"
    tool_call = _marker(run_id, "shell", round_number=1, kind="tool_call")
    terminal = _marker(run_id, "shell", round_number=2, kind="terminal")
    evidence = f"DIFY_BENCHMARK_SHELL_OK|{tool_call}"
    events = [
        _event(
            "agent_thought",
            thought=tool_call,
            observation=tool_observation.replace("placeholder", evidence),
            tool=tool_name,
        ),
        _event("message", answer=terminal),
        _event("message_end", id="message-1", metadata={}, files=[]),
    ]

    with _client(settings=settings, handler=lambda _request: _sse_response(events)) as client:
        observation = client.run_once(
            benchmark_run_id=run_id,
            scenario_id="shell",
            scenario_version=1,
        )

    assert observation.sample.succeeded is False
    assert error_fragment in cast(str, observation.sample.error)


def test_config_evidence_requires_counts_bytes_and_sha(
    settings: StagingPublicProtocolSettings,
) -> None:
    responses = iter(
        [
            _sse_response(_config_events("invocation.config.valid")),
            _sse_response(_config_events("invocation.config.wrong", digest="b" * 64)),
        ]
    )

    with _client(settings=settings, handler=lambda _request: next(responses)) as client:
        valid = client.run_once(
            benchmark_run_id="invocation.config.valid",
            scenario_id="config",
            scenario_version=1,
        )
        wrong = client.run_once(
            benchmark_run_id="invocation.config.wrong",
            scenario_id="config",
            scenario_version=1,
        )

    assert valid.sample.succeeded is True
    assert valid.sample.config_materialized_item_count == 13
    assert valid.sample.config_materialized_bytes == 53_248
    assert valid.sample.config_materialized_sha256 == _CONFIG_SHA256
    assert valid.sample.config_sha_valid is True
    assert wrong.sample.succeeded is False
    assert wrong.sample.error_type == "validation_error"
    assert wrong.sample.config_sha_valid is False


@pytest.mark.parametrize(
    ("events", "error_fragment"),
    [
        ([_event("message", answer="missing marker")], "message_end count was 0"),
        (
            [*_basic_events("invocation.basic.1"), _event("message_end", id="second")],
            "message_end count was 2",
        ),
        (
            [
                _event("message", answer=_marker("invocation.basic.1", "basic", round_number=1, kind="terminal")),
                _event("error", message="provider failed"),
                _event("message_end", id="message-1"),
            ],
            "public SSE error",
        ),
    ],
)
def test_stream_requires_exactly_one_terminal_and_no_error(
    settings: StagingPublicProtocolSettings,
    events: list[dict[str, object]],
    error_fragment: str,
) -> None:
    with _client(settings=settings, handler=lambda _request: _sse_response(events)) as client:
        observation = client.run_once(
            benchmark_run_id="invocation.basic.1",
            scenario_id="basic",
            scenario_version=1,
        )

    assert observation.sample.succeeded is False
    assert error_fragment in cast(str, observation.sample.error)


def test_stream_rejects_conversation_identity_changes(
    settings: StagingPublicProtocolSettings,
) -> None:
    events = _basic_events("invocation.basic.1")
    events[1]["conversation_id"] = "019ff510-0000-7000-8000-000000000002"

    with _client(settings=settings, handler=lambda _request: _sse_response(events)) as client:
        observation = client.run_once(
            benchmark_run_id="invocation.basic.1",
            scenario_id="basic",
            scenario_version=1,
        )

    assert observation.sample.error_type == "validation_error"
    assert "conversation identity changed" in cast(str, observation.sample.error)


def test_non_sse_http_error_is_redacted(
    settings: StagingPublicProtocolSettings,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            text=json.dumps({"message": f"invalid token {_API_KEY}", "task_id": "private-task-id"}),
        )

    with _client(settings=settings, handler=handler) as client:
        observation = client.run_once(
            benchmark_run_id="invocation.basic.1",
            scenario_id="basic",
            scenario_version=1,
        )

    assert observation.sample.http_status_code == 401
    assert observation.sample.admitted is False
    assert observation.sample.error_type == "validation_error"
    assert observation.sample.error == "HTTP 401"
    assert _API_KEY not in observation.sample.model_dump_json()
    assert "private-task-id" not in observation.sample.model_dump_json()


@pytest.mark.parametrize(
    ("response", "expected_error_type"),
    [
        (httpx.Response(429, text="too many requests"), "throttle"),
        (httpx.Response(504, text="gateway timeout"), "timeout"),
        (httpx.Response(500, text="upstream failed"), "http_error"),
    ],
)
def test_http_operational_failures_have_capacity_error_types(
    settings: StagingPublicProtocolSettings,
    response: httpx.Response,
    expected_error_type: str,
) -> None:
    with _client(settings=settings, handler=lambda _request: response) as client:
        observation = client.run_once(
            benchmark_run_id="invocation.basic.http-operational",
            scenario_id="basic",
            scenario_version=1,
        )

    assert observation.sample.succeeded is False
    assert observation.sample.error_type == expected_error_type
    assert observation.sample.terminal_status == "not_terminal"
    assert observation.sample.terminal_e2e_ms is None


@pytest.mark.parametrize(
    ("message", "expected_error_type"),
    [
        ("provider concurrency quota exceeded", "throttle"),
        ("sandbox concurrency limit exceeded", "e2b_inventory_limited"),
        ("upstream timed out", "timeout"),
        ("provider failed", "sse_error"),
    ],
)
def test_sse_operational_failures_are_distinct_from_contract_failures(
    settings: StagingPublicProtocolSettings,
    message: str,
    expected_error_type: str,
) -> None:
    events = [
        _event("error", message=message),
    ]
    # The target Agent Chat converter's ErrorStreamResponse deliberately omits
    # task_id even though normal streamed events include it.
    del events[0]["task_id"]
    with _client(settings=settings, handler=lambda _request: _sse_response(events)) as client:
        observation = client.run_once(
            benchmark_run_id="invocation.basic.sse-operational",
            scenario_id="basic",
            scenario_version=1,
        )

    assert observation.sample.succeeded is False
    assert observation.sample.error_type == expected_error_type
    assert observation.sample.terminal_status == "failed"
    assert observation.sample.terminal_e2e_ms is not None


def test_cleanup_failure_is_redacted_and_remains_incomplete(
    settings: StagingPublicProtocolSettings,
) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if request.method == "DELETE":
            return httpx.Response(500, text=f"cleanup leaked {_API_KEY}")
        return _sse_response(_basic_events("invocation.basic.1"))

    with _client(settings=settings, handler=handler) as client:
        _ = client.run_once(
            benchmark_run_id="invocation.basic.1",
            scenario_id="basic",
            scenario_version=1,
        )
        cleanup = client.cleanup_conversation()
        assert client.has_conversation is True

    assert calls == 2
    assert cleanup.attempted is True
    assert cleanup.complete is False
    assert cleanup.conversation_deleted is False
    assert cleanup.error == "StagingPublicValidationError: HTTP 500"
    assert _API_KEY not in cleanup.model_dump_json()


def test_marker_validation_rejects_wrong_public_identity() -> None:
    marker = _marker("other-run", "basic", round_number=1, kind="terminal")
    with pytest.raises(Exception, match="identity"):
        _ = validate_public_benchmark_markers(
            events=[{"answer": marker}],
            benchmark_run_id="expected-run",
            scenario_id="basic",
            scenario_version=1,
        )
