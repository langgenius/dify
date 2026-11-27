"""External waits survive the real SQL/checkpoint boundary and Console wire projection."""

import json
from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowPausedEvent
from core.app.entities.task_entities import AppStreamResponse, StreamResponse, WorkflowAppStreamResponse
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.workflow.system_variables import build_system_variables
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import ExternalWaitReason
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import RuntimeState, VariablePool
from models.account import Account
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowPauseReason, WorkflowRun, WorkflowType
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.workflow_pause_service import load_workflow_pause_snapshot


def _wire(responses: list[StreamResponse], run_id: str) -> list[dict[str, object] | str]:
    def chunks() -> Generator[AppStreamResponse]:
        for response in responses:
            yield WorkflowAppStreamResponse(workflow_run_id=run_id, stream_response=response)

    return list(WorkflowAppGenerateResponseConverter.convert_stream_full_response(chunks()))


@pytest.mark.parametrize("invoke_from", [InvokeFrom.DEBUGGER, InvokeFrom.SERVICE_API])
def test_external_pause_checkpoint_and_live_response_keep_identity_without_human_input(
    sqlite_session_factory: sessionmaker[Session],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    invoke_from: InvokeFrom,
) -> None:
    """A remote wait is a resumable checkpoint, never an approval-form record or SSE error."""
    monkeypatch.setattr(storage, "storage_runner", OpenDALStorage(scheme="fs", root=str(tmp_path)), raising=False)
    run_id, workflow_id, app_id, tenant_id, user_id = (str(uuid4()) for _ in range(5))
    run = WorkflowRun(
        id=run_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="draft",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.RUNNING,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=user_id,
    )
    with sqlite_session_factory.begin() as session:
        session.add(run)
    generate = WorkflowAppGenerateEntity(
        user_from=UserFrom.ACCOUNT,
        task_id="task",
        workflow_execution_id=run_id,
        user_id=user_id,
        inputs={},
        files=[],
        stream=True,
        invoke_from=invoke_from,
        app_config=WorkflowUIBasedAppConfig(
            app_id=app_id, tenant_id=tenant_id, workflow_id=workflow_id, app_mode=AppMode.WORKFLOW
        ),
    )
    reason = ExternalWaitReason(
        wait_id="invocation", node_id="external", node_title="External", execution_id="execution", frame_id="root"
    )
    state = RuntimeState(workflow_id=workflow_id, variable_pool=VariablePool(), start_at=0)
    state.graph_execution.pause_reasons.append(reason)
    context = WorkflowResumptionContext(
        generate_entity=_WorkflowGenerateEntityWrapper(entity=generate),
        serialized_graph_runtime_state=state.dumps(),
    )
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    pause = repository.create_workflow_pause(run_id, user_id, context.dumps(), [reason])
    with sqlite_session_factory() as session:
        persisted = session.get(WorkflowRun, run_id)
        assert persisted is not None
        assert persisted.status == WorkflowExecutionStatus.PAUSED
        assert session.scalar(select(func.count()).select_from(WorkflowPauseReason)) == 0
    snapshot = load_workflow_pause_snapshot(pause, session_factory=sqlite_session_factory)
    assert tuple(snapshot.reasons) == (reason,)
    assert snapshot.v2_forms == {}
    assert pause.get_state().decode() == context.dumps()

    account = Account(name="Owned test", email="owned@example.test")
    account.id = user_id
    converter = WorkflowResponseConverter(
        application_generate_entity=generate,
        user=account,
        system_variables=build_system_variables(user_id=user_id, app_id=app_id, workflow_id=workflow_id),
    )
    started = converter.workflow_start_to_stream_response(
        task_id="task", workflow_run_id=run_id, workflow_id=workflow_id, reason=WorkflowStartReason.INITIAL
    )
    paused = converter.workflow_pause_to_stream_response(
        event=QueueWorkflowPausedEvent(reasons=snapshot.reasons, outputs={}, paused_nodes=["external"]),
        task_id="task",
        graph_runtime_state=snapshot.runtime_state,
    )
    events = json.loads(json.dumps(_wire([started, *paused], run_id)))
    assert [item["event"] for item in events] == ["workflow_started", "workflow_paused"]
    assert events[-1]["data"]["status"] == "paused"
    assert events[-1]["data"]["paused_nodes"] == ["external"]
    assert events[-1]["data"]["reasons"] == [reason.model_dump(mode="json")]
    assert "form_id" not in events[-1]["data"]["reasons"][0]

    repository.resume_workflow_pause(run_id, pause)
    resumed = converter.workflow_start_to_stream_response(
        task_id="task", workflow_run_id=run_id, workflow_id=workflow_id, reason=WorkflowStartReason.RESUMPTION
    )
    snapshot.runtime_state.set_output("text", "owned result")
    finished = converter.workflow_finish_to_stream_response(
        task_id="task",
        workflow_id=workflow_id,
        status=WorkflowExecutionStatus.SUCCEEDED,
        graph_runtime_state=snapshot.runtime_state,
    )
    completed = json.loads(json.dumps(_wire([resumed, finished], run_id)))
    assert [item["event"] for item in completed] == ["workflow_started", "workflow_finished"]
    assert completed[0]["data"]["reason"] == "resumption"
    assert completed[-1]["data"]["status"] == "succeeded"
    assert completed[-1]["data"]["outputs"] == {"text": "owned result"}
    assert {item["workflow_run_id"] for item in events + completed} == {run_id}
