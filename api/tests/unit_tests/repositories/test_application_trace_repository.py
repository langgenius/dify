import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal
from uuid import UUID

import pytest
from aliyun.log.logclient import LogClient
from sqlalchemy import Connection, Engine, delete, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.ops.entities.trace_entity import ModerationTraceInfo
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_run_repository import _dict_to_workflow_run
from libs.datetime_utils import naive_utc_now
from models.application_trace import ApplicationTraceBatch, ApplicationTraceInvocation, ApplicationTraceRun
from models.model import App, AppMode
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun
from repositories.application_trace_repository import TraceCollectionError
from services.tracing.provider_dispatch import TraceExportResult
from services.tracing.recovery import _workflow_task
from services.tracing.service import ApplicationTracingService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_workflow
from tests.unit_tests.services.tracing.test_runtime_bridge import AGENT_GRAPH, workflow_info
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_batch_for as batch_for
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_claim as claim
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_identifier as identifier
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_ingest as ingest
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_seed as seed
from tests.unit_tests.services.tracing.test_service import _application_trace_collection_terminal as terminal
from tests.unit_tests.services.tracing.test_service import _ApplicationTraceCollectionCollection as Collection

"""Configured LogStore readers work without SQL mirrors and retain source ownership."""


@dataclass
class StoredSource:
    case: Collection
    kind: Literal["workflow", "node"]
    row: dict[str, object]
    requests: list[str]

    def start(self) -> ApplicationTraceRun:
        run = self.case.repository.start(
            tenant_id=self.case.run.tenant_id,
            app_id=self.case.run.app_id,
            source_kind=self.kind,
            source_id=str(self.row["id"]),
            session_id="logstore-session",
        )
        assert run is not None
        return run

    def service(self) -> ApplicationTracingService:
        return ApplicationTracingService(self.case.repository)

    def status(self, node_execution_id: str | None = None) -> dict[str, object]:
        return self.service().status(
            tenant_id=self.case.run.tenant_id,
            app_id=self.case.run.app_id,
            source_kind=self.kind,
            source_id=str(self.row["id"]),
            node_execution_id=node_execution_id,
        )


class TestApplicationTraceLogstoreCases:
    @staticmethod
    @pytest.fixture(params=["workflow", "node"])
    def stored(
        request: pytest.FixtureRequest,
        sqlite_engine: Engine,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> Iterator[StoredSource]:
        kind = request.param
        assert kind in {"workflow", "node"}
        case = seed(sqlite_session_factory, "logstore")
        with case.sessions.begin() as session:
            app = session.get(App, case.run.app_id)
            assert app is not None
            app.mode = AppMode.WORKFLOW
        now = naive_utc_now()
        row: dict[str, object] = {
            "id": identifier("logstore-source"),
            "tenant_id": case.run.tenant_id,
            "app_id": case.run.app_id,
            "workflow_id": identifier("definition"),
            "created_by": identifier("owner"),
            "created_at": (now - timedelta(seconds=30)).isoformat(),
            "finished_at": (now - timedelta(seconds=10)).isoformat(),
            "status": "succeeded",
            "elapsed_time": 20,
            "inputs": json.dumps({"query": "private input"}),
            "outputs": json.dumps({"result": "private output"}),
            "node_id": "agent-node",
            "node_type": "agent",
            "title": "Agent preview",
            "graph": json.dumps(AGENT_GRAPH),
        }
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
        monkeypatch.setenv("LOGSTORE_DUAL_READ_ENABLED", "false")
        monkeypatch.setenv("LOGSTORE_PG_MODE_ENABLED", "false")
        monkeypatch.setenv("ALIYUN_SLS_ACCESS_KEY_ID", "test-access-key")
        monkeypatch.setenv("ALIYUN_SLS_ACCESS_KEY_SECRET", "test-secret")
        monkeypatch.setenv("ALIYUN_SLS_ENDPOINT", "https://sls.example.test")
        monkeypatch.setenv("ALIYUN_SLS_REGION", "test-region")
        monkeypatch.setattr(AliyunLogStore, "_instance", None)
        monkeypatch.setattr(AliyunLogStore, "_initialized", False)
        monkeypatch.setattr(
            AliyunLogStore, "_check_endpoint_connectivity", staticmethod(lambda _endpoint, _timeout: None)
        )

        def reject_http_transport(*_args: object, **_kwargs: object) -> None:
            pytest.fail("Configured LogStore test escaped its isolated transport boundary")

        monkeypatch.setattr(LogClient, "_getHttpResponse", reject_http_transport)
        transactions: set[Connection] = set()

        def begun(connection: Connection) -> None:
            transactions.add(connection)

        def ended(connection: Connection) -> None:
            transactions.discard(connection)

        requests: list[str] = []

        def get_logs(
            _client: AliyunLogStore, *, query: str, logstore: str, **_kwargs: object
        ) -> list[dict[str, object]]:
            # Exercise real configured repository construction, scoped query generation,
            # and model decoding; replace only the remote transport boundary.
            assert not transactions, "LogStore I/O must not hold a SQL transaction"
            assert f'tenant_id:"{case.run.tenant_id}"' in query.replace(": ", ":")
            assert logstore == (
                AliyunLogStore.workflow_execution_logstore
                if kind == "workflow"
                else AliyunLogStore.workflow_node_execution_logstore
            )
            if kind == "workflow":
                assert f'app_id:"{case.run.app_id}"' in query
            requests.append(query)
            return [dict(row)] if row else []

        monkeypatch.setattr(AliyunLogStore, "get_logs", get_logs)

        def execute_sql(
            client: AliyunLogStore, *, sql: str, query: str, logstore: str, **_kwargs: object
        ) -> list[dict[str, object]]:
            # The node reader now uses SQL in both SDK and PG modes. Preserve the
            # real repository's query/decoding path while isolating this transport.
            assert kind == "node"
            assert f'id:"{identifier("logstore-source")}"' in query.replace(": ", ":")
            assert f"tenant_id = '{case.run.tenant_id}'" in sql
            assert f"id = '{identifier('logstore-source')}'" in sql
            assert f'FROM "{logstore}"' in sql
            assert "ORDER BY log_version DESC LIMIT 1" in sql
            return get_logs(client, query=query, logstore=logstore)

        monkeypatch.setattr(AliyunLogStore, "execute_sql", execute_sql)
        event.listen(sqlite_engine, "begin", begun)
        event.listen(sqlite_engine, "commit", ended)
        event.listen(sqlite_engine, "rollback", ended)
        try:
            yield StoredSource(case, kind, row, requests)
        finally:
            event.remove(sqlite_engine, "begin", begun)
            event.remove(sqlite_engine, "commit", ended)
            event.remove(sqlite_engine, "rollback", ended)

    @staticmethod
    def test_status_and_retry_use_logstore_without_sql_source_rows(
        stored: StoredSource, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        run = stored.start()
        with stored.case.sessions() as session:
            assert session.scalar(select(WorkflowRun)) is None
            assert session.scalar(select(WorkflowNodeExecutionModel)) is None
        with stored.case.sessions.begin() as session:
            current = session.get(ApplicationTraceRun, run.id)
            assert current is not None
            current.state = "failed"
            current.error_code = "provider_export_rejected"
            current.outer_trace = {"persisted": True}
        assert stored.status()["status"] == "failed"
        scheduled: list[str] = []
        service = stored.service()
        monkeypatch.setattr(service, "schedule", scheduled.append)
        stored.requests.clear()
        result = service.retry(
            tenant_id=run.tenant_id,
            app_id=run.app_id,
            source_kind=stored.kind,
            source_id=run.source_id,
            acknowledge_possible_duplicates=False,
        )
        assert result["status"] == "ready"
        assert scheduled == [run.id]
        assert len(stored.requests) == 1

    @staticmethod
    @pytest.mark.parametrize("field", ["id", "tenant_id", "app_id"])
    def test_backend_result_must_match_complete_source_owner(stored: StoredSource, field: str) -> None:
        run = stored.start()
        stored.row[field] = identifier("foreign")
        with pytest.raises(TraceCollectionError, match="tracing_source_not_found") as caught:
            stored.service().status(
                tenant_id=run.tenant_id, app_id=run.app_id, source_kind=stored.kind, source_id=run.source_id
            )
        assert caught.value.status == 404
        assert stored.case.repository.get(run.id) is not None

    @staticmethod
    def test_foreign_app_owner_is_rejected_before_logstore_request(stored: StoredSource) -> None:
        stored.start()
        stored.requests.clear()
        with stored.case.sessions.begin() as session:
            app = session.get(App, stored.case.run.app_id)
            assert app is not None
            app.tenant_id = identifier("other-tenant")
        with pytest.raises(TraceCollectionError, match="tracing_source_not_found"):
            stored.status()
        assert stored.requests == []

    @staticmethod
    def test_initialization_failure_uses_configured_source_reader(stored: StoredSource) -> None:
        run = stored.case.repository.record_initialization_failure(
            tenant_id=stored.case.run.tenant_id,
            app_id=stored.case.run.app_id,
            source_kind=stored.kind,
            source_id=str(stored.row["id"]),
        )
        assert run is not None
        assert run.state == "failed"
        assert run.error_code == "tracing_initialization_failed"

    @staticmethod
    def test_existing_snapshot_reentry_does_not_consult_logstore(stored: StoredSource) -> None:
        original = stored.start()
        stored.requests.clear()
        stored.row.clear()
        current = stored.case.repository.start(
            tenant_id=original.tenant_id,
            app_id=original.app_id,
            source_kind=stored.kind,
            source_id=original.source_id,
            session_id="must-not-replace",
        )
        assert current is not None
        assert current.id == original.id
        assert current.session_id == original.session_id
        assert stored.requests == []

    @staticmethod
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    def test_workflow_node_deep_link_is_scoped_to_durable_invocation(stored: StoredSource) -> None:
        run = stored.start()
        case = Collection(stored.case.repository, stored.case.sessions, run)
        node_id = identifier("logstore-agent-node")
        invocation = case.repository.invocation(
            run_id=run.id, agent_id=identifier("agent"), node_execution_id=node_id, attempt=0, call_key="node"
        )
        ingest(case, batch_for(run, invocation))
        terminal(case)
        lease = claim(case)
        assert lease is not None
        case.repository.complete(
            run.id,
            lease[1],
            state="accepted",
            result=TraceExportResult("provider-id", span_urls={invocation.span_id: "https://trace.test/span"}),
        )
        assert stored.status(node_id)["span_url"] == "https://trace.test/span"
        with pytest.raises(TraceCollectionError, match="tracing_node_not_found"):
            stored.status(identifier("another-run-node"))

    @staticmethod
    def test_preview_settlement_and_workflow_recovery_use_configured_source(stored: StoredSource) -> None:
        run = stored.start()
        if stored.kind == "workflow":
            task = _workflow_task(stored.case.repository, run, naive_utc_now())
            assert task is not None
            assert task.workflow_run_id == run.source_id
            assert task.kwargs["trace_session_id"] == run.session_id
            stored.row["status"] = "running"
            assert _workflow_task(stored.case.repository, run, naive_utc_now()) is None
        else:
            stored.service().settle_preview(run)
            current = stored.case.repository.get(run.id)
            assert current is not None
            assert current.outer_trace is not None
            root = current.outer_trace["spans"][0]
            assert root["status"] == "ok"
            assert root["inputs"] is None
            assert root["outputs"] is None
            assert root["metadata"]["node_execution_id"] == run.source_id

    @staticmethod
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    def test_missing_snapshot_classifies_logstore_agent_workflow_and_persists_failure(stored: StoredSource) -> None:
        info = workflow_info(_dict_to_workflow_run(stored.row))
        assert stored.service().capture_terminal(info) is True
        result = stored.status()
        assert result["status"] == "failed"
        assert result["error_code"] == "tracing_initialization_failed"

    @staticmethod
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    @pytest.mark.parametrize("has_agent", [True, False])
    def test_unindexed_workflow_uses_owned_definition_for_safe_legacy_decision(
        stored: StoredSource, has_agent: bool
    ) -> None:
        info = workflow_info(_dict_to_workflow_run(stored.row))
        with stored.case.sessions.begin() as session:
            app = session.get(App, stored.case.run.app_id)
            assert app is not None
            definition = make_workflow(
                workflow_id=str(stored.row["workflow_id"]),
                tenant_id=app.tenant_id,
                app_id=app.id,
                graph=AGENT_GRAPH if has_agent else {"nodes": [{"data": {"type": "llm"}}]},
            )
            app.workflow_id = definition.id
            session.add(definition)
        stored.row.clear()
        assert stored.service().capture_terminal(info) is has_agent

    @staticmethod
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    @pytest.mark.parametrize("snapshot", [True, False])
    def test_auxiliary_content_is_suppressed_for_logstore_workflow(stored: StoredSource, snapshot: bool) -> None:
        if snapshot:
            stored.start()
        info = ModerationTraceInfo(
            message_id=identifier("workflow-log"),
            metadata={
                "workflow_run_id": stored.row["id"],
                **({} if snapshot else {"app_id": stored.case.run.app_id}),
            },
            flagged=False,
            action="direct_output",
            preset_response="",
            query="private query",
            inputs="private input",
            outputs="private output",
        )
        assert stored.service().capture_terminal(info) is True
        if snapshot:
            # Durable ownership is sufficient to suppress auxiliary payload even when
            # the remote run has not been indexed yet.
            stored.row.clear()
            assert stored.service().capture_terminal(info) is True
        else:
            stored.row["graph"] = json.dumps({"nodes": [{"data": {"type": "llm"}}]})
            assert stored.service().capture_terminal(info) is False

    @staticmethod
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    @pytest.mark.parametrize("mismatch", [None, "tenant_id", "app_id"])
    def test_linked_parent_requires_logstore_run_and_durable_owner_to_agree(
        stored: StoredSource, mismatch: str | None
    ) -> None:
        parent = stored.start()
        info = workflow_info(_dict_to_workflow_run(stored.row), _dict_to_workflow_run(stored.row))
        original = dict(info.metadata)
        if mismatch:
            stored.row[mismatch] = identifier("foreign")
        stored.service()._link_managed_parent(info, parent.tenant_id)
        if mismatch:
            assert info.metadata == original
        else:
            assert info.resolved_parent_context == (None, None)
            assert info.metadata["linked_parent_trace_id"] == parent.trace_id
            assert info.metadata["linked_parent_workflow_run_id"] == parent.source_id

    @staticmethod
    @pytest.mark.parametrize("stored", ["workflow"], indirect=True)
    def test_auxiliary_durable_owner_rejects_app_reassigned_to_other_tenant(stored: StoredSource) -> None:
        run = stored.start()
        with stored.case.sessions.begin() as session:
            app = session.get(App, run.app_id)
            assert app is not None
            app.tenant_id = identifier("foreign")
        info = ModerationTraceInfo(
            metadata={"workflow_run_id": run.source_id},
            query="",
            flagged=False,
            action="direct_output",
            preset_response="",
        )
        assert stored.service().capture_terminal(info) is False

    @staticmethod
    def test_sql_workflow_source_still_uses_scoped_configured_reader(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "sql-reader")
        row = _dict_to_workflow_run(
            {
                "id": identifier("sql-run"),
                "tenant_id": case.run.tenant_id,
                "app_id": case.run.app_id,
                "workflow_id": identifier("definition"),
                "created_by": identifier("owner"),
            }
        )
        with case.sessions.begin() as session:
            session.add(row)
        source = case.repository._source(
            tenant_id=case.run.tenant_id, app_id=case.run.app_id, kind="workflow", source_id=row.id
        )
        assert isinstance(source, WorkflowRun)
        assert source.id == row.id
        assert (
            case.repository._source(
                tenant_id=identifier("wrong-tenant"), app_id=case.run.app_id, kind="workflow", source_id=row.id
            )
            is None
        )


"""Persistence boundaries that must fail closed or remain immutable across retries."""


class TestApplicationTraceRepositoryBoundariesCases:
    @staticmethod
    @pytest.mark.parametrize("policy", ["invalid-json", "null", "[]"])
    def test_malformed_policy_freezes_disabled_decision(
        sqlite_session_factory: sessionmaker[Session], policy: str
    ) -> None:
        case = seed(sqlite_session_factory, "malformed")
        with case.sessions.begin() as session:
            session.execute(delete(ApplicationTraceRun).where(ApplicationTraceRun.id == case.run.id))
            app = session.get(App, case.run.app_id)
            assert app is not None
            app.tracing = policy
        run = case.repository.start(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="message",
            source_id=case.run.source_id,
            session_id="",
        )
        assert run is not None
        assert run.state == "not_collected"
        assert run.provider_config == {}
        assert run.session_id == case.run.source_id
        assert not run.capture_content
        assert not run.capture_agent

    @staticmethod
    def test_reserved_preview_requires_persisted_owner_workflow(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = seed(sqlite_session_factory, "missing-preview-owner")
        assert (
            case.repository.start(
                tenant_id=case.run.tenant_id,
                app_id=case.run.app_id,
                source_kind="node",
                source_id=identifier("preview"),
                session_id="preview",
                workflow_id=identifier("missing-workflow"),
            )
            is None
        )

    @staticmethod
    def test_initialization_failure_cannot_replace_snapshot_or_create_foreign_row(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "failure-snapshot")
        same = case.repository.record_initialization_failure(
            tenant_id=case.run.tenant_id,
            app_id=case.run.app_id,
            source_kind="message",
            source_id=case.run.source_id,
        )
        assert same is not None
        assert same.id == case.run.id
        assert same.state == "collecting"
        assert same.provider_config == case.run.provider_config
        assert (
            case.repository.record_initialization_failure(
                tenant_id=identifier("foreign-tenant"),
                app_id=case.run.app_id,
                source_kind="message",
                source_id=case.run.source_id,
            )
            is None
        )

    @staticmethod
    @pytest.mark.parametrize("target", ["missing_run", "revoked_owner", "closed_invocation"])
    def test_ingestion_rejects_missing_or_closed_owner_without_writing(
        sqlite_session_factory: sessionmaker[Session], target: str
    ) -> None:
        case = seed(sqlite_session_factory, "ingestion-owner")
        invocation = case.invocation()
        batch = batch_for(case.run, invocation)
        if target == "missing_run":
            batch = batch.model_copy(update={"run_id": UUID(identifier("missing-run"))})
            error = "tracing_run_not_found"
        elif target == "revoked_owner":
            with case.sessions.begin() as session:
                app = session.get(App, case.run.app_id)
                assert app is not None
                app.tenant_id = identifier("another-tenant")
            error = "tracing_owner_not_found"
        else:
            with case.sessions.begin() as session:
                stored = session.get(ApplicationTraceInvocation, invocation.id)
                assert stored is not None
                stored.finalized = True
            error = "tracing_collection_closed"
        with pytest.raises(TraceCollectionError, match=error):
            ingest(case, batch)
        with case.sessions() as session:
            assert session.scalar(select(func.count()).select_from(ApplicationTraceBatch)) == 0
        stored_run = case.repository.get(case.run.id)
        assert stored_run is not None
        assert stored_run.span_count == 0

    @staticmethod
    def test_first_terminal_is_immutable_and_revoked_owner_is_never_exported(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "terminal-owner")
        terminal(case)
        before = case.repository.get(case.run.id)
        assert before is not None
        case.repository.terminal(case.run.id, {"replacement": True}, "f" * 16)
        after = case.repository.get(case.run.id)
        assert after is not None
        assert after.outer_trace == before.outer_trace
        assert after.root_span_id == before.root_span_id
        with case.sessions.begin() as session:
            app = session.get(App, case.run.app_id)
            assert app is not None
            app.tenant_id = identifier("moved-owner")
        assert claim(case) is None
        failed = case.repository.get(case.run.id)
        assert failed is not None
        assert failed.error_code == "tracing_owner_not_found"
        assert failed.state == "failed"
        case.repository.terminal(case.run.id, {"replacement": True}, "f" * 16)
        frozen = case.repository.get(case.run.id)
        assert frozen is not None
        assert frozen.outer_trace == before.outer_trace

    @staticmethod
    @pytest.mark.parametrize(
        ("state", "error"),
        [
            ("not_collected", "tracing_run_not_found"),
            ("accepted", "tracing_already_accepted"),
            ("collecting", "tracing_retry_not_allowed"),
        ],
    )
    def test_retry_rejects_ineligible_states(
        sqlite_session_factory: sessionmaker[Session], state: str, error: str
    ) -> None:
        case = seed(sqlite_session_factory, "retry-state")
        terminal(case)
        with case.sessions.begin() as session:
            row = session.get(ApplicationTraceRun, case.run.id)
            assert row is not None
            row.state = state
        with pytest.raises(TraceCollectionError, match=error):
            case.repository.retry(run_id=case.run.id, acknowledge_possible_duplicates=True)
        row = case.repository.get(case.run.id)
        assert row is not None
        assert row.state == state

    @staticmethod
    def test_retry_unknown_run_and_invocation_reject_before_creation(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        case = seed(sqlite_session_factory, "retry-unknown")
        with pytest.raises(TraceCollectionError, match="tracing_run_not_found"):
            case.repository.retry(run_id=identifier("missing"), acknowledge_possible_duplicates=True)
        with pytest.raises(TraceCollectionError, match="tracing_run_not_collecting"):
            case.repository.invocation(
                run_id=identifier("missing"),
                agent_id=identifier("agent"),
                node_execution_id=None,
                attempt=0,
                call_key="x",
            )
        assert case.repository.claim(identifier("missing"), collection_timeout=1, lease_seconds=1) is None

    @staticmethod
    def test_collection_without_terminal_is_not_exportable(sqlite_session_factory: sessionmaker[Session]) -> None:
        case = seed(sqlite_session_factory, "no-terminal")
        ingest(case, batch_for(case.run, case.invocation()))
        assert claim(case) is None
        row = case.repository.get(case.run.id)
        assert row is not None
        assert row.attempts == 0
        assert row.state == "collecting"

    @staticmethod
    def test_retention_removes_all_payload_rows_and_preserves_newer_runs(
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        expired = seed(sqlite_session_factory, "expired")
        fresh = seed(sqlite_session_factory, "fresh")
        for case in (expired, fresh):
            ingest(case, batch_for(case.run, case.invocation()))
        with expired.sessions.begin() as session:
            row = session.get(ApplicationTraceRun, expired.run.id)
            assert row is not None
            row.created_at = naive_utc_now() - timedelta(days=8)
        assert expired.repository.purge(retention_days=7) == 1
        assert expired.repository.get(expired.run.id) is None
        assert expired.repository.collected(expired.run.id) == ([], [])
        assert fresh.repository.get(fresh.run.id) is not None
        invocations, batches = fresh.repository.collected(fresh.run.id)
        assert len(invocations) == len(batches) == 1
        assert expired.repository.purge(retention_days=7) == 0
