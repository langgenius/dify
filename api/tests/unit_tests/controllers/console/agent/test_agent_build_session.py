"""Exercise the Build session routes with real admission, SQLite and Celery publication."""

from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from http import HTTPStatus
from uuid import uuid4

import pytest
from celery import Celery, current_app
from celery.signals import before_task_publish
from sqlalchemy import event, select
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import (
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import Conversation
from tasks.collect_agent_resources_task import collect_agent_resources
from tests.unit_tests.controllers.console.agent.test_api_access import Harness

pytest_plugins = ("tests.unit_tests.controllers.console.agent.test_api_access",)


@dataclass(frozen=True)
class BuildState:
    agent_id: str
    app_id: str
    draft_id: str
    other_draft_id: str
    shared_draft_id: str
    workspace_id: str
    binding_id: str
    home_id: str

    def request(self, harness: Harness, method: str, endpoint: str = "build-draft") -> TestResponse:
        """Call the actual Console route using the harness account's credentials."""
        return harness.client.open(
            f"/console/api/agent/{self.agent_id}/{endpoint}", method=method, headers=harness.headers
        )


@pytest.fixture
def build_state(harness: Harness) -> BuildState:
    """Persist an account-owned Build draft, its retained binding and unrelated drafts."""
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        home = AgentHomeSnapshot(tenant_id=harness.tenant_id, agent_id=agent_id, snapshot_ref="build-base")
        session.add(home)
        session.flush()
        draft, other, shared = [
            AgentConfigDraft(
                tenant_id=harness.tenant_id,
                agent_id=agent_id,
                draft_type=draft_type,
                account_id=owner,
                draft_owner_key=owner or "",
                created_by=owner,
                home_snapshot_id=home.id,
                config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": prompt}}),
            )
            for draft_type, owner, prompt in (
                (AgentConfigDraftType.DEBUG_BUILD, harness.account_id, "My draft"),
                (AgentConfigDraftType.DEBUG_BUILD, str(uuid4()), "Other account"),
                (AgentConfigDraftType.DRAFT, None, "Shared draft"),
            )
        ]
        session.add_all([draft, other, shared])
        session.flush()
        workspace = AgentWorkspace(
            tenant_id=harness.tenant_id,
            app_id=app_id,
            owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
            owner_id=draft.id,
            owner_scope_key="root",
            backend_workspace_ref="build-workspace",
        )
        session.add(workspace)
        session.flush()
        binding = AgentWorkspaceBinding(
            tenant_id=harness.tenant_id,
            app_id=app_id,
            workspace_id=workspace.id,
            agent_id=agent_id,
            base_home_snapshot_id=home.id,
            agent_config_version_id=draft.id,
            agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            backend_binding_ref="build-binding",
        )
        session.add(binding)
        session.flush()
        draft.agent_workspace_binding_id = binding.id
        return BuildState(agent_id, app_id, draft.id, other.id, shared.id, workspace.id, binding.id, home.id)


@pytest.fixture
def memory_broker() -> Iterator[None]:
    """Capture actual Celery publications without running a worker or touching a shared broker."""
    restore_app = current_app.set_current
    broker = Celery("agent-build-session-test", broker="memory://")
    broker.conf.update(task_always_eager=False, task_ignore_result=True, task_publish_retry=False)
    try:
        yield
    finally:
        broker.close()
        restore_app()


@contextmanager
def observe_collection_publication(listener: Callable[..., None]) -> Generator[None]:
    """Register a listener for this test and remove it when the request completes."""
    sender = collect_agent_resources.name
    before_task_publish.connect(listener, sender=sender)
    try:
        yield
    finally:
        before_task_publish.disconnect(listener, sender=sender)  # type: ignore[attr-defined]  # Missing from celery-types.


def test_get_build_draft_returns_only_current_accounts_draft(harness: Harness, build_state: BuildState) -> None:
    """Return the stored Soul and draft metadata without modifying drafts or conversations."""
    response = build_state.request(harness, "GET")
    assert response.status_code == HTTPStatus.OK
    with harness.sessions() as session:
        draft = session.get_one(AgentConfigDraft, build_state.draft_id)
        assert response.get_json() == {
            "variant": "agent_app",
            "draft": {
                "id": draft.id,
                "agent_id": build_state.agent_id,
                "draft_type": "debug_build",
                "account_id": harness.account_id,
                "base_snapshot_id": None,
                "created_by": harness.account_id,
                "updated_by": None,
                "created_at": int(draft.created_at.timestamp()),
                "updated_at": int(draft.updated_at.timestamp()),
            },
            "agent_soul": draft.config_snapshot_dict,
        }
        assert session.scalar(select(AgentDebugConversation.id)) is None

    with harness.sessions.begin() as session:
        session.delete(session.get_one(AgentConfigDraft, build_state.draft_id))
    missing = build_state.request(harness, "GET")
    assert missing.status_code == HTTPStatus.NOT_FOUND
    assert missing.get_json()["message"].startswith("Agent config version not found.")


def test_refresh_creates_the_first_mapping_for_an_agent_without_a_build_draft(harness: Harness) -> None:
    """Create a conversation for the admitted account without creating a draft."""
    agent_id, app_id = harness.create_agent()
    response = harness.client.post(f"/console/api/agent/{agent_id}/debug-conversation/refresh", headers=harness.headers)
    assert response.status_code == HTTPStatus.OK
    with harness.sessions() as session:
        mapping = session.scalar(select(AgentDebugConversation).where(AgentDebugConversation.agent_id == agent_id))
        assert mapping is not None
        assert mapping.account_id == harness.account_id
        assert mapping.app_id == app_id
        assert mapping.conversation_id == response.get_json()["debug_conversation_id"]
        assert session.scalar(select(AgentConfigDraft.id).where(AgentConfigDraft.agent_id == agent_id)) is None


@pytest.mark.parametrize(("method", "endpoint"), [("POST", "debug-conversation/refresh"), ("DELETE", "build-draft")])
def test_build_mutation_rejects_an_agent_from_another_workspace(harness: Harness, method: str, endpoint: str) -> None:
    """Use the admitted workspace even when the requesting account created the foreign Agent."""
    agent_id, app_id = harness.create_agent(tenant_id=str(uuid4()))
    response = harness.client.open(f"/console/api/agent/{agent_id}/{endpoint}", method=method, headers=harness.headers)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"].startswith("Agent not found.")
    with harness.sessions() as session:
        assert session.scalar(select(Conversation.id).where(Conversation.app_id == app_id)) is None


@pytest.mark.usefixtures("memory_broker")
@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_build_mutation_commits_before_enqueuing_binding_collection(
    harness: Harness, build_state: BuildState, method: str
) -> None:
    """Refresh clears the draft pointer and replaces the conversation; discard removes only that draft."""
    published: list[dict[str, object]] = []
    old_conversation_id = None
    if method == "POST":
        detail = harness.client.get(f"/console/api/agent/{build_state.agent_id}", headers=harness.headers)
        assert detail.status_code == HTTPStatus.OK
        old_conversation_id = detail.get_json()["debug_conversation_id"]

    def on_publish(body: tuple[object, dict[str, object], object], **_kwargs: object) -> None:
        """Verify independent readers can see the entire committed operation at publication."""
        with harness.sessions() as session:
            draft = session.get(AgentConfigDraft, build_state.draft_id)
            if method == "POST":
                assert draft is not None
                assert draft.agent_workspace_binding_id is None
                mapping = session.scalar(select(AgentDebugConversation))
                assert mapping is not None
                assert mapping.conversation_id != old_conversation_id
            else:
                assert draft is None
            assert (
                session.get_one(AgentWorkspaceBinding, build_state.binding_id).status
                == AgentWorkingResourceStatus.RETIRED
            )
            assert (
                session.get_one(AgentWorkspace, build_state.workspace_id).status == AgentWorkingResourceStatus.RETIRED
            )
        published.append(body[1])

    endpoint = "debug-conversation/refresh" if method == "POST" else "build-draft"
    with observe_collection_publication(on_publish):
        response = build_state.request(harness, method, endpoint)
        assert response.status_code == HTTPStatus.OK
        if method == "DELETE":
            assert response.get_json() == {"result": "success"}
            repeated = build_state.request(harness, method)
            assert repeated.status_code == HTTPStatus.OK
            assert repeated.get_json() == {"result": "success"}

    assert published == [
        {
            "tenant_id": harness.tenant_id,
            "binding_ids": [build_state.binding_id],
            "workspace_ids": [],
            "home_snapshot_ids": [],
            "purge_agent_ids": [],
        }
    ]
    with harness.sessions() as session:
        assert session.get(AgentConfigDraft, build_state.other_draft_id) is not None
        assert session.get(AgentConfigDraft, build_state.shared_draft_id) is not None
        assert session.get_one(AgentHomeSnapshot, build_state.home_id).status == AgentWorkingResourceStatus.ACTIVE
        if method == "POST":
            mapping = session.scalar(select(AgentDebugConversation))
            assert mapping is not None
            assert mapping.account_id == harness.account_id
            assert response.get_json() == {
                "debug_conversation_id": mapping.conversation_id,
                "debug_conversation_has_messages": False,
                "debug_conversation_message_count": 0,
            }
            conversation = session.get_one(Conversation, mapping.conversation_id)
            assert conversation.app_id == build_state.app_id
            assert conversation.from_account_id == harness.account_id
            assert old_conversation_id is not None
            assert session.get(Conversation, old_conversation_id) is not None


@pytest.mark.parametrize(("method", "endpoint"), [("POST", "debug-conversation/refresh"), ("DELETE", "build-draft")])
def test_build_mutation_rejects_a_binding_outside_the_draft_owner_scope(
    harness: Harness, build_state: BuildState, method: str, endpoint: str
) -> None:
    """Reject a foreign binding without changing the draft, binding or conversation."""
    with harness.sessions.begin() as session:
        session.get_one(AgentWorkspace, build_state.workspace_id).owner_id = build_state.other_draft_id
    response = build_state.request(harness, method, endpoint)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "agent_build_sandbox_not_found"
    with harness.sessions() as session:
        assert (
            session.get_one(AgentConfigDraft, build_state.draft_id).agent_workspace_binding_id == build_state.binding_id
        )
        assert (
            session.get_one(AgentWorkspaceBinding, build_state.binding_id).status == AgentWorkingResourceStatus.ACTIVE
        )
        assert session.scalar(select(Conversation.id)) is None


@pytest.mark.parametrize(("method", "endpoint"), [("POST", "debug-conversation/refresh"), ("DELETE", "build-draft")])
@pytest.mark.usefixtures("memory_broker")
def test_build_mutation_rolls_back_after_a_database_write_fails(
    harness: Harness, build_state: BuildState, method: str, endpoint: str
) -> None:
    """Fail a flushed retirement and verify rollback leaves the binding intact and emits no collection task."""
    published: list[object] = []

    def reject_build_write(session: Session, _flush_context: object) -> None:
        """Reject the transaction after the binding retirement SQL has executed."""
        if any(
            isinstance(row, AgentWorkspaceBinding) and row.status == AgentWorkingResourceStatus.RETIRED
            for row in session.dirty
        ):
            raise RuntimeError("Build write failed")

    def on_publish(**kwargs: object) -> None:
        """Record any unexpected attempt to enqueue collection."""
        published.append(kwargs)

    event.listen(harness.sessions, "after_flush", reject_build_write)
    try:
        with observe_collection_publication(on_publish):
            assert build_state.request(harness, method, endpoint).status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    finally:
        event.remove(harness.sessions, "after_flush", reject_build_write)

    assert published == []
    with harness.sessions() as session:
        assert (
            session.get_one(AgentConfigDraft, build_state.draft_id).agent_workspace_binding_id == build_state.binding_id
        )
        assert (
            session.get_one(AgentWorkspaceBinding, build_state.binding_id).status == AgentWorkingResourceStatus.ACTIVE
        )
        assert session.scalar(select(Conversation.id)) is None


@pytest.mark.parametrize(
    ("method", "endpoint"),
    [("GET", "build-draft"), ("DELETE", "build-draft"), ("POST", "debug-conversation/refresh")],
)
def test_build_routes_require_an_editing_role_when_rbac_is_off(
    harness: Harness, build_state: BuildState, method: str, endpoint: str
) -> None:
    """Preserve the editing-role gate on all three operations, including the draft read."""
    with harness.sessions.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account_id))
        assert membership is not None
        membership.role = TenantAccountRole.NORMAL
    assert build_state.request(harness, method, endpoint).status_code == HTTPStatus.FORBIDDEN
