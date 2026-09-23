"""Paused stops persist before publishing terminal events or retiring resources."""

import json
from collections.abc import Callable
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

import services.app_task_service as task_module
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.nodes.agent_v2.session_store import WorkflowAgentWorkspaceStore
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
from models import EndUser
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionTriggeredFrom, WorkflowPause, WorkflowRun
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.app_task_service import AppTaskService
from tests.unit_tests.services.test_app_task_service import _StopRedis


@pytest.mark.parametrize("app_mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
@pytest.mark.parametrize("backend", ["sql", "celery", "logstore"])
def test_paused_stop_publishes_terminal_event_after_commit_and_retires_run_resources(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    app_mode: AppMode,
    backend: str,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(
        CORE_WORKFLOW_EXECUTION_REPOSITORY={
            "sql": "core.repositories.sqlalchemy_workflow_execution_repository.SQLAlchemyWorkflowExecutionRepository",
            "celery": "core.repositories.celery_workflow_execution_repository.CeleryWorkflowExecutionRepository",
            "logstore": (
                "extensions.logstore.repositories.logstore_workflow_execution_repository."
                "LogstoreWorkflowExecutionRepository"
            ),
        }[backend],
        CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY={
            "sql": (
                "core.repositories.sqlalchemy_workflow_node_execution_repository."
                "SQLAlchemyWorkflowNodeExecutionRepository"
            ),
            "celery": (
                "core.repositories.celery_workflow_node_execution_repository.CeleryWorkflowNodeExecutionRepository"
            ),
            "logstore": (
                "extensions.logstore.repositories.logstore_workflow_node_execution_repository."
                "LogstoreWorkflowNodeExecutionRepository"
            ),
        }[backend],
        LOGSTORE_DUAL_WRITE_ENABLED=False,
    )
    monkeypatch.setattr(
        "repositories.sqlalchemy_api_workflow_run_repository.naive_utc_now", lambda: datetime(2026, 10, 10, 0, 1)
    )
    logstore = MagicMock()
    monkeypatch.setattr(
        "extensions.logstore.repositories.logstore_workflow_execution_repository.AliyunLogStore",
        MagicMock(return_value=logstore),
    )
    node_logstore = MagicMock()
    monkeypatch.setattr(
        "extensions.logstore.repositories.logstore_workflow_node_execution_repository.AliyunLogStore",
        MagicMock(return_value=node_logstore),
    )
    monkeypatch.setattr(
        "core.repositories.celery_workflow_node_execution_repository.save_workflow_node_executions_task.delay",
        MagicMock(),
    )
    queued_save = MagicMock()
    monkeypatch.setattr(
        "core.repositories.celery_workflow_execution_repository.save_workflow_execution_task.delay", queued_save
    )
    run = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
        created_at=datetime(2026, 10, 10),
        elapsed_time=1,
        total_tokens=0,
        total_steps=2,
        exceptions_count=0,
    )
    run.task_id = "11111111-1111-1111-1111-111111111111"
    pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="state")
    sqlite_session.add_all([run, pause])
    sqlite_session.commit()
    for node_app, origin in (
        ("app-1", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN),
        ("source-app", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL),
    ):
        SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=EndUser(id="user-1"),
            app_id=node_app,
            triggered_from=origin,
        ).save(
            WorkflowNodeExecution(
                id=f"node-{node_app}",
                node_execution_id=f"node-{node_app}",
                workflow_id=f"workflow-{node_app}",
                workflow_execution_id=run.id,
                index=1,
                node_id="review",
                node_type="human-input",
                title="Review",
                status=WorkflowNodeExecutionStatus.PAUSED,
                created_at=run.created_at,
            )
        )
    monkeypatch.setattr(task_module, "db", SimpleNamespace(engine=sqlite_session_factory.kw["bind"]))
    redis = MagicMock()
    monkeypatch.setattr(task_module, "redis_client", redis)
    monkeypatch.setattr("repositories.sqlalchemy_api_workflow_run_repository.storage.delete", MagicMock())
    calls: list[str] = []

    def retire(*, tenant_id: str, app_id: str, workflow_run_id: str) -> list[str]:
        assert (tenant_id, app_id, workflow_run_id) == ("tenant-1", "app-1", "run-1")
        with sqlite_session_factory() as session:
            persisted = session.get(WorkflowRun, workflow_run_id)
            assert persisted is not None
            assert persisted.status == WorkflowExecutionStatus.STOPPED
        calls.append("retire")
        return ["workspace-1"]

    monkeypatch.setattr(WorkflowAgentWorkspaceStore, "retire_workflow_run", staticmethod(retire))
    enqueue = MagicMock(side_effect=lambda **_: calls.append("collect"))
    monkeypatch.setattr("tasks.collect_agent_resources_task.enqueue_agent_resource_collection", enqueue)
    topic = MagicMock()
    topic.publish.side_effect = lambda _: calls.append("publish")
    monkeypatch.setattr(task_module.MessageBasedAppGenerator, "get_response_topic", lambda *_: topic)

    assert run.task_id is not None
    AppTaskService.stop_workflow_task(
        tenant_id="tenant-1",
        app_id="app-1",
        task_id=run.task_id,
        app_mode=app_mode,
        owner=(CreatorUserRole.END_USER, "user-1"),
    )

    assert calls == ["retire", "collect", "publish"]
    enqueue.assert_called_once_with(tenant_id="tenant-1", workspace_ids=["workspace-1"])
    event = json.loads(topic.publish.call_args.args[0])
    assert event["event"] == "workflow_finished"
    assert event["data"]["status"] == "stopped"
    assert event["data"]["elapsed_time"] == 60
    assert event["workflow_run_id"] == "run-1"
    assert event["task_id"] == run.task_id
    assert redis.mock_calls == []
    queued_save.assert_not_called()
    if backend == "logstore":
        history = dict(logstore.put_log.call_args.args[1])
        assert history["status"] == "stopped"
        assert (history["tenant_id"], history["app_id"], history["id"]) == ("tenant-1", "app-1", "run-1")
        node_history = [dict(call.args[1]) for call in node_logstore.put_log.call_args_list]
        assert all(float(record["elapsed_time"]) == 60 for record in node_history)
        assert {(record["app_id"], record["triggered_from"], record["status"]) for record in node_history} == {
            ("app-1", "workflow-run", "failed"),
            ("source-app", "workflow-tool", "failed"),
        }


@pytest.mark.parametrize("task_id_input", ["11111111-aaaa-1111-1111-111111111111", "11111111AAAA11111111111111111111"])
def test_stop_after_resume_claim_uses_durable_owner_before_queue_is_recreated(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    task_id_input: str,
) -> None:
    run = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
    )
    run.task_id = "11111111-aaaa-1111-1111-111111111111"
    pause = WorkflowPause(workflow_id=run.workflow_id, workflow_run_id=run.id, state_object_key="state")
    sqlite_session.add_all([run, pause])
    sqlite_session.commit()
    repository = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
    entity = repository.get_workflow_pause(run.id)
    assert entity is not None
    repository.resume_workflow_pause(run.id, entity)
    redis = _StopRedis()
    monkeypatch.setattr(task_module, "db", SimpleNamespace(engine=sqlite_session_factory.kw["bind"]))
    monkeypatch.setattr(task_module, "redis_client", redis)
    AppTaskService.stop_workflow_task(
        tenant_id="tenant-1",
        app_id="app-1",
        task_id=task_id_input,
        app_mode=AppMode.ADVANCED_CHAT,
        owner=(CreatorUserRole.END_USER, "user-1"),
    )
    assert redis.reads == []
    assert redis.values[f"generate_task_stopped:{run.task_id}"] == b"1"
    assert json.loads(redis.commands[f"workflow:{run.task_id}:commands"][0])["command_type"] == "abort"


@pytest.mark.parametrize(
    ("tenant_id", "app_id", "owner"),
    [
        ("other-tenant", "app-1", None),
        ("tenant-1", "other-app", None),
        ("tenant-1", "app-1", (CreatorUserRole.END_USER, "other-user")),
        ("tenant-1", "app-1", (CreatorUserRole.ACCOUNT, "user-1")),
    ],
)
def test_running_task_admission_rejects_foreign_tenant_app_user_and_role(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    app_id: str,
    owner: tuple[CreatorUserRole, str] | None,
) -> None:
    task_id = "22222222-2222-2222-2222-222222222222"
    run = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        task_id=task_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.RUNNING,
        created_by_role=CreatorUserRole.END_USER,
        created_by="user-1",
    )
    sqlite_session.add(run)
    sqlite_session.commit()
    monkeypatch.setattr(task_module, "db", SimpleNamespace(engine=sqlite_session_factory.kw["bind"]))
    redis = _StopRedis(values={f"generate_task_belong:{task_id}": b"end-user-user-1"})
    monkeypatch.setattr(task_module, "redis_client", redis)
    AppTaskService.stop_workflow_task(
        tenant_id=tenant_id, app_id=app_id, task_id=task_id, app_mode=AppMode.WORKFLOW, owner=owner
    )
    sqlite_session.expire_all()
    assert run.status == WorkflowExecutionStatus.RUNNING
    assert run.stop_requested_at is None
    assert redis.reads == []
    assert redis.operations == []
