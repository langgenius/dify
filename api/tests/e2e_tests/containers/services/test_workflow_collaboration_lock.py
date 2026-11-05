"""Verify draft saves and collaboration admission serialize on PostgreSQL."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.engine import Connection
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from enums import DeploymentEdition
from extensions.ext_redis import redis_client
from models.account import Account
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository, WorkflowSessionInfo
from services import workflow_service as workflow_service_module
from services.errors.app import WorkflowCollaborationActiveError
from services.workflow_collaboration_service import WorkflowCollaborationService
from services.workflow_service import WorkflowService
from tests.helpers.unit.config_override import config_overrides_context


class _SocketBoundary:
    def __init__(self, user_id: str, tenant_id: str) -> None:
        self.user_id = user_id
        self.tenant_id = tenant_id
        self.manager = self

    def get_session(self, _sid: str) -> dict[str, str]:
        return {"user_id": self.user_id, "tenant_id": self.tenant_id}

    def is_connected(self, _sid: str, _namespace: str) -> bool:
        return True

    def enter_room(self, *_args: object, **_kwargs: object) -> None:
        pass

    def emit(self, *_args: object, **_kwargs: object) -> None:
        pass

    def start_background_task(self, *_args: object, **_kwargs: object) -> None:
        pass


def _short_lock_timeout(session: Session) -> None:
    @event.listens_for(session, "after_begin")
    def set_timeout(_session: Session, _transaction: SessionTransaction, connection: Connection) -> None:
        connection.exec_driver_sql("SET LOCAL lock_timeout = '300ms'")


def _expect_lock_timeout(action: Callable[[], object]) -> None:
    with pytest.raises(OperationalError) as error:
        action()
    assert getattr(error.value.orig, "pgcode", None) == "55P03"


def _exercise_save_and_join_lock(
    engine: Engine,
    repository: WorkflowCollaborationRepository,
    monkeypatch: pytest.MonkeyPatch,
    app_id: str,
    server_id: str,
) -> None:
    tenant_id, user_id, draft_id = (str(uuid4()) for _ in range(3))
    graph: dict[str, object] = {"nodes": [], "edges": []}
    newer_graph: dict[str, object] = {"nodes": [], "edges": [], "viewport": {"x": 1, "y": 2, "zoom": 1}}
    with Session(engine, expire_on_commit=False) as session:
        session.add(
            App(
                id=app_id,
                tenant_id=tenant_id,
                name="test",
                description="",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
                created_by=user_id,
            )
        )
        draft = Workflow(
            id=draft_id,
            tenant_id=tenant_id,
            app_id=app_id,
            type=WorkflowType.WORKFLOW,
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(graph),
            _features=json.dumps({}),
            created_by=user_id,
        )
        session.add(draft)
        session.commit()
        old_hash = draft.unique_hash

    monkeypatch.setattr(workflow_service_module, "WorkflowCollaborationRepository", lambda: repository)
    monkeypatch.setattr(workflow_service_module.app_draft_workflow_was_synced, "send", lambda *_a, **_kw: None)
    collaboration = WorkflowCollaborationService(repository, _SocketBoundary(user_id, tenant_id), server_id=server_id)
    save_service = WorkflowService(sessionmaker(bind=engine, expire_on_commit=False))

    def save(session: Session, graph_to_save: dict[str, object], draft_hash: str) -> Workflow:
        app = session.get(App, app_id)
        assert app is not None
        account = Account(name="test", email="test@example.com")
        account.id = user_id
        return save_service.sync_draft_workflow(
            app_model=app,
            graph=graph_to_save,
            features={"file_upload": {"enabled": False}},
            unique_hash=draft_hash,
            account=account,
            environment_variables=[],
            conversation_variables=[],
            session=session,
            sync_agent_bindings=False,
            reject_active_collaboration=True,
        )

    with config_overrides_context(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, ENABLE_COLLABORATION_MODE=True, RBAC_ENABLED=False
    ):
        entered = threading.Event()
        release = threading.Event()

        def blocked_save() -> str:
            with Session(engine, expire_on_commit=False) as session:

                @event.listens_for(session, "before_commit")
                def before_commit(_session: Session) -> None:
                    entered.set()
                    assert release.wait(5)

                return save(session, newer_graph, old_hash).unique_hash

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(blocked_save)
            assert entered.wait(5)
            try:
                with Session(engine) as session:
                    _short_lock_timeout(session)
                    _expect_lock_timeout(
                        lambda: collaboration.authorize_and_join_workflow_room(app_id, "sid-a", session=session)
                    )
                assert repository.get_session_sids(app_id) == []
            finally:
                release.set()
            current_hash = future.result(timeout=5)

        reached = threading.Event()
        release = threading.Event()
        original_set = repository.set_session_info

        def blocked_set(workflow_id: str, info: WorkflowSessionInfo) -> None:
            reached.set()
            assert release.wait(5)
            original_set(workflow_id, info)

        monkeypatch.setattr(repository, "set_session_info", blocked_set)

        def blocked_join() -> tuple[str, bool] | None:
            with Session(engine) as session:
                return collaboration.authorize_and_join_workflow_room(app_id, "sid-b", session=session)

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(blocked_join)
            assert reached.wait(5)
            try:
                with Session(engine) as session:
                    _short_lock_timeout(session)
                    _expect_lock_timeout(lambda: save(session, graph, current_hash))
            finally:
                release.set()
            assert future.result(timeout=5) == (user_id, True)

        with Session(engine) as session, pytest.raises(WorkflowCollaborationActiveError):
            save(session, graph, current_hash)
        with Session(engine) as session:
            saved = session.get(Workflow, draft_id)
            assert saved is not None
            assert saved.graph_dict == newer_graph


def test_join_and_full_save_serialize_on_the_draft(
    db_session_with_containers: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    repository = WorkflowCollaborationRepository()
    app_id, server_id = str(uuid4()), f"test-{uuid4()}"
    try:
        _exercise_save_and_join_lock(engine, repository, monkeypatch, app_id, server_id)
    finally:
        repository.delete_session(app_id, "sid-b")
        repository.delete_leader(app_id)
        redis_client.delete(repository.server_key(server_id), repository.server_sessions_key(server_id))
