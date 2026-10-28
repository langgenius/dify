import subprocess
import sys
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from dify_trace_opik.config import OpikConfig
from dify_trace_opik.provider import OpikProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.ids import span_id_for
from dify_trace_sdk.model import Cost, Span, SpanKind, SpanStatus, TokenUsage, Trace
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

API_URL = "https://www.comet.com/opik/api/"
API_KEY = "opik-key-1"
CONFIG = OpikConfig(api_key=API_KEY, project="Dify", workspace="team-1", url=API_URL)
DEFAULT_WORKSPACE_CONFIG = OpikConfig(api_key=API_KEY)
HEADERS = {
    "Comet-Workspace": "team-1",
    "Accept": "application/json",
    "Authorization": API_KEY,
    "Content-Type": "application/json",
}
CREATED = response(201, b"")
NO_CONTENT = response(204, b"")
FAILURE = {"exception_type": "DifyExecutionError", "message": "Tool failed", "traceback": ""}

# The legacy agent_trace exporter assigned these IDs to the sample traces; keeping
# them lets units sent before and after the migration join the same Opik trace.
MESSAGE_TRACE_ID = "01a0f67a-3800-73b3-8caf-ef474b73d890"
MESSAGE_SPAN_ID = "01a0f67a-3800-7312-8296-b10f658726ef"
MESSAGE_LLM_SPAN_ID = "01a0f67a-3800-712a-9d04-7e6b84a30a0c"
WORKFLOW_TRACE_ID = "01a0f67a-3800-7875-8be5-d677d1b69abc"
WORKFLOW_SPAN_ID = "01a0f67a-3800-7c27-98a2-cb7f6dafe47e"
WORKFLOW_LLM_SPAN_ID = "01a0f67a-3be8-7fb9-b3b4-887648ce8273"
WORKFLOW_TOOL_SPAN_ID = "01a0f67a-43b8-7ed6-a7e7-e44532c25e28"
TOOL_SPAN_ID = "01a0f67a-39f4-777f-b4fd-452b9ab6b95f"


def _provider(*responses: EgressResponse | Exception) -> tuple[OpikProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return OpikProvider(egress), egress


def _json(request: RecordedRequest) -> dict[str, Any]:
    body = request.json()
    assert isinstance(body, dict)
    return body


def test_importing_the_provider_leaves_the_opik_sdk_unloaded() -> None:
    # Importing any opik module replaces the process's Sentry client with Comet's.
    script = "import sys, dify_trace_opik.provider; print(sorted(n for n in sys.modules if n.split('.')[0] == 'opik'))"
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=True)
    assert result.stdout.strip() == "[]"


def test_verify_checks_access_to_a_named_workspace() -> None:
    provider, egress = _provider(NO_CONTENT)
    config = CONFIG.model_copy(update={"url": "https://opik.example.com/prefix/api/"})

    assert provider.verify(config) == config

    (sent,) = egress.requests
    assert (sent.method, sent.url) == ("POST", "https://opik.example.com/prefix/api/v1/private/auth")
    assert sent.headers == HEADERS
    assert sent.content == b"{}"
    assert sent.sensitive_url is False


@pytest.mark.parametrize("workspace", [None, "", "default", " default "])
def test_verify_resolves_the_default_workspace(workspace: str | None) -> None:
    provider, egress = _provider(NO_CONTENT, response(200, {"workspace_name": "resolved-team"}))

    verified = provider.verify(OpikConfig(api_key=API_KEY, workspace=workspace))

    assert verified == OpikConfig(api_key=API_KEY, project="Default Project", workspace="resolved-team", url=API_URL)
    access, lookup = egress.requests
    assert (access.method, access.headers["Comet-Workspace"]) == ("POST", "default")
    assert (lookup.method, lookup.url, lookup.content) == ("GET", f"{API_URL}v1/private/auth/workspace", None)
    assert lookup.headers == {"Comet-Workspace": "default", "Accept": "application/json", "Authorization": API_KEY}


def test_verify_without_an_api_key_sends_no_authorization() -> None:
    provider, egress = _provider(NO_CONTENT)

    provider.verify(OpikConfig(workspace="local", url="http://selfhost.test:5173/api/"))

    (sent,) = egress.requests
    assert sent.headers == {
        "Comet-Workspace": "local",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


@pytest.mark.parametrize(
    ("config", "outcomes", "code"),
    [
        (CONFIG, [response(401, {"message": "private-vendor-error"})], "authentication_failed"),
        (CONFIG, [response(403, {})], "permission_denied"),
        (CONFIG, [response(302, b"")], "endpoint_unavailable"),
        (CONFIG, [response(500, {})], "endpoint_unavailable"),
        (CONFIG, [response(200, b"<html>Login</html>")], "malformed_response"),
        (CONFIG, [EgressError("refused", request_sent=False)], "connection_failed"),
        (CONFIG, [EgressBlockedError("private address")], "connection_failed"),
        (DEFAULT_WORKSPACE_CONFIG, [NO_CONTENT, response(401, {})], "authentication_failed"),
        (DEFAULT_WORKSPACE_CONFIG, [NO_CONTENT, response(200, b"not json")], "malformed_response"),
        (DEFAULT_WORKSPACE_CONFIG, [NO_CONTENT, response(200, ["team"])], "malformed_response"),
        (DEFAULT_WORKSPACE_CONFIG, [NO_CONTENT, response(200, {"workspace_name": " "})], "malformed_response"),
        (DEFAULT_WORKSPACE_CONFIG, [NO_CONTENT, response(200, {"workspace_name": 123})], "malformed_response"),
        (DEFAULT_WORKSPACE_CONFIG, [NO_CONTENT, response(200, {"workspace_name": ".."})], "invalid_workspace"),
    ],
)
def test_verify_failures_have_stable_codes(
    config: OpikConfig, outcomes: list[EgressResponse | Exception], code: str
) -> None:
    provider, egress = _provider(*outcomes)
    with pytest.raises(VerificationError) as caught:
        provider.verify(config)
    assert caught.value.code == code
    assert API_KEY not in str(caught.value)
    assert len(egress.requests) == len(outcomes)


@pytest.mark.parametrize(
    ("settings", "code"),
    [
        ({"url": "https://private.test/api/?next=/api/"}, "invalid_endpoint"),
        ({"url": "https://private.test/api/#/api/"}, "invalid_endpoint"),
        ({"url": "https://private.test:invalid/api/"}, "invalid_endpoint"),
        ({"url": "https://private.test/with space/api/"}, "invalid_endpoint"),
        ({"url": "https://private.test/back\\slash/api/"}, "invalid_endpoint"),
        ({"workspace": ".."}, "invalid_workspace"),
        ({"workspace": "bad\nworkspace"}, "invalid_workspace"),
        ({"project": "bad\nproject"}, "invalid_project"),
    ],
)
def test_unsafe_settings_never_reach_the_network(settings: dict[str, str], code: str) -> None:
    config = OpikConfig.model_validate({"api_key": API_KEY, **settings})
    provider, egress = _provider()

    with pytest.raises(VerificationError) as caught:
        provider.verify(config)
    assert caught.value.code == code
    with pytest.raises(ExportRejectedError, match=code):
        provider.send(config, message_trace())
    assert provider.project_url(config) is None
    assert egress.requests == []


def test_project_url_links_the_project_in_a_named_workspace() -> None:
    provider, egress = _provider()
    assert provider.project_url(CONFIG) == "https://www.comet.com/opik/team-1/redirect/projects?name=Dify"

    url = provider.project_url(
        OpikConfig(url="https://private.test:7443/prefix/api/", workspace="team/name", project="A & B/? 中文")
    )

    assert url is not None
    parsed = urlsplit(url)
    assert (parsed.netloc, parsed.path) == ("private.test:7443", "/prefix/team%2Fname/redirect/projects")
    assert parse_qs(parsed.query) == {"name": ["A & B/? 中文"]}
    assert egress.requests == []


@pytest.mark.parametrize("workspace", [None, "", "default"])
def test_project_url_falls_back_to_the_console_for_the_default_workspace(workspace: str | None) -> None:
    provider, _ = _provider()
    config = OpikConfig(url="http://selfhost.test:5173/prefix/api/", workspace=workspace)
    assert provider.project_url(config) == "http://selfhost.test:5173/prefix/"


def test_message_trace_creates_the_trace_then_its_spans() -> None:
    provider, egress = _provider(CREATED, NO_CONTENT)
    trace = message_trace()
    message, llm = trace.spans

    result = provider.send(CONFIG, trace)

    assert result == SendResult(trace_id=MESSAGE_TRACE_ID, trace_url=None, span_urls={})
    create_trace, create_spans = egress.requests
    assert (create_trace.method, create_trace.url) == ("POST", f"{API_URL}v1/private/traces")
    assert (create_spans.method, create_spans.url) == ("POST", f"{API_URL}v1/private/spans/batch")
    assert create_trace.headers == create_spans.headers == HEADERS
    assert create_trace.sensitive_url is create_spans.sensitive_url is False
    assert create_trace.json() == {
        "id": MESSAGE_TRACE_ID,
        "project_name": "Dify",
        "name": "message",
        "start_time": "2026-10-01T08:00:00Z",
        "end_time": "2026-10-01T08:00:02Z",
        "input": {"query": "What is Dify?"},
        "output": "An LLM application platform.",
        "metadata": {
            "message_id": MESSAGE_ID,
            "app_id": "app-1",
            "tenant_id": "tenant-1",
            "dify_trace_id": trace.trace_id,
            "user_id": "end-user-1",
        },
        "thread_id": "conversation-1",
    }
    assert create_spans.json() == {
        "spans": [
            {
                "id": MESSAGE_SPAN_ID,
                "project_name": "Dify",
                "trace_id": MESSAGE_TRACE_ID,
                "name": "message",
                "type": "general",
                "start_time": "2026-10-01T08:00:00Z",
                "end_time": "2026-10-01T08:00:02Z",
                "input": {"query": "What is Dify?"},
                "output": "An LLM application platform.",
                "metadata": {
                    "message_id": MESSAGE_ID,
                    "app_id": "app-1",
                    "tenant_id": "tenant-1",
                    "dify_span_kind": "chain",
                    "dify_span_id": message.span_id,
                    "dify_trace_id": trace.trace_id,
                    "session_id": "conversation-1",
                },
            },
            {
                "id": MESSAGE_LLM_SPAN_ID,
                "project_name": "Dify",
                "trace_id": MESSAGE_TRACE_ID,
                "parent_span_id": MESSAGE_SPAN_ID,
                "name": "llm",
                "type": "llm",
                "start_time": "2026-10-01T08:00:00Z",
                "end_time": "2026-10-01T08:00:02Z",
                "input": [{"role": "user", "content": "What is Dify?"}],
                "output": "An LLM application platform.",
                "metadata": {
                    "message_id": MESSAGE_ID,
                    "dify_span_kind": "llm",
                    "dify_span_id": llm.span_id,
                    "dify_trace_id": trace.trace_id,
                    "session_id": "conversation-1",
                },
                "model": "gpt-4o",
                "provider": "openai",
                "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
                "total_estimated_cost": 0.0004,
                "ttft": 250.0,
            },
        ]
    }


def test_workflow_trace_keeps_hierarchy_errors_and_usage() -> None:
    provider, egress = _provider(CREATED, NO_CONTENT)
    trace = workflow_trace()
    run, llm, tool = trace.spans

    assert provider.send(CONFIG, trace).trace_id == WORKFLOW_TRACE_ID

    create_trace, create_spans = egress.requests
    assert create_trace.json() == {
        "id": WORKFLOW_TRACE_ID,
        "project_name": "Dify",
        "name": "workflow",
        "start_time": "2026-10-01T08:00:00Z",
        "end_time": "2026-10-01T08:00:05Z",
        "input": {"topic": "tracing"},
        "output": {},
        "metadata": {
            "workflow_run_id": WORKFLOW_RUN_ID,
            "app_id": "app-1",
            "dify_trace_id": trace.trace_id,
            "user_id": "account-1",
        },
        "error_info": FAILURE,
        "thread_id": WORKFLOW_RUN_ID,
    }
    assert create_spans.json() == {
        "spans": [
            {
                "id": WORKFLOW_SPAN_ID,
                "project_name": "Dify",
                "trace_id": WORKFLOW_TRACE_ID,
                "name": "workflow",
                "type": "general",
                "start_time": "2026-10-01T08:00:00Z",
                "end_time": "2026-10-01T08:00:05Z",
                "input": {"topic": "tracing"},
                "output": {},
                "metadata": {
                    "workflow_run_id": WORKFLOW_RUN_ID,
                    "app_id": "app-1",
                    "dify_span_kind": "chain",
                    "dify_span_id": run.span_id,
                    "dify_trace_id": trace.trace_id,
                    "session_id": WORKFLOW_RUN_ID,
                },
                "error_info": FAILURE,
            },
            {
                "id": WORKFLOW_LLM_SPAN_ID,
                "project_name": "Dify",
                "trace_id": WORKFLOW_TRACE_ID,
                "parent_span_id": WORKFLOW_SPAN_ID,
                "name": "llm_Summarize",
                "type": "llm",
                "start_time": "2026-10-01T08:00:01Z",
                "end_time": "2026-10-01T08:00:03Z",
                "input": [{"role": "user", "content": "Summarize tracing"}],
                "output": {"text": "Tracing records execution."},
                "metadata": {
                    "node_execution_id": "node-execution-llm",
                    "node_type": "llm",
                    "dify_span_kind": "llm",
                    "dify_span_id": llm.span_id,
                    "dify_trace_id": trace.trace_id,
                    "session_id": WORKFLOW_RUN_ID,
                },
                "model": "gpt-4o",
                "provider": "openai",
                "usage": {"prompt_tokens": 30, "completion_tokens": 10, "total_tokens": 40},
            },
            {
                "id": WORKFLOW_TOOL_SPAN_ID,
                "project_name": "Dify",
                "trace_id": WORKFLOW_TRACE_ID,
                "parent_span_id": WORKFLOW_LLM_SPAN_ID,
                "name": "tool_Search",
                "type": "tool",
                "start_time": "2026-10-01T08:00:03Z",
                "end_time": "2026-10-01T08:00:05Z",
                "input": {"query": "tracing"},
                "output": {},
                "metadata": {
                    "node_execution_id": "node-execution-tool",
                    "node_type": "tool",
                    "dify_span_kind": "tool",
                    "dify_span_id": tool.span_id,
                    "dify_trace_id": trace.trace_id,
                    "session_id": WORKFLOW_RUN_ID,
                },
                "error_info": FAILURE,
            },
        ]
    }


def test_fragment_joins_the_message_trace_without_creating_it() -> None:
    provider, egress = _provider(NO_CONTENT)
    fragment = tool_fragment()

    assert provider.send(CONFIG, fragment).trace_id == MESSAGE_TRACE_ID

    (create_spans,) = egress.requests
    assert create_spans.url == f"{API_URL}v1/private/spans/batch"
    assert create_spans.json() == {
        "spans": [
            {
                "id": TOOL_SPAN_ID,
                "project_name": "Dify",
                "trace_id": MESSAGE_TRACE_ID,
                "name": "weather",
                "type": "tool",
                "start_time": "2026-10-01T08:00:00.500000Z",
                "end_time": "2026-10-01T08:00:01Z",
                "input": {"city": "Berlin"},
                "output": "Sunny",
                "metadata": {
                    "message_id": MESSAGE_ID,
                    "dify_span_kind": "tool",
                    "dify_span_id": fragment.root.span_id,
                    "dify_trace_id": fragment.trace_id,
                    "session_id": "conversation-1",
                },
            }
        ]
    }


def test_redelivery_sends_identical_requests() -> None:
    first, first_egress = _provider(CREATED, NO_CONTENT)
    second, second_egress = _provider(CREATED, NO_CONTENT)

    first.send(CONFIG, workflow_trace())
    second.send(CONFIG, workflow_trace())

    assert [request.content for request in first_egress.requests] == [
        request.content for request in second_egress.requests
    ]


def test_opik_specific_fields_are_sent_only_where_opik_accepts_them() -> None:
    trace = message_trace()
    message, llm = trace.spans
    message = message.model_copy(
        update={
            "inputs": [1, "two"],
            "outputs": 42,
            "model_name": "gpt-4o",
            "usage": TokenUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
            "cost": Cost(amount=1.0, currency="USD"),
            "time_to_first_token": 1.0,
        }
    )
    llm = llm.model_copy(update={"cost": Cost(amount=0.1, currency="EUR"), "time_to_first_token": None})
    provider, egress = _provider(CREATED, NO_CONTENT)

    provider.send(CONFIG, trace.model_copy(update={"spans": (message, llm)}))

    create_trace, create_spans = egress.requests
    message_span, llm_span = _json(create_spans)["spans"]
    assert (_json(create_trace)["input"], _json(create_trace)["output"]) == ('[1, "two"]', "42")
    assert (message_span["input"], message_span["output"]) == ('[1, "two"]', "42")
    assert not {"model", "provider", "usage", "total_estimated_cost", "ttft"} & message_span.keys()
    assert "total_estimated_cost" not in llm_span
    assert "ttft" not in llm_span
    assert llm_span["usage"] == {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20}


def test_large_units_send_spans_in_batches() -> None:
    run = workflow_trace().root.model_copy(update={"status": SpanStatus.OK, "error": None})
    nodes = tuple(
        Span(
            span_id=span_id_for(f"node-execution-{index}"),
            parent_span_id=run.span_id,
            name=f"node_{index}",
            kind=SpanKind.TOOL,
            start_time=run.start_time,
            end_time=run.end_time,
            status=SpanStatus.OK,
        )
        for index in range(1000)
    )
    trace = Trace(
        trace_id=workflow_trace().trace_id,
        external_trace_id=None,
        session_id=None,
        user_id=None,
        parent=None,
        trace_root=None,
        spans=(run, *nodes),
    )
    provider, egress = _provider(CREATED, NO_CONTENT, NO_CONTENT)

    provider.send(CONFIG, trace)

    _, first_batch, second_batch = egress.requests
    assert [len(_json(batch)["spans"]) for batch in (first_batch, second_batch)] == [1000, 1]


def test_values_that_are_not_json_fail_before_anything_is_sent() -> None:
    trace = message_trace()
    message, llm = trace.spans
    llm = llm.model_copy(update={"attributes": {"score": float("nan")}})
    provider, egress = _provider()

    with pytest.raises(ExportRejectedError):
        provider.send(CONFIG, trace.model_copy(update={"spans": (message, llm)}))
    assert egress.requests == []


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (response(503, {}), ExportRetryableError),
        (response(429, {}), ExportRetryableError),
        (response(401, {}), ExportRejectedError),
        (response(422, {"errors": ["private-vendor-error"]}), ExportRejectedError),
        (EgressError("refused", request_sent=False), ExportRetryableError),
        (EgressError("read timeout", request_sent=True), ExportOutcomeUnknownError),
        (EgressBlockedError("private address"), ExportRejectedError),
    ],
)
def test_trace_creation_failures_are_classified(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
    provider, egress = _provider(outcome)
    with pytest.raises(expected) as caught:
        provider.send(CONFIG, message_trace())
    assert len(egress.requests) == 1
    assert API_KEY not in str(caught.value)
    assert "private" not in str(caught.value)


@pytest.mark.parametrize(
    "outcome",
    [
        response(503, {}),
        response(400, {}),
        EgressError("refused", request_sent=False),
        EgressBlockedError("private address"),
    ],
)
def test_span_failures_after_the_trace_was_created_are_outcome_unknown(outcome: EgressResponse | Exception) -> None:
    provider, egress = _provider(CREATED, outcome)
    with pytest.raises(ExportOutcomeUnknownError):
        provider.send(CONFIG, message_trace())
    assert len(egress.requests) == 2


def test_nested_workflow_hangs_from_the_tool_node_span_of_its_outer_trace() -> None:
    provider, egress = _provider(NO_CONTENT)

    assert provider.send(CONFIG, nested_workflow_fragment()).trace_id == WORKFLOW_TRACE_ID

    (create_spans,) = egress.requests
    assert create_spans.url == f"{API_URL}v1/private/spans/batch"
    body = create_spans.json()
    assert isinstance(body, dict)
    run, node = body["spans"]
    assert (run["trace_id"], run["parent_span_id"]) == (WORKFLOW_TRACE_ID, WORKFLOW_TOOL_SPAN_ID)
    assert (node["trace_id"], node["parent_span_id"]) == (WORKFLOW_TRACE_ID, run["id"])


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [(response(503, {}), ExportRetryableError), (response(400, {}), ExportRejectedError)],
)
def test_fragment_failures_are_classified_as_nothing_was_accepted(
    outcome: EgressResponse, expected: type[Exception]
) -> None:
    provider, _ = _provider(outcome)
    with pytest.raises(expected):
        provider.send(CONFIG, tool_fragment())
