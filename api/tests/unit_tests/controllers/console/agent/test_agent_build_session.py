"""Exercise the Build session routes with real admission, SQLite and Celery publication."""

import json
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from uuid import uuid4

import pytest
from celery import Celery, current_app
from celery.signals import before_task_publish
from sqlalchemy import event, select
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentHomeSnapshot,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import Conversation
from repositories.app.agent_debug_conversations import get_or_create_agent_debug_conversation
from tasks.collect_agent_resources_task import collect_agent_resources
from tests.helpers.unit.config_override import config_overrides_context
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
@pytest.mark.parametrize(
    ("method", "stale_generation", "archived_agent"),
    [
        ("POST", False, False),
        ("POST", True, False),
        ("DELETE", False, False),
        ("DELETE", False, True),
    ],
)
def test_build_mutation_commits_before_enqueuing_binding_collection(
    harness: Harness, build_state: BuildState, method: str, stale_generation: bool, archived_agent: bool
) -> None:
    """Refresh clears the draft pointer and replaces the conversation; discard removes only that draft."""
    with harness.sessions.begin() as session:
        if stale_generation:
            session.get_one(AgentWorkspaceBinding, build_state.binding_id).base_home_snapshot_id = None
        if archived_agent:
            session.get_one(Agent, build_state.agent_id).status = AgentStatus.ARCHIVED

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


@pytest.mark.usefixtures("memory_broker")
def test_discard_rejects_a_binding_from_an_older_generation(harness: Harness, build_state: BuildState) -> None:
    """Return the sandbox error and leave the draft and binding intact when the Home generation differs."""
    with harness.sessions.begin() as session:
        session.get_one(AgentWorkspaceBinding, build_state.binding_id).base_home_snapshot_id = None
    published: list[object] = []

    def on_publish(**kwargs: object) -> None:
        """Record any collection task emitted by the rejected request."""
        published.append(kwargs)

    with observe_collection_publication(on_publish):
        response = build_state.request(harness, "DELETE")

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "agent_build_sandbox_not_found"
    assert response.get_json()["status"] == HTTPStatus.NOT_FOUND
    assert published == []
    with harness.sessions() as session:
        draft = session.get_one(AgentConfigDraft, build_state.draft_id)
        assert draft.agent_workspace_binding_id == build_state.binding_id
        assert draft.home_snapshot_id == build_state.home_id
        binding = session.get_one(AgentWorkspaceBinding, build_state.binding_id)
        assert binding.status == AgentWorkingResourceStatus.ACTIVE
        assert session.get_one(AgentWorkspace, build_state.workspace_id).status == AgentWorkingResourceStatus.ACTIVE


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


def test_save_build_draft_preserves_omitted_files_and_normalizes_tool_ids(
    harness: Harness, build_state: BuildState
) -> None:
    """Update only the caller's draft and retain files until an explicit replacement is supplied."""
    file = {"name": "notes.md", "file_kind": "upload_file", "file_id": str(uuid4())}
    with harness.sessions.begin() as session:
        draft = session.get_one(AgentConfigDraft, build_state.draft_id)
        draft.config_snapshot = AgentSoulConfig.model_validate({"config_files": [file]})

    url = f"/console/api/agent/{build_state.agent_id}/build-draft"
    soul: dict[str, object] = {"tools": {"cli_tools": [{"name": "jq"}]}, "prompt": {"system_prompt": "Edited"}}
    payload = {"variant": "agent_app", "save_strategy": "save_to_current_version", "agent_soul": soul}
    saved = harness.client.put(url, headers=harness.headers, json=payload)

    assert saved.status_code == HTTPStatus.OK
    assert saved.get_json()["draft"]["id"] == build_state.draft_id
    assert saved.get_json()["agent_soul"]["config_files"][0]["file_id"] == file["file_id"]
    assert saved.get_json()["agent_soul"]["tools"]["cli_tools"][0]["id"]

    no_files: list[object] = []
    soul["config_files"] = no_files
    cleared = harness.client.put(url, headers=harness.headers, json=payload)
    assert cleared.status_code == HTTPStatus.OK
    assert cleared.get_json()["agent_soul"]["config_files"] == []
    with harness.sessions() as session:
        draft = session.get_one(AgentConfigDraft, build_state.draft_id)
        assert draft.config_snapshot_dict == cleared.get_json()["agent_soul"]
        assert draft.agent_workspace_binding_id == build_state.binding_id
        assert (
            session.get_one(AgentConfigDraft, build_state.shared_draft_id).config_snapshot_dict["prompt"][
                "system_prompt"
            ]
            == "Shared draft"
        )
        assert (
            session.get_one(AgentConfigDraft, build_state.other_draft_id).config_snapshot_dict["prompt"][
                "system_prompt"
            ]
            == "Other account"
        )


@pytest.mark.usefixtures("memory_broker")
def test_checkout_reuses_then_forces_and_recreates_personal_draft(harness: Harness, build_state: BuildState) -> None:
    """Reuse the personal Soul until forced, then replace it and collect its binding after commit."""
    url = f"/console/api/agent/{build_state.agent_id}/build-draft/checkout"
    published: list[object] = []

    def on_publish(body: tuple[object, dict[str, object], object], **_kwargs: object) -> None:
        """Observe that the reset draft and binding retirement are committed when the task is published."""
        with harness.sessions() as session:
            assert session.get_one(AgentConfigDraft, build_state.draft_id).agent_workspace_binding_id is None
            assert (
                session.get_one(AgentWorkspaceBinding, build_state.binding_id).status
                == AgentWorkingResourceStatus.RETIRED
            )
        published.append(body[1]["binding_ids"])

    with observe_collection_publication(on_publish):
        reused = harness.client.post(url, headers=harness.headers, json={})
        assert reused.status_code == HTTPStatus.OK
        assert reused.get_json()["agent_soul"]["prompt"]["system_prompt"] == "My draft"
        assert published == []
        forced = harness.client.post(url, headers=harness.headers, json={"force": True})
        assert forced.status_code == HTTPStatus.OK
        assert forced.get_json()["draft"]["id"] == build_state.draft_id
        assert forced.get_json()["agent_soul"]["prompt"]["system_prompt"] == "Shared draft"
        assert published == [[build_state.binding_id]]

    assert build_state.request(harness, "DELETE").status_code == HTTPStatus.OK
    created = harness.client.post(url, headers=harness.headers, json={})
    assert created.status_code == HTTPStatus.OK
    assert created.get_json()["draft"]["id"] != build_state.draft_id
    assert created.get_json()["draft"]["account_id"] == harness.account_id
    assert created.get_json()["agent_soul"]["prompt"]["system_prompt"] == "Shared draft"


@contextmanager
def checkpoint_backend(
    handler: Callable[[str, dict[str, object]], tuple[HTTPStatus, dict[str, object] | None]],
) -> Generator[str]:
    """Serve the actual Agent client protocol on a loopback port for the duration of the test."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            """Return the test scenario's response for the received Agent protocol request."""
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            status, response = handler(self.path, body)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            if response is not None:
                self.wfile.write(json.dumps(response).encode())

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            thread.join()


def _create_preview_binding(harness: Harness, build_state: BuildState) -> tuple[str, str]:
    """Create an active Preview participant for the shared draft's existing Home."""
    with harness.sessions.begin() as session:
        conversation_id = get_or_create_agent_debug_conversation(
            session,
            tenant_id=harness.tenant_id,
            agent_id=build_state.agent_id,
            backing_app_id=build_state.app_id,
            account_id=harness.account_id,
            draft_type=AgentConfigDraftType.DRAFT,
        )
        workspace = AgentWorkspace(
            tenant_id=harness.tenant_id,
            app_id=build_state.app_id,
            owner_type=AgentWorkspaceOwnerType.CONVERSATION,
            owner_id=conversation_id,
            owner_scope_key="root",
            backend_workspace_ref="preview-workspace",
        )
        session.add(workspace)
        session.flush()
        binding = AgentWorkspaceBinding(
            tenant_id=harness.tenant_id,
            app_id=build_state.app_id,
            agent_id=build_state.agent_id,
            workspace_id=workspace.id,
            agent_config_version_kind=AgentConfigVersionKind.DRAFT,
            agent_config_version_id=build_state.shared_draft_id,
            base_home_snapshot_id=build_state.home_id,
            backend_binding_ref="preview-binding",
        )
        session.add(binding)
        session.flush()
        session.get_one(Conversation, conversation_id).agent_workspace_binding_id = binding.id
        return conversation_id, binding.id


@pytest.mark.usefixtures("memory_broker")
@pytest.mark.parametrize("snapshot_ref", ["new-home", None], ids=["checkpoint", "image-fresh"])
def test_apply_checkpoints_without_a_connection_then_commits_before_collecting(
    harness: Harness,
    build_state: BuildState,
    snapshot_ref: str | None,
) -> None:
    """Apply the caller's Soul and retire Build and Preview bindings after a detached checkpoint."""
    conversation_id, preview_id = _create_preview_binding(harness, build_state)
    with harness.sessions.begin() as session:
        agent = session.get_one(Agent, build_state.agent_id)
        snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=session.get_one(AgentConfigDraft, build_state.shared_draft_id).config_snapshot,
            home_snapshot_id=build_state.home_id,
        )
        session.add(snapshot)
        session.flush()
        agent.active_config_snapshot_id = snapshot.id
        agent.active_config_is_published = True
        session.add(
            AgentConfigRevision(
                tenant_id=harness.tenant_id,
                agent_id=agent.id,
                current_snapshot_id=snapshot.id,
                revision=1,
                operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
            )
        )
    checked_out: set[object] = set()
    checkpoints: list[tuple[str, dict[str, object], int]] = []
    published: list[object] = []
    engine = harness.sessions.kw["bind"]

    def checkout(connection: object, *_args: object) -> None:
        """Track the SQLite connection held by application repositories."""
        checked_out.add(connection)

    def checkin(connection: object, *_args: object) -> None:
        """Record when the read connection has been returned."""
        checked_out.remove(connection)

    def checkpoint(path: str, body: dict[str, object]) -> tuple[HTTPStatus, dict[str, object]]:
        """Record the real checkpoint request and whether any repository session is open."""
        checkpoints.append((path, body, len(checked_out)))
        return HTTPStatus.CREATED, {"snapshot_ref": snapshot_ref}

    def on_publish(body: tuple[object, dict[str, object], object], **_kwargs: object) -> None:
        """Observe the committed shared Home and retirements before Celery publishes."""
        with harness.sessions() as session:
            assert session.get(AgentConfigDraft, build_state.draft_id) is None
            shared = session.get_one(AgentConfigDraft, build_state.shared_draft_id)
            assert shared.home_snapshot_id == (checkpoints[0][1]["home_snapshot_id"] if snapshot_ref else None)
            assert session.get_one(Conversation, conversation_id).agent_workspace_binding_id is None
            for binding_id in (preview_id, build_state.binding_id):
                assert session.get_one(AgentWorkspaceBinding, binding_id).status == AgentWorkingResourceStatus.RETIRED
        published.append(body[1]["binding_ids"])

    event.listen(engine, "checkout", checkout)
    event.listen(engine, "checkin", checkin)
    try:
        with (
            checkpoint_backend(checkpoint) as base_url,
            config_overrides_context(AGENT_BACKEND_BASE_URL=base_url),
            observe_collection_publication(on_publish),
        ):
            response = build_state.request(harness, "POST", "build-draft/apply")
    finally:
        event.remove(engine, "checkout", checkout)
        event.remove(engine, "checkin", checkin)

    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["draft"]["id"] == build_state.shared_draft_id
    [(path, body, connection_count)] = checkpoints
    assert path == "/home-snapshots/from-binding"
    assert connection_count == 0
    assert body["tenant_id"] == harness.tenant_id
    assert body["agent_id"] == build_state.agent_id
    assert body["backend_binding_ref"] == "build-binding"
    assert published == [sorted([preview_id, build_state.binding_id])]
    with harness.sessions() as session:
        shared = session.get_one(AgentConfigDraft, build_state.shared_draft_id)
        assert shared.config_snapshot_dict["prompt"]["system_prompt"] == "My draft"
        assert session.get(AgentConfigDraft, build_state.other_draft_id) is not None
        assert not session.get_one(Agent, build_state.agent_id).active_config_is_published
        if snapshot_ref is not None:
            assert shared.home_snapshot_id is not None
            assert session.get_one(AgentHomeSnapshot, shared.home_snapshot_id).snapshot_ref == snapshot_ref
        else:
            assert shared.home_snapshot_id is None


@pytest.mark.usefixtures("memory_broker")
def test_apply_rejects_a_concurrent_save_and_discards_the_unused_checkpoint(
    harness: Harness,
    build_state: BuildState,
) -> None:
    """Do not replace the shared draft if a save completes during the checkpoint request."""
    requests: list[tuple[str, dict[str, object]]] = []
    published: list[object] = []

    def backend(path: str, body: dict[str, object]) -> tuple[HTTPStatus, dict[str, object] | None]:
        """Commit a competing edit before the checkpoint completes and accept its later compensation."""
        requests.append((path, body))
        if path == "/home-snapshots/delete":
            return HTTPStatus.NO_CONTENT, None
        with harness.sessions.begin() as session:
            draft = session.get_one(AgentConfigDraft, build_state.draft_id)
            draft.config_snapshot = AgentSoulConfig.model_validate({"prompt": {"system_prompt": "Concurrent edit"}})
        return HTTPStatus.CREATED, {"snapshot_ref": "unused-home"}

    def on_publish(**kwargs: object) -> None:
        """Record any unexpected collection task."""
        published.append(kwargs)

    with (
        checkpoint_backend(backend) as base_url,
        config_overrides_context(AGENT_BACKEND_BASE_URL=base_url),
        observe_collection_publication(on_publish),
    ):
        response = build_state.request(harness, "POST", "build-draft/apply")

    assert response.status_code == HTTPStatus.CONFLICT
    assert response.get_json()["code"] == "agent_version_conflict_error"
    assert [path for path, _ in requests] == ["/home-snapshots/from-binding", "/home-snapshots/delete"]
    assert requests[1][1] == {"snapshot_ref": "unused-home"}
    assert published == []
    with harness.sessions() as session:
        draft = session.get_one(AgentConfigDraft, build_state.draft_id)
        assert draft.config_snapshot_dict["prompt"]["system_prompt"] == "Concurrent edit"
        assert draft.agent_workspace_binding_id == build_state.binding_id
        assert (
            session.get_one(AgentWorkspaceBinding, build_state.binding_id).status == AgentWorkingResourceStatus.ACTIVE
        )
        assert session.get_one(AgentConfigDraft, build_state.shared_draft_id).home_snapshot_id == build_state.home_id
        assert (
            session.scalar(select(AgentHomeSnapshot.id).where(AgentHomeSnapshot.snapshot_ref == "unused-home")) is None
        )


@pytest.mark.parametrize(
    ("backend_status", "api_status", "code"),
    [
        (HTTPStatus.NOT_FOUND, HTTPStatus.NOT_FOUND, "agent_build_sandbox_not_found"),
        (HTTPStatus.REQUEST_ENTITY_TOO_LARGE, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "agent_home_snapshot_too_large"),
        (HTTPStatus.BAD_GATEWAY, HTTPStatus.BAD_GATEWAY, "agent_home_snapshot_create_failed"),
    ],
)
def test_apply_preserves_backend_errors_without_changing_drafts(
    harness: Harness,
    build_state: BuildState,
    backend_status: HTTPStatus,
    api_status: HTTPStatus,
    code: str,
) -> None:
    """Translate backend checkpoint failures before writing either draft."""

    def backend(path: str, _body: dict[str, object]) -> tuple[HTTPStatus, dict[str, object]]:
        """Return a backend-authored failure for the checkpoint endpoint."""
        assert path == "/home-snapshots/from-binding"
        return backend_status, {"detail": {"code": "checkpoint_failed", "message": "checkpoint rejected"}}

    with checkpoint_backend(backend) as base_url, config_overrides_context(AGENT_BACKEND_BASE_URL=base_url):
        response = build_state.request(harness, "POST", "build-draft/apply")
    assert response.status_code == api_status
    assert response.get_json()["code"] == code
    if backend_status != HTTPStatus.NOT_FOUND:
        assert response.get_json()["message"] == "checkpoint rejected"
    with harness.sessions() as session:
        assert (
            session.get_one(AgentConfigDraft, build_state.draft_id).agent_workspace_binding_id == build_state.binding_id
        )
        assert session.get_one(AgentConfigDraft, build_state.shared_draft_id).home_snapshot_id == build_state.home_id
        assert (
            session.get_one(AgentWorkspaceBinding, build_state.binding_id).status == AgentWorkingResourceStatus.ACTIVE
        )


@pytest.mark.parametrize("operation", ["checkout", "apply"])
def test_build_draft_commands_reject_a_stale_sandbox(harness: Harness, build_state: BuildState, operation: str) -> None:
    """A stale binding cannot be used to replace or apply the personal draft."""
    with harness.sessions.begin() as session:
        session.get_one(AgentWorkspaceBinding, build_state.binding_id).base_home_snapshot_id = None

    attempts: list[str] = []

    def backend(path: str, _body: dict[str, object]) -> tuple[HTTPStatus, None]:
        """Record any unexpected checkpoint attempt."""
        attempts.append(path)
        return HTTPStatus.BAD_GATEWAY, None

    with checkpoint_backend(backend) as base_url, config_overrides_context(AGENT_BACKEND_BASE_URL=base_url):
        response = harness.client.post(
            f"/console/api/agent/{build_state.agent_id}/build-draft/{operation}",
            headers=harness.headers,
            json={"force": True} if operation == "checkout" else None,
        )

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "agent_build_sandbox_not_found"
    assert attempts == []
    with harness.sessions() as session:
        assert (
            session.get_one(AgentConfigDraft, build_state.draft_id).agent_workspace_binding_id == build_state.binding_id
        )
        assert (
            session.get_one(AgentWorkspaceBinding, build_state.binding_id).status == AgentWorkingResourceStatus.ACTIVE
        )


@pytest.mark.usefixtures("memory_broker")
def test_apply_rolls_back_after_checkpoint_when_the_database_write_fails(
    harness: Harness,
    build_state: BuildState,
) -> None:
    """Keep both drafts and the existing binding when a database write fails after checkpoint."""
    requests: list[str] = []
    published: list[object] = []

    def backend(path: str, _body: dict[str, object]) -> tuple[HTTPStatus, dict[str, object]]:
        """Record the checkpoint and any unexpected physical deletion."""
        requests.append(path)
        return HTTPStatus.CREATED, {"snapshot_ref": "orphaned-home"}

    def reject_insert(_mapper: object, _connection: object, _snapshot: AgentHomeSnapshot) -> None:
        """Fail the actual insert of the new checkpoint ledger row."""
        raise RuntimeError("Could not persist checkpoint")

    def on_publish(**kwargs: object) -> None:
        """Record any premature cleanup publication."""
        published.append(kwargs)

    event.listen(AgentHomeSnapshot, "before_insert", reject_insert)
    try:
        with (
            checkpoint_backend(backend) as base_url,
            config_overrides_context(AGENT_BACKEND_BASE_URL=base_url),
            observe_collection_publication(on_publish),
        ):
            response = build_state.request(harness, "POST", "build-draft/apply")
    finally:
        event.remove(AgentHomeSnapshot, "before_insert", reject_insert)

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert requests == ["/home-snapshots/from-binding"]
    assert published == []
    with harness.sessions() as session:
        assert (
            session.get_one(AgentConfigDraft, build_state.draft_id).agent_workspace_binding_id == build_state.binding_id
        )
        shared = session.get_one(AgentConfigDraft, build_state.shared_draft_id)
        assert shared.home_snapshot_id == build_state.home_id
        assert shared.config_snapshot_dict["prompt"]["system_prompt"] == "Shared draft"
        assert (
            session.get_one(AgentWorkspaceBinding, build_state.binding_id).status == AgentWorkingResourceStatus.ACTIVE
        )
        assert (
            session.scalar(select(AgentHomeSnapshot.id).where(AgentHomeSnapshot.snapshot_ref == "orphaned-home"))
            is None
        )
