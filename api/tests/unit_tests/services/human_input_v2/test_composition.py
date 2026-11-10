from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from core.db.session_factory import session_factory
from core.helper import encrypter
from core.human_input_v2.shared.values import AccountId, TenantId
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input_v2.events import NodeRunHumanInputV2FormRequiredEvent
from core.workflow.system_variables import SystemVariableKey, system_variable_selector
from enums import DeploymentEdition
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import GraphRunPausedEvent, GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.enums import WorkflowExecutionStatus
from graphon.graph import Graph
from graphon.runtime import InitParams, RuntimeState, VariablePool
from models import CreatorUserRole
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import WorkflowRunTriggeredFrom
from models.human_input_v2 import ContactSubjectType, HumanInputContactIdentity, HumanInputForm
from models.workflow import WorkflowPause, WorkflowRun, WorkflowType
from services.human_input_v2.submission_service import HumanInputSubmissionService
from tasks.app_generate.workflow_execute_task import resume_app_execution
from tasks.human_input_im_card_tasks import update_human_input_im_card_task


@dataclass(frozen=True)
class _ContainerWorkflow:
    tenant_id: TenantId
    app_id: str
    run_id: str
    account_id: AccountId


@pytest.fixture
def container_workflow(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> _ContainerWorkflow:
    workflow = _ContainerWorkflow(TenantId(str(uuid4())), str(uuid4()), str(uuid4()), AccountId(str(uuid4())))
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(encrypter, "encrypt_token", lambda _tenant, token: cipher.encrypt(token.encode()).decode())
    monkeypatch.setattr(encrypter, "decrypt_token", lambda _tenant, token: cipher.decrypt(token.encode()).decode())
    monkeypatch.setattr(update_human_input_im_card_task, "apply_async", lambda **_kwargs: None)
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Workspace")
        tenant.id = workflow.tenant_id
        account = Account(name="Approver", email="approver@example.com", status=AccountStatus.ACTIVE)
        account.id = workflow.account_id
        session.add_all(
            [
                tenant,
                account,
                TenantAccountJoin(
                    tenant_id=workflow.tenant_id, account_id=workflow.account_id, role=TenantAccountRole.NORMAL
                ),
                HumanInputContactIdentity(subject_type=ContactSubjectType.ACCOUNT, account_id=workflow.account_id),
                WorkflowRun(
                    id=workflow.run_id,
                    tenant_id=workflow.tenant_id,
                    app_id=workflow.app_id,
                    workflow_id="workflow",
                    type=WorkflowType.WORKFLOW,
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                    version="1",
                    status=WorkflowExecutionStatus.RUNNING,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=workflow.account_id,
                ),
            ]
        )
    return workflow


def _container_graph_config(kind: Literal["iteration", "parallel", "loop"]) -> dict[str, object]:
    is_loop = kind == "loop"
    container_type = "loop" if is_loop else "iteration"
    context_variable = "answer" if is_loop else "item"
    container: dict[str, object] = {"type": container_type, "title": "Review items", "start_node_id": "child-start"}
    if is_loop:
        container.update(
            loop_count=2,
            break_conditions=[],
            logical_operator="and",
            loop_variables=[{"label": "answer", "var_type": "string", "value_type": "constant", "value": "initial"}],
        )
    else:
        container.update(
            iterator_selector=["start", "items"],
            output_selector=["approval", "answer"],
            is_parallel=kind == "parallel",
            parallel_nums=2,
        )
    nodes = [
        {"id": "start", "data": {"type": "start", "title": "Start", "variables": list[object]()}},
        {"id": "container", "data": container},
        {
            "id": "child-start",
            "parentId": "container",
            "data": {"type": f"{container_type}-start", "title": "Container start"},
        },
        {
            "id": "approval",
            "parentId": "container",
            "data": {
                "type": "human-input",
                "version": "2",
                "title": "Approval",
                "recipients_spec": [{"type": "initiator"}],
                "message_template": {"subject": "Review", "body": "Open {{#url#}}"},
                "debug_mode": {"enabled": False, "channels": list[str]()},
                "form_content": "Review {{#container." + context_variable + "#}}: {{#$output.answer#}}",
                "inputs": [{"type": "paragraph", "output_variable_name": "answer"}],
                "user_actions": [{"id": "approve", "title": "Approve"}],
            },
        },
        {
            "id": "end",
            "data": {
                "type": "end",
                "title": "End",
                "outputs": [{"variable": "result", "value_selector": ["container", "answer" if is_loop else "output"]}],
            },
        },
    ]
    edges = [
        {"source": "start", "target": "container"},
        {"source": "container", "target": "end"},
        {"source": "child-start", "target": "approval"},
    ]
    if is_loop:
        nodes.append(
            {
                "id": "save-answer",
                "parentId": "container",
                "data": {
                    "type": "assigner",
                    "version": "2",
                    "title": "Save answer for next round",
                    "items": [
                        {
                            "variable_selector": ["container", "answer"],
                            "input_type": "variable",
                            "operation": "over-write",
                            "value": ["approval", "answer"],
                        }
                    ],
                },
            }
        )
        edges.append({"source": "approval", "target": "save-answer", "sourceHandle": "approve"})
    return {"nodes": nodes, "edges": edges}


@pytest.mark.parametrize("kind", ["iteration", "parallel", "loop"])
@pytest.mark.parametrize("container_debug", [False, True], ids=["workflow-run", "container-debug"])
def test_container_approvals_resume_from_checkpoints_with_independent_forms(
    container_workflow: _ContainerWorkflow,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    kind: Literal["iteration", "parallel", "loop"],
    container_debug: bool,
) -> None:
    workflow = container_workflow
    monkeypatch.setattr(session_factory, "create_session", sqlite_session_factory)
    enqueue_calls: list[dict[str, object]] = []

    def enqueue(*, kwargs: dict[str, object]) -> None:
        enqueue_calls.append(kwargs)

    monkeypatch.setattr(resume_app_execution, "apply_async", enqueue)
    graph_config = _container_graph_config(kind)
    params = InitParams(
        workflow_id="workflow",
        graph_config=graph_config,
        run_context=build_dify_run_context(
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            user_id=workflow.account_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER if container_debug else InvokeFrom.EXPLORE,
        ),
        call_depth=0,
    )
    pool = VariablePool()
    pool.add(system_variable_selector(SystemVariableKey.WORKFLOW_EXECUTION_ID), workflow.run_id)
    pool.add(["start", "items"], ["first", "second"])
    state = RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=0)
    submissions = HumanInputSubmissionService(session_factory=sqlite_session_factory)
    accepted_form_ids: set[str] = set()
    completed_answers: list[str] = []
    pending_tokens: dict[str, str] = {}
    for _ in range(3):
        graph = Graph.init(
            graph_config=graph_config,
            node_factory=DifyNodeFactory(params, state),
            root_node_id="container" if container_debug else "start",
            skip_validation=container_debug,
        )
        events = list(Engine(graph=graph, runtime_state=state, command_channel=InMemoryChannel(), workers=2).run())
        for event in events:
            if isinstance(event, NodeRunHumanInputV2FormRequiredEvent):
                prepared = event.prepared_form
                assert prepared.form_token is not None
                pending_tokens[prepared.form.id] = prepared.form_token.get_secret_value()
            if isinstance(event, NodeRunSucceededEvent) and event.node_id == "approval":
                completed_answers.append(event.node_run_result.outputs["answer"].value)
        if isinstance(events[-1], GraphRunSucceededEvent):
            break
        assert isinstance(events[-1], GraphRunPausedEvent)
        checkpoint = state.dumps()
        with sqlite_session_factory.begin() as session:
            run = session.get(WorkflowRun, workflow.run_id)
            assert run is not None
            run.status = WorkflowExecutionStatus.PAUSED
            if session.scalar(select(WorkflowPause).where(WorkflowPause.workflow_run_id == workflow.run_id)) is None:
                session.add(
                    WorkflowPause(
                        workflow_id="workflow", workflow_run_id=workflow.run_id, state_object_key="checkpoint"
                    )
                )
            waiting = list(
                session.scalars(
                    select(HumanInputForm).where(
                        HumanInputForm.workflow_run_id == workflow.run_id,
                        HumanInputForm.status == HumanInputFormStatus.WAITING,
                    )
                )
            )
            assert waiting
            form = waiting[0]
            content = form.resolved_form.legacy_form_content
            answer = {
                "Review first: {{#$output.answer#}}": "approved-first",
                "Review second: {{#$output.answer#}}": "approved-second",
                "Review initial: {{#$output.answer#}}": "approved-initial",
                "Review approved-initial: {{#$output.answer#}}": "approved-approved-initial",
            }[content]
            form_id = form.id
        assert form_id not in accepted_form_ids
        submissions.submit_console_form(
            account_id=workflow.account_id,
            form_token=pending_tokens[form_id],
            action="approve",
            inputs={"answer": answer},
        )
        accepted_form_ids.add(form_id)
        state = RuntimeState.from_snapshot(checkpoint)
    assert isinstance(events[-1], GraphRunSucceededEvent)
    expected_answers = (
        ["approved-initial", "approved-approved-initial"] if kind == "loop" else ["approved-first", "approved-second"]
    )
    assert sorted(completed_answers) == sorted(expected_answers)
    assert state.outputs["result"] == (
        "approved-approved-initial" if kind == "loop" else ["approved-first", "approved-second"]
    )
    with sqlite_session_factory() as session:
        forms = list(session.scalars(select(HumanInputForm).where(HumanInputForm.workflow_run_id == workflow.run_id)))
        assert len(forms) == 2
        assert len({form.node_execution_id for form in forms}) == 2
        assert all(form.status == HumanInputFormStatus.SUBMITTED for form in forms)
    assert len(enqueue_calls) == 2
