import threading

import pytest
from dify_trace_langsmith.config import LangSmithConfig
from dify_trace_langsmith.provider import LangSmithProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    VerificationError,
)
from dify_trace_sdk.ids import span_uuid
from dify_trace_sdk.model import Cost
from dify_trace_sdk.provider import SendResult
from dify_trace_sdk.testing import (
    MESSAGE_ID,
    WORKFLOW_RUN_ID,
    RecordingEgress,
    message_trace,
    response,
    tool_fragment,
    workflow_trace,
)

API_KEY = "lsv2_pt_test-key"
TENANT_ID = "4f1f0b4e-6a51-4c5a-9a8e-2d7f0c3b9e11"
PROJECT_ID = "0d9b8f61-2c3e-4b7a-8f5d-6e1a9c4b7d22"
OTHER_PROJECT_ID = "a7c3e9d1-5b2f-4e8a-9c6d-3f1b8e2a4c33"
CONFIG = LangSmithConfig(api_key=API_KEY, project="dify-app")
PROJECT_URL = f"https://smith.langchain.com/o/{TENANT_ID}/projects/p/{PROJECT_ID}"
VERIFIED = CONFIG.model_copy(update={"project_url": PROJECT_URL})


def _provider(*responses: EgressResponse | Exception) -> tuple[LangSmithProvider, RecordingEgress]:
    egress = RecordingEgress(responses, grpc_target=None)
    return LangSmithProvider(egress), egress


def _accepted(count: int) -> list[EgressResponse]:
    return [response(202, {}) for _ in range(count)]


def _session(session_id: str, name: str) -> dict[str, str]:
    return {"id": session_id, "tenant_id": TENANT_ID, "name": name}


def _runs(egress: RecordingEgress) -> list[dict]:
    """The runs the SDK posted, decoded from the recorded request bodies."""
    runs = []
    for sent in egress.requests:
        assert (sent.method, sent.url) == ("POST", "https://api.smith.langchain.com/runs")
        assert sent.headers["x-api-key"] == API_KEY
        assert sent.headers["Content-Type"] == "application/json"
        body = sent.json()
        assert isinstance(body, dict)
        runs.append(body)
    return runs


def test_verify_resolves_the_project_page_with_read_only_requests() -> None:
    provider, egress = _provider(
        response(200, [_session(OTHER_PROJECT_ID, "another-app")]),
        response(200, [_session(PROJECT_ID, "dify-app")]),
    )

    verified = provider.verify(CONFIG)

    assert verified.project_url == PROJECT_URL
    tenant_lookup, project_lookup = egress.requests
    assert tenant_lookup.url == "https://api.smith.langchain.com/sessions?limit=1"
    assert project_lookup.url == "https://api.smith.langchain.com/sessions?limit=1&name=dify-app&include_stats=false"
    for sent in egress.requests:
        assert sent.method == "GET"
        assert sent.content is None
        assert sent.headers["x-api-key"] == API_KEY
        assert not sent.sensitive_url


def test_verify_links_the_project_list_until_the_first_run_creates_the_project() -> None:
    provider, _ = _provider(response(200, [_session(OTHER_PROJECT_ID, "another-app")]), response(200, []))
    assert provider.verify(CONFIG).project_url == f"https://smith.langchain.com/o/{TENANT_ID}/projects"


def test_verify_of_a_workspace_without_projects_links_the_web_app() -> None:
    provider, _ = _provider(response(200, []), response(200, []))
    assert provider.verify(CONFIG).project_url == "https://smith.langchain.com"


@pytest.mark.parametrize(
    ("endpoint", "web_url"),
    [
        ("https://langsmith.example.com/api/v1", "https://langsmith.example.com"),
        ("https://langsmith.example.com/team/api/", "https://langsmith.example.com/team"),
        ("https://eu.api.smith.langchain.com", "https://eu.smith.langchain.com"),
        ("https://localhost:1984", "http://localhost"),
    ],
)
def test_verify_derives_the_web_app_like_the_sdk(endpoint: str, web_url: str) -> None:
    provider, egress = _provider(
        response(200, [_session(PROJECT_ID, "dify-app")]), response(200, [_session(PROJECT_ID, "dify-app")])
    )

    verified = provider.verify(LangSmithConfig(api_key=API_KEY, project="dify-app", endpoint=endpoint))

    assert verified.project_url == f"{web_url}/o/{TENANT_ID}/projects/p/{PROJECT_ID}"
    assert egress.requests[0].url == f"{endpoint.rstrip('/')}/sessions?limit=1"


@pytest.mark.parametrize(
    ("outcomes", "code"),
    [
        ([response(401, {"detail": "Invalid token"})], "authentication_failed"),
        ([response(403, {"error": "org_scoped_key_requires_workspace"})], "authentication_failed"),
        ([response(404, {"detail": "Not Found"})], "endpoint_unavailable"),
        ([response(503, {})], "endpoint_unavailable"),
        ([response(200, b"<!doctype html>")], "malformed_response"),
        ([response(200, {"detail": "not a list"})], "malformed_response"),
        ([response(200, [{"id": PROJECT_ID, "tenant_id": "tenant-1"}])], "malformed_response"),
        ([response(200, [_session(OTHER_PROJECT_ID, "another-app")]), response(500, {})], "endpoint_unavailable"),
        (
            [response(200, [_session(OTHER_PROJECT_ID, "another-app")]), response(200, [{"name": "dify-app"}])],
            "malformed_response",
        ),
        ([EgressError("connection refused", request_sent=False)], "connection_failed"),
        ([EgressBlockedError("private address")], "connection_failed"),
    ],
)
def test_verify_failures_have_stable_codes(outcomes: list[EgressResponse | Exception], code: str) -> None:
    provider, _ = _provider(*outcomes)
    with pytest.raises(VerificationError) as caught:
        provider.verify(CONFIG)
    assert caught.value.code == code


def test_project_url_returns_the_stored_link_without_io() -> None:
    provider, egress = _provider()
    assert provider.project_url(VERIFIED) == PROJECT_URL
    assert provider.project_url(CONFIG) is None
    assert egress.requests == []


def test_message_trace_is_posted_as_a_root_run_and_an_llm_run() -> None:
    provider, egress = _provider(*_accepted(2))
    trace = message_trace()
    message, llm = trace.spans
    llm_run_id = str(span_uuid(trace.trace_id, llm.span_id))
    root_order = f"20261001T080000000000Z{MESSAGE_ID}"

    result = provider.send(VERIFIED, trace)

    assert _runs(egress) == [
        {
            "id": MESSAGE_ID,
            "trace_id": MESSAGE_ID,
            "parent_run_id": None,
            "dotted_order": root_order,
            "session_name": "dify-app",
            "name": "message",
            "run_type": "chain",
            "start_time": "2026-10-01T08:00:00+00:00",
            "end_time": "2026-10-01T08:00:02+00:00",
            "inputs": {"query": "What is Dify?"},
            "outputs": {"output": "An LLM application platform."},
            "error": None,
            "extra": {
                "metadata": {
                    "message_id": MESSAGE_ID,
                    "app_id": "app-1",
                    "tenant_id": "tenant-1",
                    "dify_trace_id": trace.trace_id,
                    "session_id": "conversation-1",
                }
            },
        },
        {
            "id": llm_run_id,
            "trace_id": MESSAGE_ID,
            "parent_run_id": MESSAGE_ID,
            "dotted_order": f"{root_order}.20261001T080000000000Z{llm_run_id}",
            "session_name": "dify-app",
            "name": "llm",
            "run_type": "llm",
            "start_time": "2026-10-01T08:00:00+00:00",
            "end_time": "2026-10-01T08:00:02+00:00",
            "inputs": {"input": [{"role": "user", "content": "What is Dify?"}]},
            "outputs": {
                "output": "An LLM application platform.",
                "usage_metadata": {"input_tokens": 12, "output_tokens": 8, "total_tokens": 20, "total_cost": 0.0004},
            },
            "error": None,
            "extra": {
                "metadata": {
                    "message_id": MESSAGE_ID,
                    "dify_trace_id": trace.trace_id,
                    "session_id": "conversation-1",
                    "ls_model_name": "gpt-4o",
                    "ls_provider": "openai",
                }
            },
        },
    ]
    assert result == SendResult(
        trace_id=MESSAGE_ID,
        trace_url=f"{PROJECT_URL}/r/{MESSAGE_ID}",
        span_urls={message.span_id: f"{PROJECT_URL}/r/{MESSAGE_ID}", llm.span_id: f"{PROJECT_URL}/r/{llm_run_id}"},
    )


def test_workflow_runs_keep_the_hierarchy_and_failures() -> None:
    provider, egress = _provider(*_accepted(3))
    trace = workflow_trace()
    _, llm, tool = trace.spans
    llm_run_id = str(span_uuid(trace.trace_id, llm.span_id))
    tool_run_id = str(span_uuid(trace.trace_id, tool.span_id))

    provider.send(VERIFIED, trace)

    runs = _runs(egress)
    workflow_run, llm_run, tool_run = runs
    assert [run["id"] for run in runs] == [WORKFLOW_RUN_ID, llm_run_id, tool_run_id]
    assert [run["parent_run_id"] for run in runs] == [None, WORKFLOW_RUN_ID, llm_run_id]
    assert {run["trace_id"] for run in runs} == {WORKFLOW_RUN_ID}
    assert tool_run["dotted_order"] == (
        f"20261001T080000000000Z{WORKFLOW_RUN_ID}"
        f".20261001T080001000000Z{llm_run_id}"
        f".20261001T080003000000Z{tool_run_id}"
    )
    assert [run["run_type"] for run in runs] == ["chain", "llm", "tool"]
    assert [run["error"] for run in runs] == ["Tool failed", None, "Tool failed"]
    assert llm_run["outputs"] == {
        "text": "Tracing records execution.",
        "usage_metadata": {"input_tokens": 30, "output_tokens": 10, "total_tokens": 40},
    }
    assert tool_run["outputs"] == {}
    assert workflow_run["extra"]["metadata"]["session_id"] == WORKFLOW_RUN_ID


def test_llm_cost_is_sent_only_in_usd() -> None:
    provider, egress = _provider(*_accepted(2))
    trace = message_trace()
    message, llm = trace.spans
    priced_in_rmb = llm.model_copy(update={"cost": Cost(amount=0.003, currency="RMB")})

    provider.send(VERIFIED, trace.model_copy(update={"spans": (message, priced_in_rmb)}))

    assert _runs(egress)[1]["outputs"]["usage_metadata"] == {"input_tokens": 12, "output_tokens": 8, "total_tokens": 20}


def test_external_trace_id_is_kept_in_metadata() -> None:
    provider, egress = _provider(*_accepted(2))
    provider.send(VERIFIED, message_trace().model_copy(update={"external_trace_id": "caller-trace-1"}))
    assert [run["extra"]["metadata"]["external_trace_id"] for run in _runs(egress)] == ["caller-trace-1"] * 2


def test_fragment_attaches_under_the_message_run() -> None:
    message_provider, message_egress = _provider(*_accepted(2))
    message_provider.send(VERIFIED, message_trace())
    message_order = _runs(message_egress)[0]["dotted_order"]
    provider, egress = _provider(*_accepted(1))
    fragment = tool_fragment()
    tool_run_id = str(span_uuid(fragment.trace_id, fragment.root.span_id))

    result = provider.send(VERIFIED, fragment)

    (tool_run,) = _runs(egress)
    assert tool_run["id"] == tool_run_id
    assert tool_run["parent_run_id"] == MESSAGE_ID
    assert tool_run["trace_id"] == MESSAGE_ID
    assert tool_run["dotted_order"] == f"{message_order}.20261001T080000500000Z{tool_run_id}"
    assert result == SendResult(
        trace_id=MESSAGE_ID,
        trace_url=f"{PROJECT_URL}/r/{MESSAGE_ID}",
        span_urls={fragment.root.span_id: f"{PROJECT_URL}/r/{tool_run_id}"},
    )


def test_runs_are_posted_under_the_endpoint_path() -> None:
    provider, egress = _provider(*_accepted(2))
    config = LangSmithConfig(api_key=API_KEY, project="dify-app", endpoint="https://langsmith.internal/api/v1/")
    provider.send(config, message_trace())
    assert [sent.url for sent in egress.requests] == ["https://langsmith.internal/api/v1/runs"] * 2


def test_redelivery_posts_identical_runs() -> None:
    first, first_egress = _provider(*_accepted(3))
    second, second_egress = _provider(*_accepted(3))
    first.send(VERIFIED, workflow_trace())
    second.send(VERIFIED, workflow_trace())
    assert [sent.content for sent in first_egress.requests] == [sent.content for sent in second_egress.requests]


def test_runs_langsmith_already_has_count_as_accepted() -> None:
    provider, egress = _provider(response(409, {"detail": "Run already exists"}), *_accepted(1))
    assert provider.send(VERIFIED, message_trace()).trace_id == MESSAGE_ID
    assert len(egress.requests) == 2


@pytest.mark.parametrize(
    "project_url",
    [None, f"https://smith.langchain.com/o/{TENANT_ID}/projects", "https://smith.langchain.com"],
)
def test_runs_are_linked_only_once_the_project_page_is_known(project_url: str | None) -> None:
    provider, _ = _provider(*_accepted(2))
    result = provider.send(CONFIG.model_copy(update={"project_url": project_url}), message_trace())
    assert result == SendResult(trace_id=MESSAGE_ID, trace_url=None, span_urls={})


def test_send_leaves_no_background_threads() -> None:
    before = set(threading.enumerate())
    provider, _ = _provider(*_accepted(2))
    provider.send(VERIFIED, message_trace())
    assert set(threading.enumerate()) == before


@pytest.mark.parametrize(
    ("outcome", "expected"),
    [
        (response(429, {}), ExportRetryableError),
        (response(500, {}), ExportRetryableError),
        (response(503, {}), ExportRetryableError),
        (response(400, {"detail": "invalid dotted_order"}), ExportRejectedError),
        (response(401, {"detail": "Invalid token"}), ExportRejectedError),
        (EgressError("connection refused", request_sent=False), ExportRetryableError),
        (EgressError("read timeout", request_sent=True), ExportOutcomeUnknownError),
        (EgressBlockedError("private address"), ExportRejectedError),
    ],
)
def test_send_failures_are_classified(outcome: EgressResponse | Exception, expected: type[Exception]) -> None:
    provider, egress = _provider(outcome)
    with pytest.raises(expected) as caught:
        provider.send(VERIFIED, message_trace())
    assert len(egress.requests) == 1
    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__


@pytest.mark.parametrize(
    "failure",
    [response(500, {}), EgressError("connection refused", request_sent=False), EgressError("reset", request_sent=True)],
)
def test_partial_acceptance_is_resent_because_runs_are_idempotent(failure: EgressResponse | Exception) -> None:
    provider, _ = _provider(response(202, {}), failure)
    with pytest.raises(ExportRetryableError):
        provider.send(VERIFIED, message_trace())


def test_partial_acceptance_of_a_rejected_trace_is_not_resent() -> None:
    provider, _ = _provider(response(202, {}), response(422, {}))
    with pytest.raises(ExportRejectedError):
        provider.send(VERIFIED, message_trace())


def test_runs_that_share_a_caller_trace_id_keep_their_own_root_runs() -> None:
    first, second = (
        message_trace().model_copy(update={"external_trace_id": "caller-trace"}),
        workflow_trace().model_copy(update={"external_trace_id": "caller-trace"}),
    )
    provider, egress = _provider(*_accepted(len(first.spans) + len(second.spans)))

    provider.send(VERIFIED, first)
    provider.send(VERIFIED, second)

    roots = [run for run in _runs(egress) if run["parent_run_id"] is None]
    assert len(roots) == 2
    assert len({run["id"] for run in roots}) == 2
    assert all(run["trace_id"] == run["id"] for run in roots)


def test_failures_never_echo_credentials_urls_or_bodies() -> None:
    provider, _ = _provider(response(422, {"detail": "rejected-body-detail"}))
    with pytest.raises(ExportRejectedError) as caught:
        provider.send(VERIFIED, message_trace())
    assert str(caught.value) == "LangSmith ingestion rejected (HTTP 422)"
