"""Agent deletion uses real admission and one transaction before external cleanup."""

from dataclasses import dataclass, field, replace
from http import HTTPStatus
from uuid import uuid4

import pytest
from celery import Celery
from celery import current_app as current_celery_app
from celery.signals import before_task_publish
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from constants.resource_access_token import ResourceAccessTokenResourceType
from events.app_event import app_was_deleted
from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import (
    Agent,
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.model import App, AppMode
from models.resource_access_token import ResourceAccessToken, ResourceAccessTokenRelation
from services.app.agent_app_service import AgentAppDeletionService
from services.app.console_gateway import AppLifecycleGateway
from services.entities.app_entities import AppDeletion, AppEvent
from tests.helpers.unit.config_override import config_overrides_context
from tests.unit_tests.controllers.console.agent.test_api_access import Harness

pytest_plugins = ("tests.unit_tests.controllers.console.agent.test_api_access",)


@dataclass
class RecordedCleanup:
    """Retain the real SQL adapter while recording the external cleanup boundary."""

    gateway: AppLifecycleGateway
    sessions: sessionmaker[Session]
    published: list[AppDeletion] = field(default_factory=list)

    def delete_agent(self, context: RequestContext, agent_id: str) -> AppDeletion:
        return self.gateway.delete_agent(context, agent_id)

    def deleted(self, context: RequestContext, deleted: AppDeletion) -> None:
        assert context.active_workspace_id == deleted.app.tenant_id
        with self.sessions() as session:
            assert session.get(App, deleted.app.id) is None
            assert deleted.backing_agent_id is not None
            agent = session.get(Agent, deleted.backing_agent_id)
            assert agent is not None
            assert agent.status == AgentStatus.ARCHIVED
        self.published.append(deleted)


@pytest.fixture
def cleanup(harness: Harness) -> RecordedCleanup:
    services = harness.client.application.extensions["application_services"]
    recorded = RecordedCleanup(gateway=AppLifecycleGateway(session_factory=harness.sessions), sessions=harness.sessions)
    harness.client.application.extensions["application_services"] = replace(
        services, agent_apps=replace(services.agent_apps, lifecycle=AgentAppDeletionService(lifecycle=recorded))
    )
    return recorded


def _create_access_token(harness: Harness, app_id: str) -> str:
    with harness.sessions.begin() as session:
        token = ResourceAccessToken(
            tenant_id=harness.tenant_id,
            name="API access",
            track_id=str(uuid4())[:24],
            token=str(uuid4()),
            created_by=harness.account_id,
        )
        session.add(token)
        session.flush()
        session.add(
            ResourceAccessTokenRelation(
                token_id=token.id, resource_type=ResourceAccessTokenResourceType.APP, app_id=app_id
            )
        )
        return token.id


def test_delete_archives_agent_and_removes_access_grants_before_cleanup(
    harness: Harness, cleanup: RecordedCleanup
) -> None:
    agent_id, app_id = harness.create_agent(published=True)
    token_id = _create_access_token(harness, app_id)

    response = harness.client.delete(f"/console/api/agent/{agent_id}", headers=harness.headers)

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""
    with harness.sessions() as session:
        assert session.get(App, app_id) is None
        agent = session.get(Agent, agent_id)
        assert agent is not None
        assert agent.status == AgentStatus.ARCHIVED
        assert agent.archived_by == harness.account_id
        assert session.get(ResourceAccessToken, token_id) is None
        assert (
            session.scalar(
                select(ResourceAccessTokenRelation.id).where(ResourceAccessTokenRelation.token_id == token_id)
            )
            is None
        )
    [published] = cleanup.published
    assert published.app.id == app_id
    assert published.app.tenant_id == harness.tenant_id
    assert published.backing_agent_id == agent_id


def test_delete_retires_resources_and_preserves_shared_tokens(harness: Harness, cleanup: RecordedCleanup) -> None:
    agent_id, app_id = harness.create_agent()
    shared_token_id = _create_access_token(harness, app_id)
    with harness.sessions.begin() as session:
        other_app = App(
            tenant_id=harness.tenant_id,
            name="Other app",
            mode=AppMode.CHAT,
            enable_site=False,
            enable_api=True,
        )
        session.add(other_app)
        session.flush()
        other_app_id = other_app.id
        session.add(
            ResourceAccessTokenRelation(
                token_id=shared_token_id, resource_type=ResourceAccessTokenResourceType.APP, app_id=other_app_id
            )
        )
        workspace = AgentWorkspace(
            tenant_id=harness.tenant_id,
            app_id=app_id,
            owner_type=AgentWorkspaceOwnerType.CONVERSATION,
            owner_id=str(uuid4()),
            owner_scope_key="",
            backend_workspace_ref="workspace-ref",
        )
        session.add(workspace)
        session.flush()
        binding = AgentWorkspaceBinding(
            tenant_id=harness.tenant_id,
            app_id=app_id,
            workspace_id=workspace.id,
            agent_id=agent_id,
            agent_config_version_id=str(uuid4()),
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
            backend_binding_ref="binding-ref",
        )
        snapshot = AgentHomeSnapshot(tenant_id=harness.tenant_id, agent_id=agent_id, snapshot_ref="snapshot-ref")
        session.add_all([binding, snapshot])
        session.flush()
        workspace_id, binding_id, snapshot_id = workspace.id, binding.id, snapshot.id

    response = harness.client.delete(f"/console/api/agent/{agent_id}", headers=harness.headers)

    assert response.status_code == HTTPStatus.NO_CONTENT
    with harness.sessions() as session:
        assert session.get(ResourceAccessToken, shared_token_id) is not None
        remaining = session.scalars(
            select(ResourceAccessTokenRelation).where(ResourceAccessTokenRelation.token_id == shared_token_id)
        ).all()
        assert [relation.app_id for relation in remaining] == [other_app_id]
        workspace = session.get(AgentWorkspace, workspace_id)
        binding = session.get(AgentWorkspaceBinding, binding_id)
        snapshot = session.get(AgentHomeSnapshot, snapshot_id)
        assert workspace is not None
        assert workspace.status == AgentWorkingResourceStatus.RETIRED
        assert binding is not None
        assert binding.status == AgentWorkingResourceStatus.RETIRED
        assert snapshot is not None
        assert snapshot.status == AgentWorkingResourceStatus.RETIRED
    [published] = cleanup.published
    # Retiring the last binding also retires its workspace; collection follows
    # the binding to that retired workspace.
    assert published.workspace_ids == []
    assert published.binding_ids == [binding_id]
    assert published.home_snapshot_ids == [snapshot_id]


def test_real_cleanup_publishes_tasks_after_commit(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    restore_app = current_celery_app.set_current
    broker = Celery("agent-app-delete-test", broker="memory://")
    broker.conf.update(task_always_eager=False, task_ignore_result=True, task_publish_retry=False)
    published: list[str] = []
    events: list[AppEvent] = []

    def on_publish(sender: str | None = None, **_kwargs: object) -> None:
        if sender is not None:
            with harness.sessions() as session:
                assert session.get(App, app_id) is None
            published.append(sender)

    def on_deleted(sender: object) -> None:
        assert isinstance(sender, AppEvent)
        with harness.sessions() as session:
            assert session.get(App, app_id) is None
        events.append(sender)

    before_task_publish.connect(on_publish)
    app_was_deleted.connect(on_deleted, weak=False)
    try:
        response = harness.client.delete(f"/console/api/agent/{agent_id}", headers=harness.headers)
    finally:
        app_was_deleted.disconnect(on_deleted)
        broker.close()
        restore_app()
    assert response.status_code == HTTPStatus.NO_CONTENT
    assert [event.id for event in events] == [app_id]
    assert any("remove_app_and_related_data" in name for name in published)
    assert any("collect_agent_resources" in name for name in published)


def test_delete_rejects_cross_tenant_and_wrong_app_mode(harness: Harness, cleanup: RecordedCleanup) -> None:
    foreign_id, foreign_app_id = harness.create_agent(tenant_id=str(uuid4()))
    wrong_mode_id, wrong_app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        app = session.get(App, wrong_app_id)
        assert app is not None
        app.mode = AppMode.CHAT

    for agent_id in (foreign_id, wrong_mode_id, str(uuid4())):
        assert (
            harness.client.delete(f"/console/api/agent/{agent_id}", headers=harness.headers).status_code
            == HTTPStatus.NOT_FOUND
        )
    with harness.sessions() as session:
        assert session.get(App, foreign_app_id) is not None
        assert session.get(App, wrong_app_id) is not None
    assert cleanup.published == []


def test_delete_rejects_member_before_mutation(harness: Harness, cleanup: RecordedCleanup) -> None:
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account_id))
        assert membership is not None
        membership.role = TenantAccountRole.NORMAL
    assert (
        harness.client.delete(f"/console/api/agent/{agent_id}", headers=harness.headers).status_code
        == HTTPStatus.FORBIDDEN
    )
    with harness.sessions() as session:
        assert session.get(App, app_id) is not None
    assert cleanup.published == []


def test_rbac_allows_agent_owner_with_normal_workspace_role(harness: Harness, cleanup: RecordedCleanup) -> None:
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account_id))
        assert membership is not None
        membership.role = TenantAccountRole.NORMAL
    with config_overrides_context(RBAC_ENABLED=True):
        response = harness.client.delete(f"/console/api/agent/{agent_id}", headers=harness.headers)
    assert response.status_code == HTTPStatus.NO_CONTENT
    with harness.sessions() as session:
        assert session.get(App, app_id) is None
    assert len(cleanup.published) == 1


def test_delete_rolls_back_grants_and_agent_when_app_write_fails(harness: Harness, cleanup: RecordedCleanup) -> None:
    agent_id, app_id = harness.create_agent()
    token_id = _create_access_token(harness, app_id)

    def reject_delete(_mapper: object, _connection: object, _target: object) -> None:
        raise RuntimeError("delete failed")

    event.listen(App, "before_delete", reject_delete)
    try:
        response = harness.client.delete(f"/console/api/agent/{agent_id}", headers=harness.headers)
    finally:
        event.remove(App, "before_delete", reject_delete)
    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    with harness.sessions() as session:
        assert session.get(App, app_id) is not None
        agent = session.get(Agent, agent_id)
        assert agent is not None
        assert agent.status == AgentStatus.ACTIVE
        assert session.get(ResourceAccessToken, token_id) is not None
        assert (
            session.scalar(
                select(ResourceAccessTokenRelation.id).where(ResourceAccessTokenRelation.token_id == token_id)
            )
            is not None
        )
    assert cleanup.published == []
