"""Real Weave SDK serialization with only the outbound HTTP boundary replaced."""

import atexit
import json
import os
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from typing import TypedDict, Unpack

import httpx
import pytest
import wandb
import weave
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.entities.weave_trace_entity import WeaveTraceModel
from dify_trace_weave.weave_trace import WeaveDataTrace
from sqlalchemy.orm import Session
from weave.trace_server.trace_server_interface import CallEndReq, CallStartReq, TraceStatus

from core.helper import ssrf_proxy
from core.ops.entities.trace_entity import GenerateNameTraceInfo, WorkflowTraceInfo
from core.ops.exceptions import RetryableTraceDispatchError
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from models.account import TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportUncertainError
from tests.unit_tests.model_factories import make_account, make_app, make_tenant

START = datetime(2026, 10, 19, tzinfo=UTC)


class RequestOptions(TypedDict, total=False):
    content: bytes
    json: dict[str, object]
    auth: tuple[str, str]
    headers: Mapping[str, str]
    max_retries: int
    follow_redirects: bool
    timeout: float


def config(**overrides: object) -> WeaveConfig:
    return WeaveConfig.model_validate({"api_key": "fixture-key", "entity": "team", "project": "project", **overrides})


def call(call_id: str = "call-1", **overrides: object) -> WeaveTraceModel:
    return WeaveTraceModel.model_validate(
        {
            "id": call_id,
            "op": "tool",
            "inputs": {"synthetic": True},
            "outputs": {"result": "ok"},
            "attributes": {"trace_id": call_id, "start_time": START, "end_time": START + timedelta(seconds=1)},
            **overrides,
        }
    )


def response(url: str, body: object, *, status: int = 200) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("POST", url), json=body)


@pytest.fixture
def wire(
    monkeypatch: pytest.MonkeyPatch, failure: tuple[str, str, int | str] | None
) -> list[tuple[str, RequestOptions, dict[str, object]]]:
    sent: list[tuple[str, RequestOptions, dict[str, object]]] = []
    fault_pending = True

    def send(method: str, url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        nonlocal fault_pending
        assert method == "POST"
        assert url in {"https://trace.wandb.ai/call/start", "https://trace.wandb.ai/call/end"}
        body = json.loads(options["content"])
        sent.append((url, options, body))
        stage = "start" if "start" in body else "end"
        record = body[stage]
        if fault_pending and failure is not None and (stage, record["id"]) == failure[:2]:
            fault_pending = False
            outcome = failure[2]
            if outcome == "timeout":
                raise httpx.ReadTimeout("synthetic lost acknowledgment", request=httpx.Request("POST", url))
            if outcome == "malformed":
                return httpx.Response(200, request=httpx.Request("POST", url), content=b"invalid-json")
            assert isinstance(outcome, int)
            return response(url, {"error": "DO_NOT_EXPOSE_BODY"}, status=outcome)
        if url.endswith("/call/start"):
            req = CallStartReq.model_validate(body)
            return response(url, {"id": req.start.id, "trace_id": req.start.trace_id})
        CallEndReq.model_validate(body)
        return response(url, {})

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    return sent


def test_constructor_and_presentation_have_no_login_network_files_or_background_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> None:
        pytest.fail("Constructor must not initialize global credentials, files, I/O or background work")

    monkeypatch.setattr(Path, "touch", forbidden)
    monkeypatch.setattr(wandb, "login", forbidden)
    monkeypatch.setattr(weave, "init", forbidden)
    monkeypatch.setattr("wandb.sdk.lib.wbauth.wbnetrc.write_netrc_auth", forbidden)
    monkeypatch.setattr("weave.trace_server_bindings.remote_http_trace_server.AsyncBatchProcessor", forbidden)
    monkeypatch.setattr("weave.trace_server_bindings.remote_http_trace_server.CallBatchProcessor", forbidden)
    monkeypatch.setattr(ssrf_proxy, "make_request", forbidden)
    monkeypatch.setattr(atexit, "register", forbidden)
    monkeypatch.setenv("WANDB_API_KEY", "unrelated-key")
    monkeypatch.setenv("WANDB_BASE_URL", "https://unrelated.test")
    monkeypatch.setenv("WEAVE_TRACE_SERVER", "https://unrelated-traces.test")
    before = dict(os.environ)
    original = config(entity=None)
    adapter = WeaveDataTrace(original)
    original.api_key = "changed-after-construction"
    assert adapter.weave_api_key == "fixture-key"
    assert adapter.get_project_url() == "https://wandb.ai"
    assert adapter.server.trace_server_url == "https://trace.wandb.ai"
    assert adapter.server._auth == ("api", "fixture-key")
    assert not adapter.server.should_batch
    assert adapter.server.call_processor is None
    assert adapter.server.feedback_processor is None
    assert dict(os.environ) == before


@pytest.mark.usefixtures("agent_runtime_app")
@pytest.mark.parametrize(
    "failure",
    [None]
    + [
        (stage, call_id, status)
        for stage, call_id in [("start", "legacy-run"), ("end", "legacy-run"), ("start", "node-0"), ("end", "node-0")]
        for status in [429, 503]
    ]
    + [
        ("start", "legacy-run", "timeout"),
        ("start", "legacy-run", "malformed"),
        ("end", "node-0", "malformed"),
        ("end", "legacy-run", "timeout"),
    ]
    + [("start", "legacy-run", 401), ("end", "legacy-run", 401)],
)
def test_workflow_emits_four_real_sdk_calls_with_original_ids_payload_and_status(
    sqlite_session: Session,
    wire: list[tuple[str, RequestOptions, dict[str, object]]],
    failure: tuple[str, str, int | str] | None,
) -> None:
    # The normal Flask/SQLite fixtures bind the actual service-account lookup and
    # production repository to persisted rows. Only outbound HTTP is substituted.
    tenant = make_tenant(tenant_id="tenant")
    account = make_account(account_id="owner", tenant=tenant)
    app = make_app(app_id="app", tenant_id=tenant.id, mode=AppMode.WORKFLOW, created_by=account.id)
    membership = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER)
    sqlite_session.add_all([tenant, account, app, membership])
    nodes = [
        WorkflowNodeExecutionModel(
            id=f"node-{i}",
            tenant_id=tenant.id,
            app_id=app.id,
            workflow_id="workflow",
            workflow_run_id="legacy-run",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            index=i,
            node_id=f"node-{i}",
            title=title,
            node_type=kind,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            created_by=account.id,
            created_by_role=CreatorUserRole.ACCOUNT,
            inputs=json.dumps({"synthetic": True}),
            outputs=json.dumps({"answer": "ok"}),
            created_at=START + timedelta(milliseconds=i),
            finished_at=START + timedelta(milliseconds=i + 100),
            elapsed_time=0.1,
            process_data=json.dumps(
                {
                    "prompts": [{"role": "user", "text": "hello"}],
                    "model_mode": "chat",
                    "model_provider": "test",
                    "model_name": "test-model",
                }
            )
            if i == 1
            else None,
            execution_metadata=json.dumps(
                {"total_tokens": 32, "total_price": "0.0000098", "currency": "USD"} if i == 1 else {}
            ),
        )
        for i, (title, kind) in enumerate(
            [("Start", BuiltinNodeTypes.START), ("LLM", BuiltinNodeTypes.LLM), ("End", BuiltinNodeTypes.END)]
        )
    ]
    sqlite_session.add_all(nodes)
    sqlite_session.commit()
    adapter = WeaveDataTrace(config())
    info = WorkflowTraceInfo(
        query="hello",
        workflow_id="workflow",
        tenant_id="tenant",
        workflow_run_id="legacy-run",
        workflow_run_elapsed_time=1.0,
        workflow_run_status="succeeded",
        workflow_run_inputs={"query": "hello"},
        workflow_run_outputs={"answer": "ok"},
        workflow_run_version="v1",
        total_tokens=32,
        file_list=[],
        metadata={"app_id": "app", "conversation_id": None},
        trace_id="external-correlation",
        start_time=START,
        end_time=START + timedelta(seconds=1),
    )

    if failure is not None:
        stage, call_id, outcome = failure
        first_start = (stage, call_id) == ("start", "legacy-run")
        expected = (
            TraceExportRejectedError
            if outcome == 401
            else RetryableTraceDispatchError
            if first_start and outcome in {429, 503}
            else TraceExportUncertainError
        )
        with pytest.raises(expected) as error:
            adapter.trace(info)
        if isinstance(error.value, RetryableTraceDispatchError):
            assert error.value.acceptance_unknown is (expected is TraceExportUncertainError)
        assert len(wire) == (1 if first_start else 8 if call_id == "legacy-run" else 2 if stage == "start" else 3)
        assert "DO_NOT_EXPOSE" not in str(error.value)
        assert adapter.calls == {}
        assert info.workflow_run_status == "succeeded"
        assert all(node.status == WorkflowNodeExecutionStatus.SUCCEEDED for node in nodes)
        before_recovery = len(wire)
        adapter.trace(
            GenerateNameTraceInfo(
                tenant_id=tenant.id,
                inputs="new business operation",
                outputs="new title",
                metadata={},
                start_time=START,
                end_time=START + timedelta(seconds=1),
            )
        )
        assert len(wire) == before_recovery + 2
        assert adapter.calls == {}
        return

    adapter.trace(info)

    starts = [CallStartReq.model_validate(body).start for _, _, body in wire if "start" in body]
    ends = [CallEndReq.model_validate(body).end for _, _, body in wire if "end" in body]
    assert len(starts) == len(ends) == 4
    assert [s.id for s in starts] == ["legacy-run", "node-0", "node-1", "node-2"]
    assert [s.parent_id for s in starts] == [None, "legacy-run", "legacy-run", "legacy-run"]
    assert all(s.trace_id == "external-correlation" and s.project_id == "team/project" for s in starts)
    # Legacy has no native thread/turn contract: keep the existing raw metadata.
    assert all(s.thread_id is None and s.turn_id is None for s in starts)
    assert starts[0].attributes["conversation_id"] is None
    model = starts[2]
    assert model.attributes["total_tokens"] == 32
    assert model.attributes["total_price"] == "0.0000098"
    assert model.inputs["messages"][0]["content"] == "hello"
    model_end = next(e for e in ends if e.id == "node-1")
    assert isinstance(model_end.output, dict)
    assert model_end.output["usage_metadata"]["total_tokens"] == 32
    assert all(e.exception is None and e.summary["status_counts"][TraceStatus.SUCCESS] == 1 for e in ends)
    assert all("usage" not in e.summary for e in ends)  # Do not invent native aggregation for the old mapper.
    assert all(options["auth"] == ("api", "fixture-key") and options["max_retries"] == 0 for _, options, _ in wire)
    assert adapter.calls == {}


def test_interleaved_instances_resolve_only_their_own_credentials_and_targets(monkeypatch: pytest.MonkeyPatch) -> None:
    barrier = Barrier(2)
    observed: list[tuple[str, tuple[str, str], str]] = []
    monkeypatch.setenv("WANDB_API_KEY", "ambient-key")
    monkeypatch.setenv("WANDB_ENTITY", "ambient-entity")
    monkeypatch.setenv("WANDB_PROJECT", "ambient-project")
    before = dict(os.environ)

    def send(_method: str, url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        label = (
            "a"
            if url
            in {
                "https://control-a.test/prefix/graphql",
                "https://trace-a.test/prefix/call/start",
                "https://trace-a.test/prefix/call/end",
            }
            else "b"
        )
        assert url in {
            f"https://control-{label}.test/prefix/graphql",
            f"https://trace-{label}.test/prefix/call/start",
            f"https://trace-{label}.test/prefix/call/end",
        }
        assert options["auth"] == ("api", f"key-{label}")
        if url.endswith("/graphql"):
            return response(url, {"data": {"viewer": {"entity": f"team-{label}"}}})
        body = json.loads(options["content"])
        record = body.get("start", body.get("end"))
        assert record["project_id"] == f"team-{label}/project-{label}"
        observed.append((url, options["auth"], record["project_id"]))
        if "start" in body:
            barrier.wait(timeout=5)
            return response(url, {"id": record["id"], "trace_id": record["trace_id"]})
        return response(url, {})

    monkeypatch.setattr(ssrf_proxy, "make_request", send)

    def run(label: str) -> None:
        adapter = WeaveDataTrace(
            config(
                api_key=f"key-{label}",
                entity=None,
                project=f"project-{label}",
                host=f"https://control-{label}.test/prefix",
                endpoint=f"https://trace-{label}.test/prefix/",
            )
        )
        data = call(f"call-{label}")
        adapter.start_call(data)
        adapter.finish_call(data)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(run, ["a", "b"]))
    assert len(observed) == 4
    assert dict(os.environ) == before


def test_concurrent_dispatches_on_one_cached_instance_keep_prefix_state_isolated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    barrier = Barrier(2)

    def send(_method: str, url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        body = json.loads(options["content"])
        if "start" in body:
            start = CallStartReq.model_validate(body).start
            if start.inputs["label"] == "unaccepted":
                barrier.wait(timeout=5)
                return response(url, {}, status=503)
            return response(url, {"id": start.id, "trace_id": start.trace_id})
        CallEndReq.model_validate(body)
        barrier.wait(timeout=5)
        return response(url, {}, status=503)

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    adapter = WeaveDataTrace(config())

    def run(label: str) -> RetryableTraceDispatchError:
        info = GenerateNameTraceInfo(
            tenant_id="tenant",
            inputs={"label": label},
            outputs={"label": label},
            metadata={},
            start_time=START,
            end_time=START + timedelta(seconds=1),
        )
        with pytest.raises(RetryableTraceDispatchError) as error:
            adapter.trace(info)
        return error.value

    with ThreadPoolExecutor(max_workers=2) as pool:
        accepted, unaccepted = list(pool.map(run, ["accepted", "unaccepted"]))
    assert isinstance(accepted, TraceExportUncertainError)
    assert accepted.acceptance_unknown
    assert not unaccepted.acceptance_unknown
    assert adapter.calls == {}


@pytest.mark.parametrize(
    ("stage", "failure"),
    [
        (stage, failure)
        for stage in ("start", "end")
        for failure in ("rejected", "retryable", "malformed", "mismatched_id")
        if not (stage == "end" and failure == "mismatched_id")
    ],
)
def test_synchronous_failures_propagate_and_next_call_recovers(
    monkeypatch: pytest.MonkeyPatch, stage: str, failure: str
) -> None:
    broken = True
    requests = []

    def send(_method: str, url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        body = json.loads(options["content"])
        requests.append(url)
        if broken and url.endswith("/call/" + stage):
            if failure == "rejected":
                return response(url, {"error": "DO_NOT_EXPOSE_KEY_OR_BODY"}, status=401)
            if failure == "retryable":
                return response(url, {}, status=503)
            if failure == "malformed":
                return httpx.Response(200, request=httpx.Request("POST", url), content=b"invalid-json")
            return response(url, {"id": "wrong-id", "trace_id": "wrong-trace"})
        if "start" in body:
            return response(url, {"id": body["start"]["id"], "trace_id": body["start"]["trace_id"]})
        return response(url, {})

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    adapter = WeaveDataTrace(config())
    data = call()
    expected = {
        "rejected": TraceExportRejectedError,
        "retryable": RetryableTraceDispatchError,
        "malformed": TraceExportUncertainError,
        "mismatched_id": TraceExportUncertainError,
    }[failure]
    if stage == "end":
        adapter.start_call(data)
    with pytest.raises(expected) as error:
        adapter.start_call(data) if stage == "start" else adapter.finish_call(data)
    assert "DO_NOT_EXPOSE" not in str(error.value)
    assert len(requests) == (1 if stage == "start" else 2)
    assert adapter.calls == {}
    broken = False
    recovered = call("next-call", exception="synthetic tool error")
    adapter.start_call(recovered)
    adapter.finish_call(recovered)
    assert adapter.calls == {}


def test_legacy_api_check_uses_read_only_project_and_stats_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = []

    def post(url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        assert options["auth"] == ("api", "fixture-key")
        assert options["follow_redirects"] is False
        sent.append(url)
        if url == "https://api.wandb.ai/graphql":
            return response(
                url,
                {
                    "data": {
                        "viewer": {"id": "viewer"},
                        "project": {"id": "project-id", "name": "project", "entityName": "team", "readOnly": False},
                    }
                },
            )
        assert url == "https://trace.wandb.ai/calls/query_stats"
        assert options["json"]["project_id"] == "team/project"
        return response(url, {"count": 0})

    monkeypatch.setattr(ssrf_proxy, "post", post)
    adapter = WeaveDataTrace(config())
    assert sent == []
    assert adapter.api_check()
    assert sent == ["https://api.wandb.ai/graphql", "https://trace.wandb.ai/calls/query_stats"]
    assert adapter.calls == {}


@pytest.mark.parametrize(
    ("sent_id", "ack_id"),
    [
        ("1234567812345678123456781234abcd", "12345678-1234-5678-1234-56781234abcd"),
        ("12345678-1234-5678-1234-56781234abcd", "1234567812345678123456781234ABCD"),
        ("12345678-1234-5678-1234-56781234ABCD", "1234567812345678123456781234abcd"),
    ],
)
def test_uuid_equivalent_start_ack_preserves_sent_ids(
    monkeypatch: pytest.MonkeyPatch, sent_id: str, ack_id: str
) -> None:
    sent: list[dict[str, object]] = []

    def send(_method: str, url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        body = json.loads(options["content"])
        sent.append(body)
        if "start" in body:
            start = CallStartReq.model_validate(body).start
            assert start.id == sent_id
            assert start.trace_id == sent_id
            return response(url, {"id": ack_id, "trace_id": ack_id})
        end = CallEndReq.model_validate(body).end
        assert end.id == sent_id
        return response(url, {})

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    adapter = WeaveDataTrace(config())
    data = call(sent_id)
    adapter.start_call(data)
    assert adapter.calls[sent_id]["trace_id"] == sent_id
    adapter.finish_call(data)
    assert len(sent) == 2
    assert adapter.calls == {}


@pytest.mark.parametrize("field", ["id", "trace_id"])
@pytest.mark.parametrize(
    ("sent_id", "wrong_ack"),
    [
        ("1234567812345678123456781234abcd", "12345678-1234-5678-1234-56781234abce"),
        ("legacy-correlation", "LEGACY-CORRELATION"),
        ("1234567812345678123456781234abcd", "not-a-uuid"),
    ],
)
def test_start_ack_rejects_different_uuid_or_opaque_identifiers(
    monkeypatch: pytest.MonkeyPatch, field: str, sent_id: str, wrong_ack: str
) -> None:
    sent = []

    def send(_method: str, url: str, **options: Unpack[RequestOptions]) -> httpx.Response:
        start = CallStartReq.model_validate_json(options["content"]).start
        sent.append(start)
        ack = {"id": start.id, "trace_id": start.trace_id}
        ack[field] = wrong_ack
        return response(url, ack)

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    adapter = WeaveDataTrace(config())
    with pytest.raises(TraceExportUncertainError, match="did not acknowledge the submitted identifiers"):
        adapter.start_call(call(sent_id))
    assert len(sent) == 1
    assert adapter.calls == {}
