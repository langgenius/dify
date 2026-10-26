import atexit
import base64
import json
import os
import threading
from collections.abc import Callable, Iterator, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from threading import Barrier, Thread
from typing import Never, NotRequired, TypedDict, Unpack, cast
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

import httpcore
import httpx
import pytest
import requests
import wandb
import weave
from aliyun.log.logclient import LogClient
from dify_trace_aliyun.aliyun_trace import AliyunDataTrace
from dify_trace_aliyun.config import AliyunConfig
from dify_trace_aliyun.data_exporter.traceclient import TraceClient, convert_to_span_id
from dify_trace_aliyun.entities.aliyun_trace_entity import SpanData
from dify_trace_aliyun.entities.semconv import GEN_AI_USAGE_TOTAL_TOKENS
from dify_trace_arize_phoenix.arize_phoenix_trace import setup_tracer
from dify_trace_arize_phoenix.config import PhoenixConfig
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.entities.weave_trace_entity import WeaveTraceModel
from dify_trace_weave.weave_trace import WeaveDataTrace
from mlflow.entities import Span as _native_weave_mlflow_Span
from mlflow.entities import TraceData
from mlflow.tracing.constant import SpanAttributeKey
from mlflow.tracing.otel.translation import translate_span_when_storing
from mlflow.types.chat import ChatTool
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)
from opentelemetry.proto.trace.v1.trace_pb2 import Span as _provider_dispatch_Span
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from weave.trace_server.trace_server_interface import CallEndReq, CallStartReq, StartedCallSchemaForInsert, TraceStatus

from core.helper import ssrf_proxy
from core.ops.entities.trace_entity import (
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    _dict_to_workflow_node_execution_model,
)
from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run
from graphon.enums import BuiltinNodeTypes, WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from libs.datetime_utils import naive_utc_now
from models.account import TenantAccountJoin, TenantAccountRole
from models.application_trace import ApplicationTraceRun
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus
from models.model import App, AppMode
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowRunTriggeredFrom,
    WorkflowType,
)
from repositories import application_trace_repository as repository_module
from repositories.application_trace_repository import TraceCollectionError
from services.tracing import service as service_module
from services.tracing.normalization import remap_outer_trace
from services.tracing.provider_dispatch import (
    TraceExportRejectedError,
    TraceExportResult,
    TraceExportUncertainError,
    export_trace,
    provider_capabilities,
)
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account, make_app, make_message, make_tenant
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_batch_for as batch_for
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_claim as claim
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_identifier as identifier
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_ingest as ingest
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_seed as seed
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_terminal as terminal
from tests.unit_tests.services.tracing.test_service import _ApplicationTraceCollectionCollection as Collection

"""Node logs resolve the caller's trace using SQL or configured LogStore ownership."""


@dataclass
class NodeAlias:
    case: Collection
    node: dict[str, object]
    workflow: dict[str, object]
    requests: list[str]
    logstore: bool

    def service(self) -> ApplicationTracingService:
        return ApplicationTracingService(self.case.repository)

    def status(self, node_execution_id: str | None = None) -> dict[str, object]:
        return self.service().status(
            tenant_id=self.case.run.tenant_id,
            app_id=self.case.run.app_id,
            source_kind="node",
            source_id=str(self.node["id"]),
            node_execution_id=node_execution_id,
        )

    def accept(self, *, spans: bool = True) -> tuple[str, str]:
        span_urls: dict[str, str] = {}
        for attempt in (0, 1):
            invocation = self.case.repository.invocation(
                run_id=self.case.run.id,
                agent_id=identifier("referenced-agent"),
                node_execution_id=str(self.node["id"]),
                attempt=attempt,
                call_key=f"attempt-{attempt}",
            )
            ingest(self.case, batch_for(self.case.run, invocation, span_id=str(attempt + 1) * 16))
            span_urls[invocation.span_id] = f"https://provider.test/span/{attempt}"
        terminal(self.case)
        lease = claim(self.case)
        assert lease is not None
        self.case.repository.complete(
            self.case.run.id,
            lease[1],
            state="accepted",
            result=TraceExportResult(
                "provider-trace", "https://provider.test/trace", span_urls=span_urls if spans else {}
            ),
        )
        return "https://provider.test/trace", "https://provider.test/span/1"


class TestApplicationTraceNodeAliasCases:
    @staticmethod
    @pytest.fixture(params=["sql", "logstore"])
    def alias(
        request: pytest.FixtureRequest,
        sqlite_engine: Engine,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> Iterator[NodeAlias]:
        case = seed(sqlite_session_factory, "node-alias")
        with case.sessions.begin() as session:
            app = session.get(App, case.run.app_id)
            assert app is not None
            app.mode = AppMode.WORKFLOW
        common: dict[str, object] = {
            "tenant_id": case.run.tenant_id,
            "app_id": case.run.app_id,
            "workflow_id": identifier("definition"),
            "created_by": identifier("actor"),
            "created_at": naive_utc_now().isoformat(),
            "status": "succeeded",
        }
        workflow = {**common, "id": identifier("workflow-source"), "graph": json.dumps({"nodes": []})}
        node = {
            **common,
            "id": identifier("node-source"),
            "workflow_run_id": workflow["id"],
            "node_id": "reference-agent",
            "node_type": "agent",
            "title": "Reference Agent",
        }
        requests: list[str] = []
        transactions: set[Connection] = set()

        def begun(connection: Connection) -> None:
            transactions.add(connection)

        def ended(connection: Connection) -> None:
            transactions.discard(connection)

        if request.param == "sql":
            with case.sessions.begin() as session:
                session.add(_dict_to_workflow_run(workflow))
                session.add(_dict_to_workflow_node_execution_model(node))
        else:
            apply_config_overrides(
                monkeypatch,
                LOGSTORE_DUAL_WRITE_ENABLED=False,
                API_WORKFLOW_RUN_REPOSITORY=(
                    "extensions.logstore.repositories.logstore_api_workflow_run_repository.LogstoreAPIWorkflowRunRepository"
                ),
                API_WORKFLOW_NODE_EXECUTION_REPOSITORY=(
                    "extensions.logstore.repositories.logstore_api_workflow_node_execution_repository."
                    "LogstoreAPIWorkflowNodeExecutionRepository"
                ),
            )
            for key, value in {
                "LOGSTORE_DUAL_READ_ENABLED": "false",
                "LOGSTORE_PG_MODE_ENABLED": "false",
                "ALIYUN_SLS_ACCESS_KEY_ID": "test-access-key",
                "ALIYUN_SLS_ACCESS_KEY_SECRET": "test-secret",
                "ALIYUN_SLS_ENDPOINT": "https://sls.example.test",
                "ALIYUN_SLS_REGION": "test-region",
            }.items():
                monkeypatch.setenv(key, value)
            monkeypatch.setattr(AliyunLogStore, "_instance", None)
            monkeypatch.setattr(AliyunLogStore, "_initialized", False)
            monkeypatch.setattr(
                AliyunLogStore, "_check_endpoint_connectivity", staticmethod(lambda _endpoint, _timeout: None)
            )

            def reject_http_transport(*_args: object, **_kwargs: object) -> None:
                pytest.fail("Configured LogStore test escaped its isolated transport boundary")

            monkeypatch.setattr(LogClient, "_getHttpResponse", reject_http_transport)

            def get_logs(
                _client: AliyunLogStore, *, query: str, logstore: str, **_kwargs: object
            ) -> list[dict[str, object]]:
                assert not transactions, "Configured source reads must not hold a SQL transaction"
                assert f'tenant_id:"{case.run.tenant_id}"' in query.replace(": ", ":")
                assert logstore in {
                    AliyunLogStore.workflow_execution_logstore,
                    AliyunLogStore.workflow_node_execution_logstore,
                }
                is_workflow = logstore == AliyunLogStore.workflow_execution_logstore
                if is_workflow:
                    assert f'app_id:"{case.run.app_id}"' in query
                requests.append("workflow" if is_workflow else "node")
                row = workflow if is_workflow else node
                return [dict(row)] if row else []

            monkeypatch.setattr(AliyunLogStore, "get_logs", get_logs)

            def execute_sql(
                client: AliyunLogStore, *, sql: str, query: str, logstore: str, **_kwargs: object
            ) -> list[dict[str, object]]:
                # Node lookups use the SQL transport in SDK mode too; the real
                # service still validates the returned node-to-workflow owner chain.
                assert logstore == AliyunLogStore.workflow_node_execution_logstore
                assert f'id:"{identifier("node-source")}"' in query.replace(": ", ":")
                assert f"tenant_id = '{case.run.tenant_id}'" in sql
                assert f"id = '{identifier('node-source')}'" in sql
                assert f'FROM "{logstore}"' in sql
                assert "ORDER BY log_version DESC LIMIT 1" in sql
                return get_logs(client, query=query, logstore=logstore)

            monkeypatch.setattr(AliyunLogStore, "execute_sql", execute_sql)
            with case.sessions() as session:
                assert session.scalar(select(WorkflowRun)) is None
                assert session.scalar(select(WorkflowNodeExecutionModel)) is None
        event.listen(sqlite_engine, "begin", begun)
        event.listen(sqlite_engine, "commit", ended)
        event.listen(sqlite_engine, "rollback", ended)
        try:
            run = case.repository.start(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                source_kind="workflow",
                source_id=str(workflow["id"]),
                session_id="caller-session",
            )
            assert run is not None
            requests.clear()
            yield NodeAlias(
                Collection(case.repository, case.sessions, run), node, workflow, requests, request.param == "logstore"
            )
        finally:
            event.remove(sqlite_engine, "begin", begun)
            event.remove(sqlite_engine, "commit", ended)
            event.remove(sqlite_engine, "rollback", ended)

    @staticmethod
    @pytest.mark.parametrize("spans", [True, False])
    def test_alias_returns_parent_trace_and_latest_owned_invocation(alias: NodeAlias, spans: bool) -> None:
        trace_url, span_url = alias.accept(spans=spans)
        status = alias.status()
        assert status["status"] == "accepted"
        assert status["source_kind"] == "node"
        assert status["source_id"] == alias.node["id"]
        assert status["trace_id"] == "provider-trace"
        assert status["trace_url"] == trace_url
        assert status["span_url"] == (span_url if spans else None)
        assert status["config_revision"] == alias.case.run.config_revision
        if alias.logstore:
            assert alias.requests == ["node", "workflow"]

    @staticmethod
    @pytest.mark.parametrize("capture_agent", [True, False])
    @pytest.mark.parametrize("accepted", [True, False])
    def test_alias_without_internal_invocation_returns_parent_status(
        alias: NodeAlias, capture_agent: bool, accepted: bool
    ) -> None:
        with alias.case.sessions.begin() as session:
            run = session.get(ApplicationTraceRun, alias.case.run.id)
            assert run is not None
            run.capture_agent = capture_agent
        if accepted:
            terminal(alias.case)
            lease = claim(alias.case)
            assert lease is not None
            alias.case.repository.complete(
                alias.case.run.id,
                lease[1],
                state="accepted",
                result=TraceExportResult("outer-only", "https://provider.test/outer"),
            )
        status = alias.status()
        assert status["status"] == ("accepted" if accepted else "collecting")
        assert status["span_url"] is None
        assert status["capture_agent"] is capture_agent
        assert status["trace_url"] == ("https://provider.test/outer" if accepted else None)

    @staticmethod
    @pytest.mark.parametrize("state", ["collecting", "not_collected"])
    def test_standalone_node_snapshot_wins_over_parent(alias: NodeAlias, state: str) -> None:
        alias.accept()
        node_run = alias.case.repository.start(
            tenant_id=alias.case.run.tenant_id,
            app_id=alias.case.run.app_id,
            source_kind="node",
            source_id=str(alias.node["id"]),
            session_id="preview-session",
        )
        assert node_run is not None
        with alias.case.sessions.begin() as session:
            run = session.get(ApplicationTraceRun, node_run.id)
            assert run is not None
            run.state = state
        alias.requests.clear()
        status = alias.status()
        assert status["status"] == state
        assert status.get("trace_url") is None
        if alias.logstore:
            assert alias.requests == ["node"]

    @staticmethod
    def test_explicit_other_node_filter_cannot_select_sibling_span(
        alias: NodeAlias, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        sibling = alias.case.repository.invocation(
            run_id=alias.case.run.id,
            agent_id=identifier("referenced-agent"),
            node_execution_id=identifier("sibling-node"),
            attempt=0,
            call_key="sibling",
        )
        ingest(alias.case, batch_for(alias.case.run, sibling, span_id="f" * 16))
        alias.accept()
        with pytest.raises(TraceCollectionError, match="tracing_node_not_found") as error:
            alias.status(identifier("sibling-node"))
        assert error.value.status == 404
        service = alias.service()
        scheduled: list[str] = []
        monkeypatch.setattr(service, "schedule", scheduled.append)
        with pytest.raises(TraceCollectionError, match="tracing_node_not_found"):
            service.retry(
                tenant_id=alias.case.run.tenant_id,
                app_id=alias.case.run.app_id,
                source_kind="node",
                source_id=str(alias.node["id"]),
                node_execution_id=identifier("sibling-node"),
                acknowledge_possible_duplicates=True,
            )
        assert not scheduled

    @staticmethod
    @pytest.mark.parametrize("state", ["failed", "uncertain", "accepted"])
    def test_alias_retry_uses_parent_guards_and_resolves_sources_once(
        alias: NodeAlias, state: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        alias.accept()
        with alias.case.sessions.begin() as session:
            run = session.get(ApplicationTraceRun, alias.case.run.id)
            assert run is not None
            run.state = state
        service = alias.service()
        scheduled: list[str] = []
        monkeypatch.setattr(service, "schedule", scheduled.append)

        def retry(acknowledge: bool) -> dict[str, object]:
            alias.requests.clear()
            return service.retry(
                tenant_id=alias.case.run.tenant_id,
                app_id=alias.case.run.app_id,
                source_kind="node",
                source_id=str(alias.node["id"]),
                acknowledge_possible_duplicates=acknowledge,
            )

        if state == "accepted":
            with pytest.raises(TraceCollectionError, match="tracing_already_accepted") as error:
                retry(True)
            assert error.value.status == 409
            assert not scheduled
        else:
            if state == "uncertain":
                with pytest.raises(TraceCollectionError, match="tracing_duplicate_acknowledgement_required"):
                    retry(False)
                assert not scheduled
            assert retry(state == "uncertain")["status"] == "ready"
            assert scheduled == [alias.case.run.id]
        if alias.logstore:
            assert alias.requests == ["node", "workflow"]

    @staticmethod
    @pytest.mark.parametrize("source", ["node", "workflow"])
    @pytest.mark.parametrize("field", ["tenant_id", "app_id", "workflow_id"])
    def test_alias_rejects_broken_owner_chain(alias: NodeAlias, source: str, field: str) -> None:
        alias.accept()
        row = alias.node if source == "node" else alias.workflow
        if alias.logstore:
            row[field] = identifier("foreign")
        else:
            with alias.case.sessions.begin() as session:
                model = session.get(WorkflowNodeExecutionModel if source == "node" else WorkflowRun, str(row["id"]))
                assert model is not None
                # Keep field assignments explicit so ownership failures are visible.
                if field == "tenant_id":
                    model.tenant_id = identifier("foreign")
                elif field == "app_id":
                    model.app_id = identifier("foreign")
                else:
                    model.workflow_id = identifier("foreign")
        with pytest.raises(TraceCollectionError, match="tracing_source_not_found") as error:
            alias.status()
        assert error.value.status == 404

    @staticmethod
    def test_alias_missing_parent_business_source_is_not_a_durable_owner_bypass(alias: NodeAlias) -> None:
        if alias.logstore:
            alias.workflow.clear()
        else:
            with alias.case.sessions.begin() as session:
                parent = session.get(WorkflowRun, str(alias.workflow["id"]))
                assert parent is not None
                session.delete(parent)
        with pytest.raises(TraceCollectionError, match="tracing_source_not_found"):
            alias.status()

    @staticmethod
    def test_owned_alias_without_parent_trace_is_not_collected(alias: NodeAlias) -> None:
        with alias.case.sessions.begin() as session:
            run = session.get(ApplicationTraceRun, alias.case.run.id)
            assert run is not None
            session.delete(run)
        assert alias.status() == {"status": "not_collected", "source_kind": "node", "source_id": alias.node["id"]}


"""Real SQLite state transitions and background renewal for delivery leases.

PostgreSQL row-lock scheduling and the deployed Celery pool still need dev
validation; these tests establish token and acknowledgement semantics.
"""


def _stored(case: Collection) -> ApplicationTraceRun:
    row = case.repository.get(case.run.id)
    assert row is not None
    return row


def _expire(case: Collection) -> str:
    leased = claim(case)
    assert leased is not None
    with case.sessions.begin() as session:
        row = session.get(ApplicationTraceRun, case.run.id)
        assert row is not None
        row.export_started_at = naive_utc_now() - timedelta(seconds=60)
        row.export_heartbeat_at = row.export_started_at
    assert claim(case) is None
    assert _stored(case).state == "uncertain"
    return leased[1]


class TestExportLeaseCases:
    @staticmethod
    @pytest.fixture
    def case(sqlite_session_factory: sessionmaker[Session]) -> Collection:
        result = seed(sqlite_session_factory, "lease-test")
        ingest(result, batch_for(result.run, result.invocation()))
        terminal(result)
        return result

    @staticmethod
    def test_renewal_keeps_long_export_alive_then_missing_heartbeat_expires(
        case: Collection, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        clock = [naive_utc_now()]
        monkeypatch.setattr(repository_module, "naive_utc_now", lambda: clock[0])
        leased = claim(case)
        assert leased is not None
        token = leased[1]
        clock[0] += timedelta(seconds=20)
        assert case.repository.renew_export_lease(case.run.id, token)
        clock[0] += timedelta(seconds=20)
        assert claim(case) is None
        current = _stored(case)
        assert current.state == "exporting"
        assert current.attempts == 1
        assert current.export_started_at is not None
        assert current.export_started_at + timedelta(seconds=30) < clock[0]
        clock[0] += timedelta(seconds=11)
        assert claim(case) is None
        expired = _stored(case)
        assert expired.state == "uncertain"
        assert expired.error_code == "export_lease_expired"
        assert expired.export_token == token
        assert not case.repository.renew_export_lease(case.run.id, token)

    @staticmethod
    def test_old_rows_without_heartbeat_use_started_at(case: Collection) -> None:
        leased = claim(case)
        assert leased is not None
        with case.sessions.begin() as session:
            row = session.get(ApplicationTraceRun, case.run.id)
            assert row is not None
            row.export_started_at = naive_utc_now() - timedelta(seconds=60)
            row.export_heartbeat_at = None
        assert claim(case) is None
        current = _stored(case)
        assert current.state == "uncertain"
        assert current.export_token == leased[1]

    @staticmethod
    def test_wrong_token_cannot_renew_or_complete(case: Collection) -> None:
        leased = claim(case)
        assert leased is not None
        before = _stored(case)
        assert not case.repository.renew_export_lease(case.run.id, "other-token")
        case.repository.complete(case.run.id, "other-token", state="accepted", result=TraceExportResult("wrong"))
        current = _stored(case)
        assert current.export_token == leased[1]
        assert current.export_heartbeat_at == before.export_heartbeat_at
        assert current.state == "exporting"
        assert current.provider_trace_id is None

    @staticmethod
    def test_late_success_wins_before_manual_retry_and_is_idempotent(case: Collection) -> None:
        token = _expire(case)
        result = TraceExportResult("confirmed", "https://example.com/trace")
        case.repository.complete(case.run.id, token, state="accepted", result=result)
        current = _stored(case)
        assert current.state == "accepted"
        assert current.error_code is None
        assert current.export_token is None
        assert current.accepted_at is not None
        assert current.trace_url == result.trace_url
        case.repository.complete(case.run.id, token, state="accepted", result=TraceExportResult("duplicate-ack"))
        assert _stored(case).provider_trace_id == "confirmed"
        with pytest.raises(TraceCollectionError, match="tracing_already_accepted"):
            case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)

    @staticmethod
    def test_manual_retry_revokes_old_heartbeat_and_ack_before_and_after_new_claim(case: Collection) -> None:
        old_token = _expire(case)
        case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)
        assert not case.repository.renew_export_lease(case.run.id, old_token)
        case.repository.complete(case.run.id, old_token, state="accepted", result=TraceExportResult("old"))
        assert _stored(case).state == "ready"
        second = claim(case)
        assert second is not None
        assert second[1] != old_token
        case.repository.complete(case.run.id, old_token, state="accepted", result=TraceExportResult("old"))
        current = _stored(case)
        assert current.state == "exporting"
        assert current.export_token == second[1]
        assert current.provider_trace_id is None
        case.repository.complete(case.run.id, second[1], state="accepted", result=TraceExportResult("new"))
        assert _stored(case).provider_trace_id == "new"

    @staticmethod
    @pytest.mark.parametrize("late_state", ["failed", "retrying", "uncertain"])
    def test_late_non_success_cannot_overwrite_lease_expiry(case: Collection, late_state: str) -> None:
        token = _expire(case)
        case.repository.complete(case.run.id, token, state=late_state, error_code="late-failure")
        current = _stored(case)
        assert current.state == "uncertain"
        assert current.error_code == "export_lease_expired"

    @staticmethod
    def test_other_uncertain_reason_cannot_be_promoted_by_late_ack(case: Collection) -> None:
        token = _expire(case)
        with case.sessions.begin() as session:
            row = session.get(ApplicationTraceRun, case.run.id)
            assert row is not None
            row.error_code = "provider_acceptance_unknown"
        case.repository.complete(case.run.id, token, state="accepted", result=TraceExportResult("late"))
        assert _stored(case).state == "uncertain"

    @staticmethod
    @pytest.mark.parametrize("transient_failure", [False, True])
    @pytest.mark.parametrize("outcome", ["accepted", "uncertain"])
    def test_service_heartbeats_during_export_and_stops_on_every_outcome(
        case: Collection,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        transient_failure: bool,
        outcome: str,
    ) -> None:
        apply_config_overrides(monkeypatch, OPS_AGENT_TRACE_EXPORT_LEASE_SECONDS=1)
        clock = [naive_utc_now()]
        monkeypatch.setattr(repository_module, "naive_utc_now", lambda: clock[0])
        monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
        renewed = threading.Event()
        calls = []
        original = case.repository.renew_export_lease

        def renew(run_id: str, token: str) -> bool:
            calls.append(threading.get_ident())
            if transient_failure and len(calls) == 1:
                raise RuntimeError("private-provider-value")
            result = original(run_id, token)
            renewed.set()
            return result

        monkeypatch.setattr(case.repository, "renew_export_lease", renew)

        def export(*_args: object) -> TraceExportResult:
            # The original start time is now beyond the lease; only a real background
            # transaction can prevent a second claimant from marking it uncertain.
            clock[0] += timedelta(seconds=3)
            assert renewed.wait(3), "background heartbeat did not commit"
            assert case.repository.claim(case.run.id, collection_timeout=60, lease_seconds=1) is None
            assert _stored(case).state == "exporting"
            if outcome == "uncertain":
                raise TraceExportUncertainError("lost acknowledgement")
            return TraceExportResult("ack")

        monkeypatch.setattr(service_module, "export_trace", export)
        ApplicationTracingService(case.repository).deliver(case.run.id)
        assert _stored(case).state == outcome
        assert calls
        assert all(thread_id != threading.get_ident() for thread_id in calls)
        assert not any(thread.name == f"application-trace-lease-{case.run.id}" for thread in threading.enumerate())
        assert "private-provider-value" not in caplog.text

    @staticmethod
    def test_heartbeat_stops_even_when_completion_database_write_raises(
        case: Collection, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(service_module.OpsTraceManager, "decrypt_tracing_config", lambda *_args: {})
        monkeypatch.setattr(service_module, "export_trace", lambda *_args: TraceExportResult("ack"))

        def fail_complete(*_args: object, **_kwargs: object) -> None:
            raise RuntimeError("database unavailable")

        monkeypatch.setattr(case.repository, "complete", fail_complete)
        with pytest.raises(RuntimeError, match="database unavailable"):
            ApplicationTracingService(case.repository).deliver(case.run.id)
        assert not any(thread.name == f"application-trace-lease-{case.run.id}" for thread in threading.enumerate())


"""Persisted legacy sources through real OTel protobuf, replacing only HTTP I/O."""


_LEGACY_ALIYUN_TRANSPORT_START = datetime(2026, 10, 19, tzinfo=UTC)
RUN_ID = "a0000000-0000-4000-8000-000000000001"
MESSAGE_ID = "a0000000-0000-4000-8000-000000000002"
NODE_IDS = [f"b0000000-0000-4000-8000-00000000000{i}" for i in range(3)]


class _LegacyAliyunTransportRequestoptions(TypedDict, total=False):
    content: bytes
    headers: Mapping[str, str]
    max_retries: int
    follow_redirects: bool
    timeout: float


def _legacy_aliyun_transport_config(**overrides: object) -> AliyunConfig:
    return AliyunConfig.model_validate(
        {
            "app_name": "owned-service",
            "license_key": "owned-key",
            "endpoint": "https://collector.test/prefix",
            **overrides,
        }
    )


def decoded(options: _LegacyAliyunTransportRequestoptions) -> ExportTraceServiceRequest:
    payload = ExportTraceServiceRequest()
    payload.ParseFromString(options["content"])
    return payload


class TestLegacyAliyunTransportCases:
    @staticmethod
    def test_constructor_and_presentation_have_no_network_sdk_queue_or_environment_mutation(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        def forbidden(*_args: object, **_kwargs: object) -> None:
            pytest.fail("Constructor and presentation must not create I/O, exporters or worker threads")

        monkeypatch.setattr(ssrf_proxy, "make_request", forbidden)
        monkeypatch.setattr(OTLPSpanExporter, "__init__", forbidden)
        monkeypatch.setattr(Thread, "start", forbidden)
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://ambient.test")
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=ambient")
        before = dict(os.environ)
        original = _legacy_aliyun_transport_config()
        adapter = AliyunDataTrace(original)
        original.license_key = "mutated-after-construction"
        assert adapter.trace_client.endpoint == "https://collector.test/prefix/adapt_owned-key/api/otlp/traces"
        assert adapter.get_project_url() == "https://arms.console.aliyun.com/#/llm"
        assert not hasattr(adapter.trace_client, "exporter")
        assert not hasattr(adapter.trace_client, "queue")
        assert not hasattr(adapter.trace_client, "worker_thread")
        assert dict(os.environ) == before

    @staticmethod
    @pytest.mark.usefixtures("agent_runtime_app")
    @pytest.mark.parametrize("failure", [None, 400, 401, 403, 429, 503, "timeout", "partial", "malformed", "redirect"])
    def test_persisted_workflow_uses_one_acknowledged_protobuf_batch_and_preserves_business_state(
        sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, failure: int | str | None
    ) -> None:
        tenant = make_tenant(tenant_id="tenant")
        account = make_account(account_id="owner", tenant=tenant)
        app = make_app(app_id="app", tenant_id=tenant.id, mode=AppMode.WORKFLOW, created_by=account.id)
        membership = TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER)
        run = WorkflowRun(
            id=RUN_ID,
            tenant_id=tenant.id,
            app_id=app.id,
            workflow_id="workflow",
            type=WorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            version="v1",
            inputs=json.dumps({"query": "hello"}),
            outputs=json.dumps({"answer": "ok"}),
            status=WorkflowExecutionStatus.SUCCEEDED,
            total_tokens=32,
            created_by=account.id,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_at=_LEGACY_ALIYUN_TRANSPORT_START,
            finished_at=_LEGACY_ALIYUN_TRANSPORT_START + timedelta(seconds=1),
            elapsed_time=1,
        )
        sqlite_session.add_all([tenant, account, app, membership, run])
        nodes = [
            WorkflowNodeExecutionModel(
                id=NODE_IDS[i],
                tenant_id=tenant.id,
                app_id=app.id,
                workflow_id="workflow",
                workflow_run_id=RUN_ID,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                index=i,
                node_id=f"node-{i}",
                title=title,
                node_type=kind,
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by=account.id,
                created_by_role=CreatorUserRole.ACCOUNT,
                inputs=json.dumps({"synthetic": True}),
                outputs=json.dumps(
                    {"text": "ok", "usage": {"prompt_tokens": 21, "completion_tokens": 11, "total_tokens": 32}}
                ),
                created_at=_LEGACY_ALIYUN_TRANSPORT_START + timedelta(milliseconds=i),
                finished_at=_LEGACY_ALIYUN_TRANSPORT_START + timedelta(milliseconds=i + 100),
                elapsed_time=0.1,
                process_data=json.dumps(
                    {
                        "prompts": [{"role": "user", "text": "hello"}],
                        "model_provider": "test",
                        "model_name": "test-model",
                    }
                )
                if i == 1
                else None,
            )
            for i, (title, kind) in enumerate(
                [("Start", BuiltinNodeTypes.START), ("LLM", BuiltinNodeTypes.LLM), ("End", BuiltinNodeTypes.END)]
            )
        ]
        sqlite_session.add_all(nodes)
        sqlite_session.commit()
        info = WorkflowTraceInfo(
            query="hello",
            workflow_id="workflow",
            tenant_id=tenant.id,
            workflow_run_id=RUN_ID,
            workflow_run_elapsed_time=1.0,
            workflow_run_status="succeeded",
            workflow_run_inputs={"query": "hello"},
            workflow_run_outputs={"answer": "ok"},
            workflow_run_version="v1",
            total_tokens=32,
            file_list=[],
            metadata={"app_id": app.id, "conversation_id": "owned-conversation"},
            start_time=_LEGACY_ALIYUN_TRANSPORT_START,
            end_time=_LEGACY_ALIYUN_TRANSPORT_START + timedelta(seconds=1),
        )
        sent: list[tuple[str, _LegacyAliyunTransportRequestoptions, ExportTraceServiceRequest]] = []

        def send(method: str, url: str, **options: Unpack[_LegacyAliyunTransportRequestoptions]) -> httpx.Response:
            assert method == "POST"
            assert url == "https://collector.test/prefix/adapt_owned-key/api/otlp/traces"
            sent.append((url, options, decoded(options)))
            if len(sent) == 1:
                if failure == "timeout":
                    raise httpx.ReadTimeout("synthetic lost ACK", request=httpx.Request("POST", url))
                if isinstance(failure, int):
                    return httpx.Response(failure, content=b"DO_NOT_EXPOSE_BODY")
                if failure == "malformed":
                    return httpx.Response(200, content=b"not protobuf")
                if failure == "partial":
                    response = ExportTraceServiceResponse()
                    response.partial_success.rejected_spans = 1
                    response.partial_success.error_message = "DO_NOT_EXPOSE_BODY"
                    return httpx.Response(200, content=response.SerializeToString())
                if failure == "redirect":
                    return httpx.Response(307, headers={"Location": "https://unrelated.test"})
            return httpx.Response(200, content=ExportTraceServiceResponse().SerializeToString())

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        adapter = AliyunDataTrace(_legacy_aliyun_transport_config())
        if failure is None:
            adapter.trace(info)
        else:
            expected = (
                RetryableTraceDispatchError
                if failure in {429, 503}
                else TraceExportUncertainError
                if failure in {"timeout", "partial", "malformed"}
                else TraceExportRejectedError
            )
            with pytest.raises(expected) as error:
                adapter.trace(info)
            assert "DO_NOT_EXPOSE_BODY" not in str(error.value)
            if isinstance(error.value, RetryableTraceDispatchError):
                assert error.value.acceptance_unknown is (expected is TraceExportUncertainError)
        assert len(sent) == 1  # No SDK retry, per-span request, batching thread or silent queue success.
        _, options, payload = sent[0]
        assert options["max_retries"] == 0
        assert options["follow_redirects"] is False
        assert options["headers"] == {"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf"}
        resource = payload.resource_spans[0]
        attributes = {item.key: item.value for item in resource.resource.attributes}
        assert attributes["service.name"].string_value == "owned-service"
        spans = list(resource.scope_spans[0].spans)
        assert len(spans) == 4
        assert [s.name for s in spans] == ["workflow", "Start", "LLM", "End"]
        root_id = convert_to_span_id(RUN_ID, "workflow").to_bytes(8)
        assert [s.span_id for s in spans] == [root_id, *[convert_to_span_id(i, "node").to_bytes(8) for i in NODE_IDS]]
        assert all(s.trace_id == UUID(RUN_ID).bytes for s in spans)
        assert [s.parent_span_id for s in spans] == [b"", root_id, root_id, root_id]
        assert spans[0].start_time_unix_nano == int(_LEGACY_ALIYUN_TRANSPORT_START.timestamp() * 1_000_000_000)
        assert spans[0].end_time_unix_nano == int(
            (_LEGACY_ALIYUN_TRANSPORT_START + timedelta(seconds=1)).timestamp() * 1_000_000_000
        )
        model_attributes = {item.key: item.value for item in spans[2].attributes}
        assert model_attributes[GEN_AI_USAGE_TOTAL_TOKENS].string_value == "32"
        assert all(s.status.code == 1 for s in spans)
        assert adapter.trace_client._dispatch_spans.get() is None
        assert info.workflow_run_status == "succeeded"
        sqlite_session.refresh(run)
        assert run.status == WorkflowExecutionStatus.SUCCEEDED
        assert run.total_tokens == 32
        assert all(node.status == WorkflowNodeExecutionStatus.SUCCEEDED for node in nodes)
        # A fresh business operation does not inherit any old batch after success or error.
        adapter.trace(ModerationTraceInfo(flagged=False, action="allow", preset_response="", query="", metadata={}))
        assert len(sent) == 1
        adapter.trace(info.model_copy(update={"workflow_run_id": "a0000000-0000-4000-8000-000000000003"}))
        assert len(sent) == 2
        recovered_spans = list(sent[1][2].resource_spans[0].scope_spans[0].spans)
        assert [s.name for s in recovered_spans] == ["workflow"]

    @staticmethod
    @pytest.mark.parametrize("failed", [False, True])
    def test_message_mapping_keeps_original_ids_raw_usage_error_and_business_state(
        sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, failed: bool
    ) -> None:
        message = make_message(
            message_id=MESSAGE_ID,
            app_id="app",
            conversation_id="conversation",
            query="hello",
            answer="ok",
            status=MessageStatus.ERROR if failed else MessageStatus.NORMAL,
            inputs={},
            message={},
            message_unit_price=Decimal(0),
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id="owner",
            message_tokens=21,
            answer_tokens=11,
        )
        sqlite_session.add(message)
        sqlite_session.commit()
        info = MessageTraceInfo(
            conversation_model="chat",
            conversation_mode="chat",
            message_id=MESSAGE_ID,
            message_data=message,
            inputs={"prompt": "hello"},
            outputs="ok",
            message_tokens=21,
            answer_tokens=11,
            total_tokens=32,
            error="synthetic model failure" if failed else None,
            metadata={
                "app_id": "app",
                "conversation_id": "conversation",
                "ls_model_name": "test-model",
                "ls_provider": "test",
            },
            start_time=_LEGACY_ALIYUN_TRANSPORT_START,
            end_time=_LEGACY_ALIYUN_TRANSPORT_START + timedelta(seconds=1),
        )
        sent: list[ExportTraceServiceRequest] = []

        def send(_method: str, _url: str, **options: Unpack[_LegacyAliyunTransportRequestoptions]) -> httpx.Response:
            sent.append(decoded(options))
            return httpx.Response(200, content=b"")

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        adapter = AliyunDataTrace(_legacy_aliyun_transport_config())
        adapter.trace(info)
        assert len(sent) == 1
        spans = list(sent[0].resource_spans[0].scope_spans[0].spans)
        assert [s.name for s in spans] == ["message", "llm"]
        root_id = convert_to_span_id(MESSAGE_ID, "message").to_bytes(8)
        assert [s.parent_span_id for s in spans] == [b"", root_id]
        assert [s.span_id for s in spans] == [root_id, convert_to_span_id(MESSAGE_ID, "llm").to_bytes(8)]
        assert all(s.trace_id == UUID(MESSAGE_ID).bytes and s.status.code == (2 if failed else 1) for s in spans)
        assert {a.key: a.value for a in spans[1].attributes}[GEN_AI_USAGE_TOTAL_TOKENS].string_value == "32"
        assert message.status == (MessageStatus.ERROR if failed else MessageStatus.NORMAL)

    @staticmethod
    def test_one_cached_client_keeps_interleaved_batches_and_failure_cleanup_isolated(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        client = TraceClient(service_name="owned-service", endpoint="https://collector.test/adapt_key/api/otlp/traces")
        barrier = Barrier(2)
        observed: list[list[str]] = []

        def send(_method: str, _url: str, **options: Unpack[_LegacyAliyunTransportRequestoptions]) -> httpx.Response:
            payload = decoded(options)
            observed.append([s.name for rs in payload.resource_spans for scope in rs.scope_spans for s in scope.spans])
            return httpx.Response(200, content=b"")

        monkeypatch.setattr(ssrf_proxy, "make_request", send)

        def run(label: str) -> None:
            try:
                with client.batch():
                    client.add_span(SpanData(name=label, trace_id=1, span_id=2, start_time=1, end_time=2))
                    barrier.wait(timeout=5)
                    if label == "failed":
                        raise ValueError("mapper failed before submission")
                    client.add_span(SpanData(name=label + "-child", trace_id=1, span_id=3, start_time=1, end_time=2))
            except ValueError:
                assert label == "failed"
            assert client._dispatch_spans.get() is None

        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(run, ["accepted", "failed"]))
        assert observed == [["accepted", "accepted-child"]]
        with client.batch():
            client.add_span(SpanData(name="next", trace_id=1, span_id=4, start_time=1, end_time=2))
        assert observed == [["accepted", "accepted-child"], ["next"]]


"""Real Weave SDK serialization with only the outbound HTTP boundary replaced."""


_LEGACY_WEAVE_TRANSPORT_START = datetime(2026, 10, 19, tzinfo=UTC)


class _LegacyWeaveTransportRequestoptions(TypedDict, total=False):
    content: bytes
    json: dict[str, object]
    auth: tuple[str, str]
    headers: Mapping[str, str]
    max_retries: int
    follow_redirects: bool
    timeout: float


def _legacy_weave_transport_config(**overrides: object) -> WeaveConfig:
    return WeaveConfig.model_validate({"api_key": "fixture-key", "entity": "team", "project": "project", **overrides})


def call(call_id: str = "call-1", **overrides: object) -> WeaveTraceModel:
    return WeaveTraceModel.model_validate(
        {
            "id": call_id,
            "op": "tool",
            "inputs": {"synthetic": True},
            "outputs": {"result": "ok"},
            "attributes": {
                "trace_id": call_id,
                "start_time": _LEGACY_WEAVE_TRANSPORT_START,
                "end_time": _LEGACY_WEAVE_TRANSPORT_START + timedelta(seconds=1),
            },
            **overrides,
        }
    )


def response(url: str, body: object, *, status: int = 200) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("POST", url), json=body)


class TestLegacyWeaveTransportCases:
    @staticmethod
    @pytest.fixture
    def wire(
        monkeypatch: pytest.MonkeyPatch, failure: tuple[str, str, int | str] | None
    ) -> list[tuple[str, _LegacyWeaveTransportRequestoptions, dict[str, object]]]:
        sent: list[tuple[str, _LegacyWeaveTransportRequestoptions, dict[str, object]]] = []
        fault_pending = True

        def send(method: str, url: str, **options: Unpack[_LegacyWeaveTransportRequestoptions]) -> httpx.Response:
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

    @staticmethod
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
        original = _legacy_weave_transport_config(entity=None)
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

    @staticmethod
    @pytest.mark.usefixtures("agent_runtime_app")
    @pytest.mark.parametrize(
        "failure",
        [None]
        + [
            (stage, call_id, status)
            for stage, call_id in [
                ("start", "legacy-run"),
                ("end", "legacy-run"),
                ("start", "node-0"),
                ("end", "node-0"),
            ]
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
        wire: list[tuple[str, _LegacyWeaveTransportRequestoptions, dict[str, object]]],
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
                created_at=_LEGACY_WEAVE_TRANSPORT_START + timedelta(milliseconds=i),
                finished_at=_LEGACY_WEAVE_TRANSPORT_START + timedelta(milliseconds=i + 100),
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
        adapter = WeaveDataTrace(_legacy_weave_transport_config())
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
            start_time=_LEGACY_WEAVE_TRANSPORT_START,
            end_time=_LEGACY_WEAVE_TRANSPORT_START + timedelta(seconds=1),
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
                    start_time=_LEGACY_WEAVE_TRANSPORT_START,
                    end_time=_LEGACY_WEAVE_TRANSPORT_START + timedelta(seconds=1),
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

    @staticmethod
    def test_interleaved_instances_resolve_only_their_own_credentials_and_targets(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        barrier = Barrier(2)
        observed: list[tuple[str, tuple[str, str], str]] = []
        monkeypatch.setenv("WANDB_API_KEY", "ambient-key")
        monkeypatch.setenv("WANDB_ENTITY", "ambient-entity")
        monkeypatch.setenv("WANDB_PROJECT", "ambient-project")
        before = dict(os.environ)

        def send(_method: str, url: str, **options: Unpack[_LegacyWeaveTransportRequestoptions]) -> httpx.Response:
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
                _legacy_weave_transport_config(
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

    @staticmethod
    def test_concurrent_dispatches_on_one_cached_instance_keep_prefix_state_isolated(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        barrier = Barrier(2)

        def send(_method: str, url: str, **options: Unpack[_LegacyWeaveTransportRequestoptions]) -> httpx.Response:
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
        adapter = WeaveDataTrace(_legacy_weave_transport_config())

        def run(label: str) -> RetryableTraceDispatchError:
            info = GenerateNameTraceInfo(
                tenant_id="tenant",
                inputs={"label": label},
                outputs={"label": label},
                metadata={},
                start_time=_LEGACY_WEAVE_TRANSPORT_START,
                end_time=_LEGACY_WEAVE_TRANSPORT_START + timedelta(seconds=1),
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

    @staticmethod
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

        def send(_method: str, url: str, **options: Unpack[_LegacyWeaveTransportRequestoptions]) -> httpx.Response:
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
        adapter = WeaveDataTrace(_legacy_weave_transport_config())
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

    @staticmethod
    def test_legacy_api_check_uses_read_only_project_and_stats_requests(monkeypatch: pytest.MonkeyPatch) -> None:
        sent = []

        def post(url: str, **options: Unpack[_LegacyWeaveTransportRequestoptions]) -> httpx.Response:
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
        adapter = WeaveDataTrace(_legacy_weave_transport_config())
        assert sent == []
        assert adapter.api_check()
        assert sent == ["https://api.wandb.ai/graphql", "https://trace.wandb.ai/calls/query_stats"]
        assert adapter.calls == {}

    @staticmethod
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

        def send(_method: str, url: str, **options: Unpack[_LegacyWeaveTransportRequestoptions]) -> httpx.Response:
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
        adapter = WeaveDataTrace(_legacy_weave_transport_config())
        data = call(sent_id)
        adapter.start_call(data)
        assert adapter.calls[sent_id]["trace_id"] == sent_id
        adapter.finish_call(data)
        assert len(sent) == 2
        assert adapter.calls == {}

    @staticmethod
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

        def send(_method: str, url: str, **options: Unpack[_LegacyWeaveTransportRequestoptions]) -> httpx.Response:
            start = CallStartReq.model_validate_json(options["content"]).start
            sent.append(start)
            ack = {"id": start.id, "trace_id": start.trace_id}
            ack[field] = wrong_ack
            return response(url, ack)

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        adapter = WeaveDataTrace(_legacy_weave_transport_config())
        with pytest.raises(TraceExportUncertainError, match="did not acknowledge the submitted identifiers"):
            adapter.start_call(call(sent_id))
        assert len(sent) == 1
        assert adapter.calls == {}


"""Real SDK schema/serialization boundaries with HTTP transport substituted.

These tests do not claim acceptance by a live third-party account.
"""


class TransportOptions(TypedDict, total=False):
    content: bytes | str
    headers: Mapping[str, str]
    auth: tuple[str, str]
    max_retries: int


def _response(url: str, *, body: object = None, content: bytes | None = None, status: int = 200) -> httpx.Response:
    request = httpx.Request("POST", url)
    if content is not None:
        return httpx.Response(status, request=request, content=content)
    return httpx.Response(status, request=request, json=body or {})


def _tool_definitions() -> list[dict[str, object]]:
    return [
        {
            "type": "function",
            "name": "calculate",
            "description": "TOOL_CONTENT_CANARY",
            "parameters": {
                "type": "object",
                "properties": {"value": {"type": "integer"}},
                "required": ["value"],
                "additionalProperties": False,
                "$comment": "Preserve schema extension fields",
            },
            "strict": True,
        },
        {"type": "function", "function": {"name": "already_nested", "description": "Nested definition"}},
    ]


class TestNativeWeaveMlflowCases:
    @staticmethod
    @pytest.fixture
    def trace() -> CanonicalTrace:
        start = datetime(2026, 1, 1, tzinfo=UTC)
        root = CanonicalSpan(
            id="0000000000000001",
            parent_id=None,
            name="Agent",
            kind=CanonicalSpanKind.AGENT,
            start_time=start,
            end_time=start + timedelta(seconds=2),
            inputs={"query": "hello"},
            outputs="answer",
            status=CanonicalSpanStatus.OK,
            metadata={"total_price": 999, "total_tokens": 999},
        )
        child = CanonicalSpan(
            id="0000000000000002",
            parent_id=root.id,
            name="Model",
            kind=CanonicalSpanKind.LLM,
            start_time=start,
            end_time=start + timedelta(seconds=1),
            inputs={"prompt": "hello"},
            outputs="answer",
            status=CanonicalSpanStatus.OK,
            metadata={
                "model_name": "test-model",
                "prompt_tokens": 2,
                "completion_tokens": 3,
                "total_tokens": 5,
                "total_price": "0.01",
                "currency": "USD",
            },
        )
        return CanonicalTrace(
            trace_id="1234567890abcdef1234567890abcdef",
            session_id="session-1",
            root_span_id=root.id,
            spans=(root, child),
        )

    @staticmethod
    @pytest.fixture
    def weave_started_calls(monkeypatch: pytest.MonkeyPatch) -> list[StartedCallSchemaForInsert]:
        starts: list[StartedCallSchemaForInsert] = []

        def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
            body = json.loads(kwargs["content"])
            if start := body.get("start"):
                started = StartedCallSchemaForInsert.model_validate(start)
                starts.append(started)
                return _response(url, body={"id": started.id, "trace_id": started.trace_id})
            return _response(url)

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        return starts

    @staticmethod
    @pytest.mark.parametrize("host", ["https://api.wandb.ai", "https://API.WANDB.AI:443"])
    def test_weave_sdk_exports_tree_session_usage_without_global_credentials(
        monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace, host: str
    ) -> None:
        calls = []
        before = dict(os.environ)

        def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
            body = json.loads(kwargs["content"])
            calls.append((_method, url, kwargs, body))
            start = body.get("start")
            return _response(url, body={"id": start["id"], "trace_id": start["trace_id"]} if start else {})

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        result = export_trace(
            "weave", {"api_key": "tenant-key", "entity": "team", "project": "demo", "host": host}, trace
        )
        assert len(calls) == 4
        root, child = calls[0][3]["start"], calls[1][3]["start"]
        assert child["parent_id"] == root["id"]
        assert child["thread_id"] == root["thread_id"] == "session-1"
        assert child["turn_id"] == root["turn_id"] == root["id"]
        assert calls[2][3]["end"]["summary"]["usage"]["test-model"]["total_tokens"] == 5
        assert calls[3][3]["end"]["summary"] == {}
        assert result.trace_url == f"https://wandb.ai/team/demo/r/call/{root['id']}"
        assert result.span_urls[trace.spans[1].id].endswith(child["id"])
        assert all(call[2]["auth"] == ("api", "tenant-key") and call[2]["max_retries"] == 0 for call in calls)
        assert dict(os.environ) == before

    @staticmethod
    @pytest.mark.parametrize("root_kind", [CanonicalSpanKind.CHAIN, CanonicalSpanKind.AGENT])
    def test_weave_nested_agent_calls_form_one_outer_turn(
        trace: CanonicalTrace, weave_started_calls: list[StartedCallSchemaForInsert], root_kind: CanonicalSpanKind
    ) -> None:
        root = trace.spans[0].model_copy(update={"kind": root_kind})
        agent = trace.spans[1].model_copy(update={"kind": CanonicalSpanKind.AGENT})
        model = trace.spans[1].model_copy(update={"id": "0000000000000003", "parent_id": agent.id})
        nested = trace.model_copy(update={"spans": (root, agent, model)})

        export_trace("weave", {"api_key": "tenant-key", "entity": "team", "project": "demo"}, nested)

        outer, inner_agent, inner_model = weave_started_calls
        assert inner_agent.parent_id == outer.id
        assert inner_model.parent_id == inner_agent.id
        assert all(call.thread_id == trace.session_id and call.turn_id == outer.id for call in weave_started_calls)
        # Native Threads queries count only call.id == call.turn_id, including for
        # Workflow and single-step preview outer roots with nested Agent details.
        assert [call.id for call in weave_started_calls if call.id == call.turn_id] == [outer.id]

    @staticmethod
    def test_weave_same_session_has_distinct_stable_turns(
        trace: CanonicalTrace, weave_started_calls: list[StartedCallSchemaForInsert]
    ) -> None:
        config = {"api_key": "tenant-key", "entity": "team", "project": "demo"}
        first = export_trace("weave", config, trace)
        repeated = export_trace("weave", config, trace)
        next_trace = trace.model_copy(update={"trace_id": "abcdef1234567890abcdef1234567890"})
        second = export_trace("weave", config, next_trace)

        first_calls, repeated_calls, second_calls = (
            weave_started_calls[:2],
            weave_started_calls[2:4],
            weave_started_calls[4:],
        )
        assert repeated_calls == first_calls
        assert repeated == first
        assert second.trace_url != first.trace_url
        assert all(call.thread_id == trace.session_id for call in weave_started_calls)
        assert first_calls[0].turn_id == first_calls[0].id
        assert second_calls[0].turn_id == second_calls[0].id
        assert second_calls[0].turn_id != first_calls[0].turn_id
        assert all(call.turn_id == first_calls[0].id for call in first_calls)
        assert all(call.turn_id == second_calls[0].id for call in second_calls)

    @staticmethod
    def test_weave_without_session_does_not_fabricate_a_thread_or_turn(
        trace: CanonicalTrace, weave_started_calls: list[StartedCallSchemaForInsert]
    ) -> None:
        trace = trace.model_copy(update={"session_id": ""})

        export_trace("weave", {"api_key": "tenant-key", "entity": "team", "project": "demo"}, trace)

        assert len(weave_started_calls) == len(trace.spans)
        assert all(call.thread_id is None and call.turn_id is None for call in weave_started_calls)

    @staticmethod
    def test_weave_resolves_optional_entity_using_only_supplied_credentials(
        monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace
    ) -> None:
        def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
            assert kwargs["auth"] == ("api", "tenant-key")
            if url.endswith("/graphql"):
                return _response(url, body={"data": {"viewer": {"entity": "default-team"}}})
            body = json.loads(kwargs["content"])
            if start := body.get("start"):
                assert start["project_id"] == "default-team/demo"
                return _response(url, body={"id": start["id"], "trace_id": start["trace_id"]})
            return _response(url)

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        result = export_trace("weave", {"api_key": "tenant-key", "project": "demo"}, trace)
        assert result.trace_url is not None
        assert "/default-team/demo/" in result.trace_url

    @staticmethod
    def test_weave_partial_tree_is_uncertain_and_not_retried(
        monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace
    ) -> None:
        calls = []

        def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
            calls.append(url)
            if len(calls) > 1:
                return _response(url, status=503)
            start = json.loads(kwargs["content"])["start"]
            return _response(url, body={"id": start["id"], "trace_id": start["trace_id"]})

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        with pytest.raises(TraceExportUncertainError, match="partially accepted"):
            export_trace("weave", {"api_key": "secret", "entity": "team", "project": "demo"}, trace)
        assert len(calls) == 2

    @staticmethod
    @pytest.mark.parametrize("tracking_uri", ["https://mlflow.example", "https://mlflow.example/proxy/mlflow"])
    def test_mlflow_sdk_span_roundtrip_and_credential_isolation(
        monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace, tracking_uri: str
    ) -> None:
        calls = []
        before = dict(os.environ)

        def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
            calls.append((url, kwargs))
            return _response(url, content=b"")

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        for username in ("tenant-a", "tenant-b"):
            result = export_trace(
                "mlflow",
                {
                    "tracking_uri": tracking_uri,
                    "experiment_id": "42",
                    "username": username,
                    "password": "password",
                },
                trace,
            )
            assert result.trace_id == "tr-" + trace.trace_id
            assert result.trace_url is not None
            fragment_path, _, query = urlsplit(result.trace_url).fragment.partition("?")
            assert result.trace_url.startswith(tracking_uri + "/#/")
            assert fragment_path == "/experiments/42/traces"
            assert parse_qs(query) == {
                "traceId": [result.trace_id],
                "selectedTraceId": [result.trace_id],
                "selectedEvaluationId": [result.trace_id],
            }
        for index, (url, options) in enumerate(calls):
            assert url == tracking_uri + "/v1/traces"
            assert options["headers"]["x-mlflow-experiment-id"] == "42"
            assert (
                options["headers"]["Authorization"]
                == "Basic " + base64.b64encode(f"tenant-{'a' if index == 0 else 'b'}:password".encode()).decode()
            )
            content = options["content"]
            assert isinstance(content, bytes)
            payload = ExportTraceServiceRequest.FromString(content)
            spans = [
                _native_weave_mlflow_Span.from_otel_proto(span)
                for span in payload.resource_spans[0].scope_spans[0].spans
            ]
            assert spans[1].parent_id == spans[0].span_id
            assert spans[1].get_attribute(SpanAttributeKey.CHAT_USAGE) == {
                "input_tokens": 2,
                "output_tokens": 3,
                "total_tokens": 5,
            }
            assert spans[1].get_attribute(SpanAttributeKey.LLM_COST) == {"total_cost": 0.01}
            assert spans[0].get_attribute(SpanAttributeKey.CHAT_USAGE) is None
            assert spans[0].get_attribute(SpanAttributeKey.SESSION_ID) == "session-1"
        assert dict(os.environ) == before

    @staticmethod
    @pytest.mark.parametrize("serialized", [False, True])
    def test_mlflow_tool_definitions_have_native_chat_schema_without_losing_source(
        monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace, serialized: bool
    ) -> None:
        definitions = _tool_definitions()
        source = json.dumps(definitions) if serialized else definitions
        trace.spans[1].metadata["gen_ai.tool.definitions"] = source
        before = deepcopy(trace.model_dump())
        native: list[_native_weave_mlflow_Span] = []

        def send(_method: str, url: str, **options: Unpack[TransportOptions]) -> httpx.Response:
            content = options["content"]
            assert isinstance(content, bytes)
            payload = ExportTraceServiceRequest.FromString(content)
            native.extend(
                _native_weave_mlflow_Span.from_otel_proto(item)
                for item in payload.resource_spans[0].scope_spans[0].spans
            )
            return _response(url, content=b"")

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        export_trace("mlflow", {"tracking_uri": "https://mlflow.example", "experiment_id": "42"}, trace)
        tools = native[1].get_attribute(SpanAttributeKey.CHAT_TOOLS)
        assert tools == [
            {"type": "function", "function": {key: value for key, value in definitions[0].items() if key != "type"}},
            definitions[1],
        ]
        assert isinstance(tools, list)
        for tool in tools:
            ChatTool.model_validate(tool, strict=True)
        assert native[1].get_attribute("gen_ai.tool.definitions") == source
        stored = translate_span_when_storing(native[1])
        assert json.loads(stored["attributes"][SpanAttributeKey.CHAT_TOOLS]) == tools
        assert trace.model_dump() == before

    @staticmethod
    def test_mlflow_redacted_trace_does_not_recreate_tool_definition_content(
        monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace
    ) -> None:
        trace.spans[1].metadata["gen_ai.tool.definitions"] = _tool_definitions()
        trace.spans[1].metadata[SpanAttributeKey.CHAT_TOOLS] = [
            {"type": "function", "function": {"name": "TOOL_CONTENT_CANARY"}}
        ]
        redacted = remap_outer_trace(trace, trace_id=trace.trace_id, capture_content=False, agent_message=False)
        native: list[_native_weave_mlflow_Span] = []

        def send(_method: str, url: str, **options: Unpack[TransportOptions]) -> httpx.Response:
            content = options["content"]
            assert isinstance(content, bytes)
            assert b"TOOL_CONTENT_CANARY" not in content
            payload = ExportTraceServiceRequest.FromString(content)
            native.extend(
                _native_weave_mlflow_Span.from_otel_proto(item)
                for item in payload.resource_spans[0].scope_spans[0].spans
            )
            return _response(url, content=b"")

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        export_trace("mlflow", {"tracking_uri": "https://mlflow.example", "experiment_id": "42"}, redacted)
        for span in native:
            assert span.get_attribute(SpanAttributeKey.CHAT_TOOLS) is None
            assert span.get_attribute("gen_ai.tool.definitions") is None
            assert span.inputs is None
            assert span.outputs is None

    @staticmethod
    @pytest.mark.parametrize("definitions", [[None, 12, {"type": "other"}, {"type": "function"}], "invalid-json"])
    def test_mlflow_unsupported_tool_shapes_remain_in_metadata_without_fake_functions(
        trace: CanonicalTrace, definitions: object
    ) -> None:
        from dify_trace_mlflow.agent_trace import _spans

        trace.spans[1].metadata["gen_ai.tool.definitions"] = definitions
        before = deepcopy(trace.model_dump())
        result = _spans(trace, "42", "tr-" + trace.trace_id)
        assert result[1].get_attribute("gen_ai.tool.definitions") == definitions
        assert result[1].get_attribute(SpanAttributeKey.CHAT_TOOLS) == ([] if isinstance(definitions, list) else None)
        assert trace.model_dump() == before

    @staticmethod
    def test_mlflow_existing_native_chat_tools_take_precedence(trace: CanonicalTrace) -> None:
        from dify_trace_mlflow.agent_trace import _spans

        native_tools = [{"type": "function", "function": {"name": "already_native"}}]
        trace.spans[1].metadata[SpanAttributeKey.CHAT_TOOLS] = native_tools
        trace.spans[1].metadata["gen_ai.tool.definitions"] = _tool_definitions()
        result = _spans(trace, "42", "tr-" + trace.trace_id)
        assert result[1].get_attribute(SpanAttributeKey.CHAT_TOOLS) == native_tools

    @staticmethod
    def test_mlflow_preserves_json_schema_beyond_the_sdk_chat_tool_model(trace: CanonicalTrace) -> None:
        from dify_trace_mlflow.agent_trace import _spans

        parameters = {
            "$ref": "#/$defs/Arguments",
            "$defs": {
                "Arguments": {
                    "type": "object",
                    "properties": {"choice": {"enum": [None, {"mode": "auto"}]}},
                    "additionalProperties": {"type": "string"},
                }
            },
        }
        source = [{"type": "function", "name": "schema_extension", "parameters": parameters}]
        trace.spans[1].metadata["gen_ai.tool.definitions"] = source
        result = _spans(trace, "42", "tr-" + trace.trace_id)
        expected = [{"type": "function", "function": {"name": "schema_extension", "parameters": parameters}}]
        assert result[1].get_attribute(SpanAttributeKey.CHAT_TOOLS) == expected
        assert result[1].get_attribute("gen_ai.tool.definitions") == source
        stored = translate_span_when_storing(result[1])
        assert json.loads(stored["attributes"][SpanAttributeKey.CHAT_TOOLS]) == expected

    @staticmethod
    def test_mlflow_partial_otlp_ack_is_uncertain(monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace) -> None:
        ack = ExportTraceServiceResponse()
        ack.partial_success.rejected_spans = 1
        monkeypatch.setattr(
            ssrf_proxy, "make_request", lambda _method, url, **_kwargs: _response(url, content=ack.SerializeToString())
        )
        with pytest.raises(TraceExportUncertainError, match="partially accepted"):
            export_trace("mlflow", {"tracking_uri": "https://mlflow.example", "experiment_id": "42"}, trace)

    @staticmethod
    @pytest.mark.parametrize(
        "credential_type", ["AWS_PRESIGNED_URL", "GCP_SIGNED_URL", "AZURE_SAS_URI", "AZURE_ADLS_GEN2_SAS_URI"]
    )
    @pytest.mark.parametrize("oauth", [False, True])
    def test_databricks_sdk_v3_metadata_and_native_artifact(
        monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace, credential_type: str, oauth: bool
    ) -> None:
        calls: list[tuple[str, str, TransportOptions]] = []
        uploaded: list[TraceData] = []
        before = dict(os.environ)
        server_trace_id = "tr-abcdef0123456789abcdef0123456789"
        definitions = _tool_definitions()
        trace.spans[1].metadata["gen_ai.tool.definitions"] = definitions

        def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
            calls.append((_method, url, kwargs))
            if url.endswith("/oidc/v1/token"):
                assert kwargs["auth"] == ("client", "client-secret")
                return _response(url, body={"access_token": "oauth-token"})
            if url.endswith("/api/3.0/mlflow/traces"):
                assert kwargs["headers"]["Authorization"] == ("Bearer oauth-token" if oauth else "Bearer pat-token")
                body = json.loads(kwargs["content"])
                assert body["trace"]["trace_info"]["trace_metadata"]["mlflow.trace.session"] == "session-1"
                body["trace"]["trace_info"]["trace_id"] = server_trace_id
                return _response(url, body=body)
            if url.endswith("/credentials-for-data-upload"):
                assert f"/traces/{server_trace_id}/" in url
                return _response(
                    url,
                    body={
                        "credential_info": {
                            "signed_uri": "https://storage.example/trace?sig=fake",
                            "type": credential_type,
                            "headers": [],
                        }
                    },
                )
            assert "Authorization" not in kwargs["headers"]
            if kwargs.get("content"):
                uploaded.append(TraceData.from_dict(json.loads(kwargs["content"])))
            return _response(url)

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        config = {"host": "https://databricks.example", "experiment_id": "42"}
        config.update(
            {"client_id": "client", "client_secret": "client-secret"}
            if oauth
            else {"personal_access_token": "pat-token"}
        )
        result = export_trace("databricks", config, trace)
        assert result.trace_id == server_trace_id
        assert result.trace_url == (
            f"https://databricks.example/ml/experiments/42/traces?selectedEvaluationId={server_trace_id}"
        )
        data = uploaded[0]
        assert len(data.spans) == 2
        assert all(span.trace_id == server_trace_id for span in data.spans)
        assert data.spans[1].parent_id == data.spans[0].span_id
        usage = data.spans[1].get_attribute(SpanAttributeKey.CHAT_USAGE)
        assert usage is not None
        assert usage["total_tokens"] == 5
        assert data.spans[1].get_attribute(SpanAttributeKey.LLM_COST) == {"total_cost": 0.01}
        tools = data.spans[1].get_attribute(SpanAttributeKey.CHAT_TOOLS)
        assert isinstance(tools, list)
        assert len(tools) == 2
        for tool in tools:
            ChatTool.model_validate(tool, strict=True)
        assert data.spans[1].get_attribute("gen_ai.tool.definitions") == definitions
        assert dict(os.environ) == before
        assert len(calls) == 3 + int(oauth) + int(credential_type == "AZURE_ADLS_GEN2_SAS_URI")

    @staticmethod
    def test_databricks_partial_metadata_delivery_is_uncertain(
        monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace
    ) -> None:
        def send(_method: str, url: str, **kwargs: Unpack[TransportOptions]) -> httpx.Response:
            if url.endswith("/api/3.0/mlflow/traces"):
                return _response(url, body=json.loads(kwargs["content"]))
            return _response(url, status=503)

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        with pytest.raises(TraceExportUncertainError, match="metadata"):
            export_trace(
                "databricks",
                {"host": "https://databricks.example", "experiment_id": "42", "personal_access_token": "secret"},
                trace,
            )

    @staticmethod
    @pytest.mark.parametrize("provider", ["weave", "databricks"])
    def test_success_status_with_unreadable_ack_is_uncertain(
        monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace, provider: str
    ) -> None:
        monkeypatch.setattr(
            ssrf_proxy, "make_request", lambda _method, url, **_kwargs: _response(url, content=b"not-json")
        )
        config = {
            "api_key": "secret",
            "entity": "team",
            "project": "demo",
            "host": "https://example.com",
            "experiment_id": "42",
            "personal_access_token": "secret",
        }
        with pytest.raises(TraceExportUncertainError, match="unreadable"):
            export_trace(provider, config, trace)


"""Exercise anonymous Phoenix auth at the HTTP/1.1 and legacy SDK boundaries."""


class TestPhoenixExportAuthCases:
    @staticmethod
    @pytest.fixture
    def trace() -> CanonicalTrace:
        start = datetime(2026, 10, 20, tzinfo=UTC)
        return CanonicalTrace(
            trace_id="1" * 32,
            session_id="phoenix-auth-session",
            root_span_id="2" * 16,
            spans=(
                CanonicalSpan(
                    id="2" * 16,
                    parent_id=None,
                    name="Phoenix auth regression",
                    kind=CanonicalSpanKind.AGENT,
                    start_time=start,
                    end_time=start + timedelta(seconds=1),
                    status=CanonicalSpanStatus.OK,
                ),
            ),
        )

    @staticmethod
    @pytest.fixture
    def http11_wire(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[bytes]]:
        """Keep real HTTPX/httpcore/h11 serialization, replacing only socket I/O."""
        chunks: list[bytes] = []

        def write(_stream: httpcore.MockStream, buffer: bytes, timeout: float | None = None) -> None:
            del timeout
            chunks.append(buffer)

        monkeypatch.setattr(httpcore.MockStream, "write", write)
        transport = httpx.HTTPTransport()
        transport.close()
        transport._pool = httpcore.ConnectionPool(
            network_backend=httpcore.MockBackend([b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"])
        )
        with httpx.Client(transport=transport, trust_env=False) as client:
            monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _verify: client)
            yield chunks

    @staticmethod
    def test_managed_exports_serialize_optional_auth_without_cross_destination_credentials(
        monkeypatch: pytest.MonkeyPatch, trace: CanonicalTrace, http11_wire: list[bytes]
    ) -> None:
        monkeypatch.setenv(
            "OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer%20ambient-general,api_key=ambient-general"
        )
        monkeypatch.setenv(
            "OTEL_EXPORTER_OTLP_TRACES_HEADERS", "authorization=Bearer%20ambient-traces,api_key=ambient-traces"
        )

        for index, key in enumerate(("first-synthetic-key", "", None, "second-synthetic-key", None, "")):
            previous_chunks = len(http11_wire)
            result = export_trace(
                "phoenix",
                {"endpoint": "http://phoenix.test/proxy", "api_key": key, "project": f"project-{index}"},
                trace,
            )
            assert result.status == "accepted"
            assert result.trace_id == trace.trace_id
            head, separator, body = b"".join(http11_wire[previous_chunks:]).partition(b"\r\n\r\n")
            assert separator
            lines = head.split(b"\r\n")
            assert lines[0] == b"POST /proxy/v1/traces HTTP/1.1"
            header_values: list[tuple[bytes, bytes]] = []
            for line in lines[1:]:
                name, value = line.split(b": ", 1)
                header_values.append((name, value))
            headers = httpx.Headers(header_values)
            assert headers["Content-Type"] == "application/x-protobuf"
            if key:
                assert headers["api_key"] == key
                assert headers["authorization"] == f"Bearer {key}"
            else:
                assert "api_key" not in headers
                assert "authorization" not in headers
            payload = ExportTraceServiceRequest.FromString(body)
            resource = payload.resource_spans[0]
            assert {item.key: item.value.string_value for item in resource.resource.attributes}[
                "openinference.project.name"
            ] == f"project-{index}"
            assert resource.scope_spans[0].spans[0].trace_id.hex() == trace.trace_id

    @staticmethod
    def test_legacy_sdk_prepares_anonymous_requests_without_ambient_or_previous_auth(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv(
            "OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer%20ambient-general,api_key=ambient-general"
        )
        monkeypatch.setenv(
            "OTEL_EXPORTER_OTLP_TRACES_HEADERS", "authorization=Bearer%20ambient-traces,api_key=ambient-traces"
        )
        monkeypatch.delenv("OTEL_EXPORTER_OTLP_COMPRESSION", raising=False)
        monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_COMPRESSION", raising=False)
        prepared: list[requests.PreparedRequest] = []

        def send(_session: requests.Session, request: requests.PreparedRequest, **_kwargs: object) -> requests.Response:
            prepared.append(request)
            response = requests.Response()
            response.status_code = 200
            response._content = b""
            response.request = request
            return response

        monkeypatch.setattr(requests.Session, "send", send)
        for index, key in enumerate(("first-synthetic-key", "", None, "second-synthetic-key", None, "")):
            tracer, processor = setup_tracer(
                PhoenixConfig(endpoint="http://phoenix.test/proxy", api_key=key, project=f"project-{index}")
            )
            try:
                tracer.start_span("Legacy Phoenix auth regression").end()
            finally:
                processor.shutdown()
            assert len(prepared) == index + 1
            request = prepared[-1]
            assert request.method == "POST"
            assert request.url == "http://phoenix.test/proxy/v1/traces"
            assert request.headers["Content-Type"] == "application/x-protobuf"
            if key:
                assert request.headers["api_key"] == key
                assert request.headers["authorization"] == f"Bearer {key}"
            else:
                assert "api_key" not in request.headers
                assert "authorization" not in request.headers
            assert isinstance(request.body, bytes)
            payload = ExportTraceServiceRequest.FromString(request.body)
            assert {item.key: item.value.string_value for item in payload.resource_spans[0].resource.attributes}[
                "openinference.project.name"
            ] == f"project-{index}"


"""Exercise real vendor serializers and OTLP stubs at their network boundary."""


class HTTPArguments(TypedDict):
    content: bytes
    headers: Mapping[str, str]
    max_retries: NotRequired[int]
    follow_redirects: NotRequired[bool]


type HTTPCall = tuple[str, str, HTTPArguments]


def spans_from_call(call: HTTPCall) -> list[_provider_dispatch_Span]:
    request = ExportTraceServiceRequest.FromString(call[2]["content"])
    return list(request.resource_spans[0].scope_spans[0].spans)


def attributes(span: _provider_dispatch_Span) -> dict[str, object]:
    result: dict[str, object] = {}
    for item in span.attributes:
        kind = item.value.WhichOneof("value")
        assert kind is not None
        result[item.key] = {
            "string_value": item.value.string_value,
            "bool_value": item.value.bool_value,
            "int_value": item.value.int_value,
            "double_value": item.value.double_value,
            "array_value": item.value.array_value,
            "kvlist_value": item.value.kvlist_value,
            "bytes_value": item.value.bytes_value,
        }[kind]
    return result


def _langfuse_queue_job_ack() -> dict[str, object]:
    # Synthetic values only. Real acknowledgements contain auth context and must
    # never be logged or persisted as acceptance-test evidence.
    return {
        "name": "otel-ingestion-job",
        "data": {
            "id": "11111111-2222-4333-8444-555555555555",
            "timestamp": "2026-10-15T01:00:00.000Z",
            "name": "otel-ingestion-job",
            "payload": {
                "data": {"fileKey": "otel/test/payload.json", "publicKey": "never-log-public-key"},
                "authCheck": {
                    "validKey": True,
                    "scope": {"projectId": "never-log-project", "accessLevel": "project", "orgId": "test-org"},
                },
                "sdkName": "test-sdk",
                "ingestionVersion": "4",
            },
        },
    }


def _replace_ack_value(ack: dict[str, object], path: tuple[str, ...], value: object) -> None:
    for field in path[:-1]:
        nested = ack[field]
        assert isinstance(nested, dict)
        ack = cast(dict[str, object], nested)
    ack[path[-1]] = value


class TestProviderDispatchCases:
    @staticmethod
    @pytest.fixture
    def trace() -> CanonicalTrace:
        start = datetime(2026, 10, 15, 1, tzinfo=UTC)
        return CanonicalTrace(
            trace_id="1" * 32,
            session_id="conversation-1",
            root_span_id="1" * 16,
            spans=(
                CanonicalSpan(
                    id="1" * 16,
                    parent_id=None,
                    name="Agent turn",
                    kind=CanonicalSpanKind.AGENT,
                    start_time=start,
                    end_time=start + timedelta(seconds=3),
                    status=CanonicalSpanStatus.OK,
                    inputs={"question": "hi"},
                    outputs={"answer": "done"},
                    metadata={
                        "app_id": "app-one",
                        "tenant_id": "tenant-one",
                        "total_tokens": 12,
                        "total_price": "0.03",
                    },
                ),
                CanonicalSpan(
                    id="2" * 16,
                    parent_id="1" * 16,
                    name="model call",
                    kind=CanonicalSpanKind.LLM,
                    start_time=start,
                    end_time=start + timedelta(seconds=1),
                    status=CanonicalSpanStatus.OK,
                    inputs=[{"role": "user", "content": "hi"}],
                    outputs="done",
                    metadata={
                        "model": "gpt-4o-mini",
                        "model_provider": "openai",
                        "prompt_tokens": 8,
                        "completion_tokens": 4,
                        "total_tokens": 12,
                        "total_price": "0.03",
                        "currency": "USD",
                        "ttft": 0.2,
                    },
                ),
                CanonicalSpan(
                    id="3" * 16,
                    parent_id="1" * 16,
                    name="search",
                    kind=CanonicalSpanKind.TOOL,
                    start_time=start + timedelta(seconds=1),
                    end_time=start + timedelta(seconds=2),
                    status=CanonicalSpanStatus.ERROR,
                    inputs={"q": "x"},
                    outputs=None,
                    error="tool failed",
                ),
            ),
        )

    @staticmethod
    @pytest.fixture
    def http_calls(monkeypatch: pytest.MonkeyPatch) -> list[HTTPCall]:
        from core.helper import ssrf_proxy

        calls: list[HTTPCall] = []

        def send(method: str, url: str, **kwargs: object) -> httpx.Response:
            calls.append((method, url, cast(HTTPArguments, kwargs)))
            return httpx.Response(200, content=b"", request=httpx.Request(method, url))

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        return calls

    @staticmethod
    def test_langfuse_v4_tree_and_native_usage(trace: CanonicalTrace, http_calls: list[HTTPCall]) -> None:
        config = {
            "host": "https://us.cloud.langfuse.com",
            "public_key": "pk-test",
            "secret_key": "sk-test",
            "project_url": "https://us.cloud.langfuse.com/project/example",
        }
        result = export_trace("langfuse", config, trace)
        assert result.status == "accepted"
        assert result.trace_id == trace.trace_id
        assert len(http_calls) == 1
        _, url, args = http_calls[0]
        assert url.endswith("/api/public/otel/v1/traces")
        assert args["headers"]["x-langfuse-ingestion-version"] == "4"
        assert args["max_retries"] == 0
        assert args["follow_redirects"] is False
        spans = spans_from_call(http_calls[0])
        assert [span.span_id.hex() for span in spans] == [s.id for s in trace.spans]
        assert spans[1].parent_span_id == spans[0].span_id
        assert spans[2].status.code == 2
        root, llm = attributes(spans[0]), attributes(spans[1])
        assert root["langfuse.observation.type"] == "agent"
        assert "langfuse.observation.usage_details" not in root
        usage_details, cost_details = (
            llm["langfuse.observation.usage_details"],
            llm["langfuse.observation.cost_details"],
        )
        assert isinstance(usage_details, str)
        assert isinstance(cost_details, str)
        assert json.loads(usage_details) == {"input": 8, "output": 4, "total": 12}
        assert json.loads(cost_details) == {"total": 0.03}
        assert all(attributes(span)["langfuse.session.id"] == trace.session_id for span in spans)
        assert result.span_urls[trace.spans[1].id].endswith(trace.spans[1].id)

    @staticmethod
    @pytest.mark.parametrize(
        ("provider", "config", "suffix", "kind_key", "kind"),
        [
            (
                "phoenix",
                {"endpoint": "https://phoenix.test/proxy", "api_key": "key", "project": "one"},
                "/proxy/v1/traces",
                "openinference.span.kind",
                "AGENT",
            ),
            (
                "aliyun",
                {"endpoint": "https://region.log.aliyuncs.com", "license_key": "license", "app_name": "one"},
                "/adapt_license/api/v1/traces",
                "gen_ai.span.kind",
                "AGENT",
            ),
        ],
    )
    def test_other_http_providers_have_native_semantics(
        trace: CanonicalTrace,
        http_calls: list[HTTPCall],
        provider: str,
        config: dict[str, str],
        suffix: str,
        kind_key: str,
        kind: str,
    ) -> None:
        result = export_trace(provider, config, trace)
        assert result.status == "accepted"
        assert http_calls[0][1].endswith(suffix)
        spans = spans_from_call(http_calls[0])
        assert attributes(spans[0])[kind_key] == kind
        token_key = "llm.token_count.prompt" if provider == "phoenix" else "gen_ai.usage.input_tokens"
        assert attributes(spans[1])[token_key] == 8
        assert token_key not in attributes(spans[0])

    @staticmethod
    @pytest.mark.parametrize(
        ("endpoint_url", "suffix"),
        [
            ("https://log.aliyuncs.com", "api/v1/traces"),
            ("https://cn-hangzhou.log.aliyuncs.com", "api/v1/traces"),
            ("https://project.cn-heyuan.log.aliyuncs.com/apm/trace/opentelemetry", "api/v1/traces"),
            ("https://project.cn-heyuan-intranet.log.aliyuncs.com/apm/trace/opentelemetry", "api/v1/traces"),
            ("https://cn-shanghai-share.log.aliyuncs.com", "api/v1/traces"),
            ("https://cn-beijing.dualstack.log.aliyuncs.com", "api/v1/traces"),
            ("https://cn-hangzhou.log.aliyuncs.com.:443", "api/v1/traces"),
            ("https://tracing-analysis-dc-hz.aliyuncs.com", "api/otlp/traces"),
            ("https://collector.example.test:4318/custom-prefix", "api/otlp/traces"),
            ("https://evil-log.aliyuncs.com.evil.test", "api/otlp/traces"),
            ("https://log.aliyuncs.com.evil.test", "api/otlp/traces"),
            ("https://evil-log.aliyuncs.com", "api/otlp/traces"),
            ("https://collector.example.test/log.aliyuncs.com", "api/otlp/traces"),
        ],
    )
    def test_aliyun_endpoint_family_uses_dns_labels_and_preserves_custom_destinations(
        trace: CanonicalTrace, http_calls: list[HTTPCall], endpoint_url: str, suffix: str
    ) -> None:
        result = export_trace(
            "aliyun", {"endpoint": endpoint_url, "license_key": "synthetic-license", "app_name": "test-app"}, trace
        )
        assert result.status == "accepted"
        assert len(http_calls) == 1
        assert http_calls[0][1] == f"{endpoint_url}/adapt_synthetic-license/{suffix}"
        spans = spans_from_call(http_calls[0])
        assert [span.span_id.hex() for span in spans] == [span.id for span in trace.spans]
        assert spans[1].parent_span_id == spans[0].span_id

    @staticmethod
    def test_aliyun_raw_license_is_encoded_once_at_the_real_otlp_boundary(
        trace: CanonicalTrace, http_calls: list[HTTPCall]
    ) -> None:
        result = export_trace(
            "aliyun",
            {"endpoint": "https://COLLECTOR.test:8443/prefix/", "license_key": "raw%2F@a+b/c", "app_name": "test_app"},
            trace,
        )
        assert result.status == "accepted"
        assert len(http_calls) == 1
        assert http_calls[0][1] == "https://collector.test:8443/prefix/adapt_raw%252F@a%2Bb%2Fc/api/otlp/traces"
        assert [span.span_id.hex() for span in spans_from_call(http_calls[0])] == [span.id for span in trace.spans]

    @staticmethod
    def test_aliyun_complete_token_url_is_rejected_without_any_ingestion(
        trace: CanonicalTrace, http_calls: list[HTTPCall]
    ) -> None:
        with pytest.raises(TraceExportRejectedError, match="Aliyun tracing configuration is invalid"):
            export_trace(
                "aliyun",
                {"endpoint": "https://collector.test/adapt_private/api/otlp/traces", "license_key": "private"},
                trace,
            )
        assert http_calls == []

    @staticmethod
    @pytest.mark.parametrize(
        ("provider", "config", "header"),
        [
            (
                "arize",
                {"endpoint": "https://otlp.arize.com", "api_key": "key", "space_id": "space", "project": "one"},
                ("space_id", "space"),
            ),
            (
                "tencent",
                {"endpoint": "https://apm.test:4317", "token": "token", "service_name": "one"},
                ("authorization", "Bearer token"),
            ),
        ],
    )
    def test_grpc_real_stub_serialization(
        trace: CanonicalTrace,
        monkeypatch: pytest.MonkeyPatch,
        provider: str,
        config: dict[str, str],
        header: tuple[str, str],
    ) -> None:
        calls: list[tuple[ExportTraceServiceRequest, Sequence[tuple[str, str]]]] = []

        class Channel:
            def unary_unary(
                self,
                method: str,
                request_serializer: Callable[[ExportTraceServiceRequest], bytes],
                response_deserializer: Callable[[bytes], ExportTraceServiceResponse],
                **_kwargs: object,
            ) -> Callable[..., ExportTraceServiceResponse]:
                assert method == "/opentelemetry.proto.collector.trace.v1.TraceService/Export"

                def invoke(
                    payload: ExportTraceServiceRequest, metadata: Sequence[tuple[str, str]], timeout: float
                ) -> ExportTraceServiceResponse:
                    assert timeout == 30
                    calls.append((ExportTraceServiceRequest.FromString(request_serializer(payload)), metadata))
                    return response_deserializer(ExportTraceServiceResponse().SerializeToString())

                return invoke

            def close(self) -> None:
                pass

        monkeypatch.setattr("grpc.secure_channel", lambda *_args, **_kwargs: Channel())
        result = export_trace(provider, config, trace)
        assert result.status == "accepted"
        assert header in calls[0][1]
        spans = calls[0][0].resource_spans[0].scope_spans[0].spans
        assert spans[1].parent_span_id == spans[0].span_id

    @staticmethod
    def test_langsmith_real_sdk_uses_isolated_sync_runs(trace: CanonicalTrace, http_calls: list[HTTPCall]) -> None:
        result = export_trace(
            "langsmith", {"api_key": "ls-test", "endpoint": "https://langsmith.test", "project": "one"}, trace
        )
        writes = [json.loads(call[2]["content"]) for call in http_calls if call[0] == "POST"]
        assert len(writes) == 3
        root, llm, tool = writes
        assert root["run_type"] == "chain"
        assert llm["run_type"] == "llm"
        assert llm["parent_run_id"] == root["id"]
        assert llm["dotted_order"].startswith(root["dotted_order"])
        assert llm["input_tokens"] == 8
        assert llm["output_tokens"] == 4
        assert llm["total_cost"] == 0.03
        assert "input_tokens" not in root
        assert all(write["extra"]["metadata"]["session_id"] == trace.session_id for write in writes)
        assert tool["error"] == "tool failed"
        assert UUID(result.trace_id)

    @staticmethod
    def test_opik_real_sdk_preserves_tree_thread_and_native_usage(
        trace: CanonicalTrace, http_calls: list[HTTPCall]
    ) -> None:
        result = export_trace(
            "opik",
            {"api_key": "opik-test", "url": "https://opik.test/api", "workspace": "org-one", "project": "one"},
            trace,
        )
        assert len(http_calls) == 2
        root = json.loads(http_calls[0][2]["content"])
        batch = json.loads(http_calls[1][2]["content"])
        spans = batch["spans"]
        assert UUID(result.trace_id).version == 7
        assert root["thread_id"] == trace.session_id
        assert spans[1]["parent_span_id"] == spans[0]["id"]
        assert spans[1]["usage"]["prompt_tokens"] == 8
        assert spans[1]["total_estimated_cost"] == 0.03
        assert not spans[0].get("usage")
        assert spans[2]["error_info"]["message"] == "tool failed"
        assert http_calls[0][2]["headers"]["comet-workspace"] == "org-one"

    @staticmethod
    @pytest.mark.parametrize(
        ("value", "wire_value"),
        [
            (None, None),
            ("323", "323"),
            ({"result": 323}, {"result": 323}),
            ([{"result": 323}], [{"result": 323}]),
            ([], []),
            (323, "323"),
            (0, "0"),
            (-5, "-5"),
            (3.5, "3.5"),
            (True, "true"),
            (False, "false"),
            ([1, 2], "[1, 2]"),
            (["one", "two"], '["one", "two"]'),
            ([{"result": 1}, "text"], '[{"result": 1}, "text"]'),
            ([[1], [2]], "[[1], [2]]"),
        ],
    )
    def test_opik_real_sdk_preserves_json_content_across_trace_and_span_boundaries(
        trace: CanonicalTrace, http_calls: list[HTTPCall], value: object, wire_value: object
    ) -> None:
        content_trace = trace.model_copy(
            update={"spans": tuple(span.model_copy(update={"inputs": value, "outputs": value}) for span in trace.spans)}
        )
        result = export_trace(
            "opik",
            {"api_key": "synthetic-key", "url": "https://opik.test/api", "workspace": "team", "project": "one"},
            content_trace,
        )
        assert result.status == "accepted"
        assert len(http_calls) == 2
        root = json.loads(http_calls[0][2]["content"])
        spans = json.loads(http_calls[1][2]["content"])["spans"]
        for payload in [root, *spans]:
            assert payload.get("input") == wire_value
            assert payload.get("output") == wire_value
        assert spans[1]["parent_span_id"] == spans[0]["id"]
        assert spans[2]["parent_span_id"] == spans[0]["id"]
        assert root["thread_id"] == trace.session_id
        assert spans[1]["usage"]["total_tokens"] == 12
        assert not spans[0].get("usage")
        assert not spans[2].get("usage")

    @staticmethod
    @pytest.mark.parametrize("capture_content", [True, False])
    @pytest.mark.parametrize("root_error", [True, False])
    def test_opik_trace_error_matches_sanitized_root_and_not_handled_tool_failure(
        trace: CanonicalTrace, http_calls: list[HTTPCall], capture_content: bool, root_error: bool
    ) -> None:
        root = trace.spans[0].model_copy(
            update={
                "status": CanonicalSpanStatus.ERROR if root_error else CanonicalSpanStatus.OK,
                "error": "private-model-error" if root_error else None,
                "inputs": {"query": "private-error-input"},
            }
        )
        source = trace.model_copy(update={"spans": (root, *trace.spans[1:])})
        canonical = remap_outer_trace(
            source, trace_id=trace.trace_id, capture_content=capture_content, agent_message=True
        )
        export_trace(
            "opik",
            {"api_key": "synthetic-key", "url": "https://opik.test/api", "workspace": "team", "project": "one"},
            canonical,
        )
        root_payload = json.loads(http_calls[0][2]["content"])
        spans = json.loads(http_calls[1][2]["content"])["spans"]
        assert spans[2]["error_info"] is not None
        if root_error:
            expected = {
                "exception_type": "DifyExecutionError",
                "message": "private-model-error" if capture_content else "Application execution failed",
                "traceback": "",
            }
            assert root_payload["error_info"] == spans[0]["error_info"] == expected
        else:
            assert root_payload.get("error_info") is None
            assert spans[0].get("error_info") is None
        if not capture_content:
            assert all(b"private-model-error" not in call[2]["content"] for call in http_calls)
            assert all(b"private-error-input" not in call[2]["content"] for call in http_calls)

    @staticmethod
    @pytest.mark.parametrize(
        ("status", "error"),
        [(401, TraceExportRejectedError), (429, RetryableTraceDispatchError), (503, RetryableTraceDispatchError)],
    )
    def test_explicit_http_rejections_are_classified_without_response_body(
        trace: CanonicalTrace, monkeypatch: pytest.MonkeyPatch, status: int, error: type[Exception]
    ) -> None:
        from core.helper import ssrf_proxy

        monkeypatch.setattr(
            ssrf_proxy,
            "make_request",
            lambda method, url, **_kwargs: httpx.Response(
                status, text="secret-token", request=httpx.Request(method, url)
            ),
        )
        with pytest.raises(error) as caught:
            export_trace(
                "langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "secret-token"}, trace
            )
        assert "secret-token" not in str(caught.value)

    @staticmethod
    def test_partial_otlp_acceptance_requires_reconciliation(
        trace: CanonicalTrace, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from core.helper import ssrf_proxy

        response = ExportTraceServiceResponse()
        response.partial_success.rejected_spans = 1
        monkeypatch.setattr(
            ssrf_proxy,
            "make_request",
            lambda method, url, **_kwargs: httpx.Response(
                200, content=response.SerializeToString(), request=httpx.Request(method, url)
            ),
        )
        with pytest.raises(TraceExportUncertainError):
            export_trace("langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}, trace)

    @staticmethod
    def test_langfuse_v4_queue_ack_confirms_ingestion_acceptance_only(
        trace: CanonicalTrace,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        from core.helper import ssrf_proxy

        monkeypatch.setattr(
            ssrf_proxy,
            "make_request",
            lambda method, url, **_kwargs: httpx.Response(
                200, json=_langfuse_queue_job_ack(), request=httpx.Request(method, url)
            ),
        )
        result = export_trace(
            "langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}, trace
        )
        assert result.status == "accepted"
        assert result.trace_id == trace.trace_id
        assert result.trace_url is None
        captured = capsys.readouterr()
        evidence = caplog.text + captured.out + captured.err + repr(result)
        assert "never-log-public-key" not in evidence
        assert "never-log-project" not in evidence
        assert "authCheck" not in evidence

    @staticmethod
    @pytest.mark.parametrize(
        "scenario",
        [
            "wrong_name",
            "wrong_nested_name",
            "invalid_id",
            "invalid_timestamp",
            "invalid_auth",
            "missing_scope",
            "missing_file",
            "partial_success",
            "error",
            "failed_job",
            "unknown",
            "null",
            "array",
        ],
    )
    def test_langfuse_ambiguous_json_ack_remains_uncertain(
        trace: CanonicalTrace,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        capsys: pytest.CaptureFixture[str],
        scenario: str,
    ) -> None:
        from core.helper import ssrf_proxy

        ack = _langfuse_queue_job_ack()
        body: object = ack
        if scenario == "wrong_name":
            ack["name"] = "different-job"
        elif scenario == "wrong_nested_name":
            _replace_ack_value(ack, ("data", "name"), "different-job")
        elif scenario == "invalid_id":
            _replace_ack_value(ack, ("data", "id"), "not-a-uuid")
        elif scenario == "invalid_timestamp":
            _replace_ack_value(ack, ("data", "timestamp"), "2026-10-15T01:00:00")
        elif scenario == "invalid_auth":
            _replace_ack_value(ack, ("data", "payload", "authCheck", "validKey"), False)
        elif scenario == "missing_scope":
            _replace_ack_value(ack, ("data", "payload", "authCheck", "scope"), dict[str, object]())
        elif scenario == "missing_file":
            _replace_ack_value(ack, ("data", "payload", "data", "fileKey"), "")
        elif scenario == "partial_success":
            ack["partialSuccess"] = {"rejectedSpans": "1"}
        elif scenario == "error":
            ack["error"] = "never-log-public-key"
        elif scenario == "failed_job":
            ack["failedReason"] = "never-log-public-key"
        elif scenario == "unknown":
            body = {"accepted": True, "publicKey": "never-log-public-key"}
        elif scenario == "null":
            body = None
        elif scenario == "array":
            body = list[object]()
        monkeypatch.setattr(
            ssrf_proxy,
            "make_request",
            lambda method, url, **_kwargs: httpx.Response(
                200,
                content=json.dumps(body).encode(),
                headers={"Content-Type": "application/json"},
                request=httpx.Request(method, url),
            ),
        )
        with pytest.raises(TraceExportUncertainError) as caught:
            export_trace("langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}, trace)
        captured = capsys.readouterr()
        evidence = caplog.text + captured.out + captured.err + str(caught.value)
        assert "never-log-public-key" not in evidence
        assert "never-log-project" not in evidence
        assert "authCheck" not in evidence

    @staticmethod
    @pytest.mark.parametrize(
        ("provider", "version", "status"), [("phoenix", "4", 200), ("langfuse", "3", 200), ("langfuse", "4", 202)]
    )
    def test_langfuse_queue_ack_is_not_a_generic_otlp_success(
        monkeypatch: pytest.MonkeyPatch, provider: str, version: str, status: int
    ) -> None:
        from core.helper import ssrf_proxy
        from services.tracing.otlp_export import export_http

        monkeypatch.setattr(
            ssrf_proxy,
            "make_request",
            lambda method, url, **_kwargs: httpx.Response(
                status, json=_langfuse_queue_job_ack(), request=httpx.Request(method, url)
            ),
        )
        with pytest.raises(TraceExportUncertainError):
            export_http(
                provider,
                "https://collector.test/v1/traces",
                {"x-langfuse-ingestion-version": version},
                ExportTraceServiceRequest(),
            )

    @staticmethod
    @pytest.mark.parametrize("body", [{}, {"partialSuccess": {}}, {"partialSuccess": {"rejectedSpans": "1"}}])
    def test_langfuse_standard_otlp_json_ack_remains_supported(
        trace: CanonicalTrace, monkeypatch: pytest.MonkeyPatch, body: dict[str, dict[str, str]]
    ) -> None:
        from core.helper import ssrf_proxy

        monkeypatch.setattr(
            ssrf_proxy,
            "make_request",
            lambda method, url, **_kwargs: httpx.Response(200, json=body, request=httpx.Request(method, url)),
        )
        config = {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}
        if body.get("partialSuccess", {}).get("rejectedSpans"):
            with pytest.raises(TraceExportUncertainError):
                export_trace("langfuse", config, trace)
        else:
            assert export_trace("langfuse", config, trace).status == "accepted"

    @staticmethod
    def test_lost_http_ack_is_uncertain_not_rejected(trace: CanonicalTrace, monkeypatch: pytest.MonkeyPatch) -> None:
        from core.helper import ssrf_proxy

        def timeout(*_args: object, **_kwargs: object) -> Never:
            raise httpx.ReadTimeout("response lost")

        monkeypatch.setattr(ssrf_proxy, "make_request", timeout)
        with pytest.raises(TraceExportUncertainError):
            export_trace("langfuse", {"host": "https://langfuse.test", "public_key": "pk", "secret_key": "sk"}, trace)

    @staticmethod
    @pytest.mark.parametrize("provider", ["langsmith", "opik"])
    @pytest.mark.parametrize("accepted_prefix", [False, True])
    def test_native_sdk_preserves_first_failure_or_partial_acceptance(
        trace: CanonicalTrace, monkeypatch: pytest.MonkeyPatch, provider: str, accepted_prefix: bool
    ) -> None:
        from core.helper import ssrf_proxy

        calls: list[str] = []

        def send(method: str, url: str, **_kwargs: object) -> httpx.Response:
            calls.append(url)
            status = 200 if accepted_prefix and len(calls) == 1 else 429
            return httpx.Response(status, content=b"", request=httpx.Request(method, url))

        monkeypatch.setattr(ssrf_proxy, "make_request", send)
        config = {
            "api_key": "test-key",
            "project": "one",
            "endpoint": "https://smith.test",
            "url": "https://opik.test/api",
        }
        expected = TraceExportUncertainError if accepted_prefix else RetryableTraceDispatchError
        with pytest.raises(expected) as caught:
            export_trace(provider, config, trace)
        assert isinstance(caught.value, TraceExportUncertainError) is accepted_prefix
        assert len(calls) == (2 if accepted_prefix else 1)

    @staticmethod
    def test_http_exports_keep_destination_credentials_local(trace: CanonicalTrace, http_calls: list[HTTPCall]) -> None:
        for project in ("a", "b"):
            export_trace(
                "langfuse", {"host": f"https://{project}.test", "public_key": project, "secret_key": project}, trace
            )
        assert http_calls[0][1].startswith("https://a.test/")
        assert http_calls[1][1].startswith("https://b.test/")
        assert http_calls[0][2]["headers"]["Authorization"] != http_calls[1][2]["headers"]["Authorization"]
        assert http_calls[0][2]["content"] == http_calls[1][2]["content"]

    @staticmethod
    @pytest.mark.parametrize(
        "provider",
        ["langfuse", "langsmith", "phoenix", "arize", "opik", "weave", "mlflow", "databricks", "aliyun", "tencent"],
    )
    def test_capabilities_state_implemented_contract_not_platform_validation(provider: str) -> None:
        result = provider_capabilities(provider)
        assert result["agent_spans"] is True
        assert result["export_ack"] == "accepted"
        assert "platform_validated" not in result

    @staticmethod
    def test_rejects_unfinished_and_unknown_provider_before_sending(
        trace: CanonicalTrace, http_calls: list[HTTPCall]
    ) -> None:
        unfinished = trace.model_copy(update={"spans": (trace.spans[0].model_copy(update={"end_time": None}),)})
        with pytest.raises(TraceExportRejectedError):
            export_trace("langfuse", {}, unfinished)
        with pytest.raises(TraceExportRejectedError):
            export_trace("unknown", {}, trace)
        assert not http_calls
