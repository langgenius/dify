"""Business repairs revalidate persisted native success and current case ownership."""

import json
from dataclasses import dataclass
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session as SqlSession
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import DifyBuilderContext, EntryMode, Graph, MutationIntent, Run, Session, TestInput
from core.dify_builder.state import PcState
from graphon.enums import WorkflowExecutionStatus
from models.workflow import Workflow, WorkflowRun
from services.dify_builder import dify_port
from services.dify_builder.business_acceptance import confirm_testdata_contract, record_run_acceptance
from services.dify_builder.errors import PreflightError
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import executable_graph_revision, execution_revision
from services.workflow_service import WorkflowService
from tests.builder_agent_fixtures import AgentCase, make_case
from tests.unit_tests.core.dify_builder.test_verification import verified


@dataclass
class BusinessPortCase:
    owner: AgentCase
    session: Session
    context: DifyBuilderContext
    run: Run
    repository: SqlDifyBuilderRepository
    factory: sessionmaker[SqlSession]
    revision: str

    def apply(self) -> None:
        dify_port.WorkflowServiceDifyPort().apply_repair(
            self.owner.workflow.app_id,
            self.owner.actor,
            [MutationIntent(op="set_node_config", args={"node_id": "stats", "path": "template", "value": "350"})],
            expected_revision=self.revision,
            business_failure_run_id=self.run.id,
        )


@pytest.fixture
def case(sqlite_session_factory: sessionmaker[SqlSession], monkeypatch: pytest.MonkeyPatch) -> BusinessPortCase:
    graph: Graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
            {"id": "stats", "data": {"type": "template-transform", "title": "Total", "template": "0", "variables": []}},
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [{"variable": "total", "value_selector": ["stats", "output"]}],
                },
            },
        ],
        "edges": [{"source": "start", "target": "stats"}, {"source": "stats", "target": "end"}],
    }
    with sqlite_session_factory.begin() as sql:
        owner = make_case(sql)
        owner.workflow.graph = json.dumps(graph)
    revision = execution_revision(owner.workflow)
    session = Session(
        app_id=owner.workflow.app_id,
        tenant_id=owner.actor.tenant_id,
        owner_account_id=owner.actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_AWAIT_REPAIR,
    )
    context = DifyBuilderContext(goal_text="Return the confirmed total 350", checkpoint_seq=1)
    repo = SqlDifyBuilderRepository(sqlite_session_factory)
    repo.create_session(session, context, [])
    confirm_testdata_contract(
        session,
        context,
        {
            "business_acceptance_contract": {
                "confirmed": True,
                "cases": [
                    {
                        "id": "paid",
                        "inputs": {},
                        "checks": [{"path": ["total"], "operator": "equals", "expected": "350"}],
                    }
                ],
            },
            "acceptance_case_id": "paid",
        },
        {},
    )
    native_id = str(uuid4())
    run = verified(session_id=session.id, dify_run_id=native_id)
    run.id = str(uuid4())
    assert run.verification is not None
    assert run.verification.execution_evidence is not None
    run.verification.execution_evidence = run.verification.execution_evidence.model_copy(
        update={"native_run_id": native_id}
    )
    run.verification.execution_revision = revision
    run.verification.executed_graph_revision = executable_graph_revision(graph)
    run.verification.terminal_outputs = {"total": "0"}
    sample = TestInput(id=str(uuid4()), session_id=session.id, inputs={})
    repo.save_test_input(sample)
    run.inputs_ref = sample.id
    record_run_acceptance(session, context, run, sample, graph, revision)
    assert run.verification.business_acceptance["state"] == "failed"
    repo.save_run(session.id, run)
    repo.compare_and_advance(session.id, session.version, session.current_state, context, [])
    with sqlite_session_factory.begin() as sql:
        sql.add(
            WorkflowRun(
                id=native_id,
                tenant_id=owner.actor.tenant_id,
                app_id=owner.workflow.app_id,
                workflow_id=owner.workflow.id,
                type="workflow",
                triggered_from="debugging",
                version="draft",
                created_by=owner.actor.account_id,
                created_by_role="account",
                status="succeeded",
                graph=json.dumps(graph),
                elapsed_time=0,
                total_tokens=0,
            )
        )
    monkeypatch.setattr(dify_port, "_session_factory", lambda: sqlite_session_factory)
    monkeypatch.setattr(dify_port, "WorkflowService", lambda: WorkflowService(sqlite_session_factory))

    def sync(
        _app: object, new_graph: Graph, workflow: Workflow, _hash: str, _account: object, sql: SqlSession, _app_id: str
    ) -> Workflow:
        workflow.graph = json.dumps(new_graph)
        sql.commit()
        return workflow

    monkeypatch.setattr(dify_port, "_sync_graph_only", sync)
    monkeypatch.setattr(dify_port, "notify_workflow_draft_changed", lambda *_args, **_kwargs: None)
    return BusinessPortCase(owner, session, context, run, repo, sqlite_session_factory, revision)


def test_current_business_failure_writes_configuration_without_changing_successful_run(case: BusinessPortCase) -> None:
    saved = case.repository.get_run(case.run.id)
    case.apply()
    with case.factory() as sql:
        workflow = sql.get(Workflow, case.owner.workflow.id)
        assert workflow is not None
        assert workflow.graph_dict["nodes"][1]["data"]["template"] == "350"
    assert case.repository.get_run(case.run.id) == saved


@pytest.mark.parametrize(
    "change",
    [
        "owner",
        "tenant",
        "app",
        "contract",
        "native_status",
        "native_creator",
        "native_tenant",
        "native_app",
        "native_workflow",
        "native_graph",
    ],
)
def test_untrusted_or_stale_business_failure_cannot_write(case: BusinessPortCase, change: str) -> None:
    if change in {"owner", "tenant", "app", "contract"}:
        session, context = case.repository.get_session(case.session.id)
        if change == "contract":
            context.business_acceptance_run_refs = {}
            case.repository.compare_and_advance(session.id, session.version, session.current_state, context, [])
        else:
            from models.dify_builder import DifyBuilderSession

            with case.factory.begin() as sql:
                row = sql.get(DifyBuilderSession, session.id)
                assert row is not None
                if change == "owner":
                    row.owner_account_id = str(uuid4())
                elif change == "tenant":
                    row.tenant_id = str(uuid4())
                else:
                    row.app_id = str(uuid4())
    else:
        with case.factory.begin() as sql:
            native = sql.get(WorkflowRun, case.run.dify_run_id)
            assert native is not None
            if change == "native_status":
                native.status = WorkflowExecutionStatus.RUNNING
            elif change == "native_creator":
                native.created_by = str(uuid4())
            elif change == "native_tenant":
                native.tenant_id = str(uuid4())
            elif change == "native_app":
                native.app_id = str(uuid4())
            elif change == "native_workflow":
                native.workflow_id = str(uuid4())
            else:
                native.graph = json.dumps({"nodes": [], "edges": []})
    with pytest.raises(PreflightError):
        case.apply()
    with case.factory() as sql:
        workflow = sql.get(Workflow, case.owner.workflow.id)
        assert workflow is not None
        assert workflow.graph_dict["nodes"][1]["data"]["template"] == "0"


def test_business_case_is_rechecked_at_the_actual_write_boundary(
    case: BusinessPortCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = dify_port.new_preflight_problems

    def invalidate_case(before: Graph, after: Graph, touched: list[str]) -> list[str]:
        problems = original(before, after, touched)
        session, context = case.repository.get_session(case.session.id)
        context.business_acceptance_run_refs = {}
        case.repository.compare_and_advance(session.id, session.version, session.current_state, context, [])
        return problems

    monkeypatch.setattr(dify_port, "new_preflight_problems", invalidate_case)
    with pytest.raises(PreflightError, match="current confirmed failed business case"):
        case.apply()
    with case.factory() as sql:
        workflow = sql.get(Workflow, case.owner.workflow.id)
        assert workflow is not None
        assert workflow.graph_dict["nodes"][1]["data"]["template"] == "0"


def test_ambiguous_native_and_business_repair_authority_is_rejected(case: BusinessPortCase) -> None:
    with pytest.raises(PreflightError, match="one persisted repair evidence source"):
        dify_port.WorkflowServiceDifyPort().apply_repair(
            case.owner.workflow.app_id,
            case.owner.actor,
            [],
            expected_revision=case.revision,
            failed_run_id=case.run.dify_run_id,
            business_failure_run_id=case.run.id,
        )
