from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID
from dify_agent.protocol.snapshot import SessionSnapshot
from pydantic import JsonValue
from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.agent.workspace import WorkspaceOwnerScope
from core.app.apps.agent_app.session_store import (
    AgentAppDirectReplyTurn,
    AgentAppSessionScope,
    AgentAppWorkspaceStore,
    append_direct_reply_turns,
)
from models.agent import (
    AgentConfigVersionKind,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.enums import ConversationFromSource
from models.model import App, AppAnnotationHitHistory, AppMode, Conversation, Message
from services.agent.workspace_service import AgentWorkspaceNotFoundError, AgentWorkspaceService


def _scope(
    *,
    kind: AgentConfigVersionKind = AgentConfigVersionKind.SNAPSHOT,
    build_draft_id: str | None = None,
    home_snapshot_id: str | None = "home-1",
) -> AgentAppSessionScope:
    return AgentAppSessionScope(
        tenant_id="tenant-1",
        app_id="app-1",
        conversation_id="conversation-1",
        agent_id="agent-1",
        agent_config_snapshot_id="config-1",
        home_snapshot_id=home_snapshot_id,
        agent_config_version_kind=kind,
        build_draft_id=build_draft_id,
    )


def _binding() -> AgentWorkspaceBinding:
    return AgentWorkspaceBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workspace_id="workspace-1",
        backend_binding_ref="backend-binding-1",
        agent_id="agent-1",
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        base_home_snapshot_id="home-1",
        session_snapshot=None,
        pending_form_id=None,
        pending_tool_call_id=None,
    )


def _persist_conversation(session: Session, *, binding_id: str | None = None) -> Conversation:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Agent App",
        description="",
        mode=AppMode.AGENT_CHAT,
        icon_type=None,
        icon=None,
        icon_background=None,
        app_model_config_id=None,
        workflow_id=None,
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
        created_by=None,
    )
    conversation = Conversation(
        id="conversation-1",
        app_id=app.id,
        app_model_config_id=None,
        agent_workspace_binding_id=binding_id,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.AGENT_CHAT,
        name="Agent conversation",
        summary=None,
        _inputs={},
        introduction="",
        system_instruction="",
        invoke_from=None,
        from_source=ConversationFromSource.API,
        from_end_user_id="user-1",
        from_account_id=None,
        read_at=None,
        read_account_id=None,
    )
    session.add_all([app, conversation])
    session.commit()
    return conversation


def test_scope_selects_conversation_or_build_draft_workspace_owner() -> None:
    assert _scope().workspace_owner.owner_type is AgentWorkspaceOwnerType.CONVERSATION
    build_owner = _scope(
        kind=AgentConfigVersionKind.BUILD_DRAFT,
        build_draft_id="build-draft-1",
    ).workspace_owner
    assert build_owner.owner_type is AgentWorkspaceOwnerType.BUILD_DRAFT
    assert build_owner.owner_id == "build-draft-1"


@pytest.mark.parametrize("home_snapshot_id", ["home-1", None])
def test_load_or_create_persists_new_binding_on_caller(
    monkeypatch: pytest.MonkeyPatch,
    home_snapshot_id: str | None,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_conversation(sqlite_session)
    create = MagicMock(return_value=_binding())
    store = AgentAppWorkspaceStore()
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    stored = store.load_or_create(_scope(home_snapshot_id=home_snapshot_id))

    assert stored.binding_id == "binding-1"
    assert stored.workspace_id == "workspace-1"
    assert stored.backend_binding_ref == "backend-binding-1"
    assert isinstance(create.call_args.kwargs["session"], Session)
    assert create.call_args.kwargs["base_home_snapshot_id"] == home_snapshot_id
    with sqlite_session_factory() as observer:
        caller = observer.get(Conversation, "conversation-1")
        assert caller is not None
        assert caller.agent_workspace_binding_id == "binding-1"


def test_load_or_create_uses_exact_caller_binding(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _persist_conversation(sqlite_session, binding_id="binding-1")
    get_binding = MagicMock(return_value=_binding())
    create = MagicMock()
    store = AgentAppWorkspaceStore()
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_binding)
    monkeypatch.setattr(AgentWorkspaceService, "validate_binding_generation", MagicMock())
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    stored = store.load_or_create(_scope())

    assert stored.binding_id == "binding-1"
    assert get_binding.call_args.kwargs["binding_id"] == "binding-1"
    create.assert_not_called()


def test_normal_conversation_pointer_does_not_create_replacement_binding(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _persist_conversation(sqlite_session, binding_id="unavailable-binding")
    get_binding = MagicMock(return_value=None)
    create = MagicMock()
    store = AgentAppWorkspaceStore()
    monkeypatch.setattr(AgentWorkspaceService, "get_active_binding", get_binding)
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create)

    with pytest.raises(AgentWorkspaceNotFoundError, match="Caller participant Binding is unavailable"):
        store.load_or_create(_scope())

    assert get_binding.call_args.kwargs["binding_id"] == "unavailable-binding"
    create.assert_not_called()


def test_save_snapshot_targets_binding(monkeypatch: pytest.MonkeyPatch) -> None:
    save = MagicMock()
    monkeypatch.setattr(AgentWorkspaceService, "save_binding_session_snapshot", save)
    snapshot = SessionSnapshot(layers={})

    AgentAppWorkspaceStore().save_active_snapshot(scope=_scope(), binding_id="binding-1", snapshot=snapshot)

    assert save.call_args.kwargs["binding_id"] == "binding-1"
    assert save.call_args.kwargs["session_snapshot"] == snapshot.model_dump_json()


def _history_json(*messages: ModelMessage) -> list[JsonValue]:
    return ModelMessagesTypeAdapter.dump_python(list(messages), mode="json")


def _history(snapshot: SessionSnapshot | None) -> list[ModelMessage]:
    assert snapshot is not None
    return ModelMessagesTypeAdapter.validate_python(snapshot.layers[DIFY_AGENT_HISTORY_LAYER_ID]["messages"])


def _turn_text(messages: list[ModelMessage]) -> list[tuple[str, str]]:
    """Flatten user prompts and text replies so assertions read as a transcript."""
    transcript: list[tuple[str, str]] = []
    for message in messages:
        if isinstance(message, ModelRequest):
            transcript.extend(("user", str(part.content)) for part in message.parts if isinstance(part, UserPromptPart))
        else:
            transcript.extend(("assistant", part.content) for part in message.parts if isinstance(part, TextPart))
    return transcript


def _workspace() -> AgentWorkspace:
    owner = WorkspaceOwnerScope(
        tenant_id="tenant-1",
        app_id="app-1",
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id="conversation-1",
    )
    return AgentWorkspace(
        id="workspace-1",
        tenant_id=owner.tenant_id,
        app_id=owner.app_id,
        owner_type=owner.owner_type,
        owner_id=owner.owner_id,
        owner_scope_key=owner.owner_scope_key,
        backend_workspace_ref="workspace-1-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )


def _persist_participant(session: Session, *, session_snapshot: SessionSnapshot | None) -> None:
    binding = _binding()
    binding.session_snapshot = session_snapshot.model_dump_json() if session_snapshot is not None else None
    session.add_all([_workspace(), binding])
    session.commit()


def _stored_binding_snapshot(session_factory: sessionmaker[Session]) -> SessionSnapshot | None:
    with session_factory() as observer:
        binding = observer.get(AgentWorkspaceBinding, "binding-1")
        assert binding is not None
        return SessionSnapshot.model_validate_json(binding.session_snapshot) if binding.session_snapshot else None


def _persist_annotation_answered_message(
    session: Session,
    *,
    message_id: str,
    query: str,
    answer: str,
    created_at: datetime,
    conversation_id: str = "conversation-1",
    app_id: str = "app-1",
) -> None:
    message = Message(
        id=message_id,
        app_id=app_id,
        conversation_id=conversation_id,
        query=query,
        message={"role": "user", "content": query},
        answer=answer,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id="user-1",
    )
    message.created_at = created_at
    hit = AppAnnotationHitHistory(
        app_id=app_id,
        annotation_id="annotation-1",
        source=ConversationFromSource.API,
        question=query,
        account_id="user-1",
        score=1.0,
        message_id=message_id,
        # A similarity match: the stored question differs from what the user asked.
        annotation_question=f"Stored question close to: {query}",
        annotation_content=answer,
    )
    session.add_all([message, hit])
    session.commit()


def _record_created_bindings(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Replace backend allocation with a local participant row, like ``create_binding`` adds."""
    created: list[str] = []

    def create_binding(*, session: Session, scope: WorkspaceOwnerScope, **kwargs: object) -> AgentWorkspaceBinding:
        del kwargs
        workspace = AgentWorkspace(
            id="workspace-2",
            tenant_id=scope.tenant_id,
            app_id=scope.app_id,
            owner_type=scope.owner_type,
            owner_id=scope.owner_id,
            owner_scope_key=scope.owner_scope_key,
            backend_workspace_ref="workspace-2-ref",
            status=AgentWorkingResourceStatus.ACTIVE,
            active_guard=1,
        )
        binding = _binding()
        binding.workspace_id = workspace.id
        session.add_all([workspace, binding])
        created.append(binding.id)
        return binding

    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create_binding)
    return created


def test_direct_reply_turns_keep_stored_state_and_append_verbatim_reply() -> None:
    # A key the API-side message schema does not know must survive: stored
    # history is owned by the Agent backend and is never re-encoded here.
    (earlier_reply,) = _history_json(ModelResponse(parts=[TextPart(content="Earlier agent answer")]))
    assert isinstance(earlier_reply, dict)
    stored_reply: JsonValue = {**earlier_reply, "x": 1}
    stored = SessionSnapshot(
        layers={
            DIFY_AGENT_HISTORY_LAYER_ID: {
                "messages": [*_history_json(ModelRequest.user_text_prompt("Hi")), stored_reply]
            },
            "shell": {"initialized": True},
        }
    )
    original = stored.model_dump(mode="json")

    updated = append_direct_reply_turns(
        stored,
        (AgentAppDirectReplyTurn(query="Refund window?", answer="**30 days** from delivery."),),
    )

    messages = updated.layers[DIFY_AGENT_HISTORY_LAYER_ID]["messages"]
    assert isinstance(messages, list)
    assert messages[:2] == original["layers"][DIFY_AGENT_HISTORY_LAYER_ID]["messages"]
    assert updated.layers["shell"] == {"initialized": True}
    assert _turn_text(_history(updated))[2:] == [
        ("user", "Refund window?"),
        ("assistant", "**30 days** from delivery."),
    ]
    assert stored.model_dump(mode="json") == original


def test_direct_reply_extends_existing_caller_participant_history(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_conversation(sqlite_session, binding_id="binding-1")
    earlier = SessionSnapshot(
        layers={
            DIFY_AGENT_HISTORY_LAYER_ID: {
                "messages": _history_json(
                    ModelRequest.user_text_prompt("Hi"),
                    ModelResponse(parts=[TextPart(content="Hello, how can I help?")]),
                )
            }
        }
    )
    _persist_participant(sqlite_session, session_snapshot=earlier)

    recorded = AgentAppWorkspaceStore().append_direct_reply(
        _scope(),
        AgentAppDirectReplyTurn(query="Refund window?", answer="30 days from delivery."),
    )

    assert recorded is True
    assert _turn_text(_history(_stored_binding_snapshot(sqlite_session_factory))) == [
        ("user", "Hi"),
        ("assistant", "Hello, how can I help?"),
        ("user", "Refund window?"),
        ("assistant", "30 days from delivery."),
    ]


def test_direct_reply_before_first_participant_allocates_nothing(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_conversation(sqlite_session)
    created = _record_created_bindings(monkeypatch)

    recorded = AgentAppWorkspaceStore().append_direct_reply(
        _scope(),
        AgentAppDirectReplyTurn(query="Refund window?", answer="30 days from delivery."),
    )

    assert recorded is False
    assert created == []
    with sqlite_session_factory() as observer:
        assert observer.scalars(select(AgentWorkspaceBinding)).all() == []


def test_first_conversation_participant_remembers_earlier_annotation_turns(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_conversation(sqlite_session)
    # Persist out of order to prove the conversation order comes from the messages.
    _persist_annotation_answered_message(
        sqlite_session,
        message_id="message-2",
        query="And for digital goods?",
        answer="Digital goods are final sale.",
        created_at=datetime(2026, 11, 1, 10, 1),
    )
    _persist_annotation_answered_message(
        sqlite_session,
        message_id="message-1",
        query="Refund window?",
        answer="30 days from delivery.",
        created_at=datetime(2026, 11, 1, 10, 0),
    )
    _persist_annotation_answered_message(
        sqlite_session,
        message_id="other-message",
        query="Unrelated question",
        answer="Unrelated answer",
        created_at=datetime(2026, 11, 1, 9, 0),
        conversation_id="conversation-2",
    )
    created = _record_created_bindings(monkeypatch)

    stored = AgentAppWorkspaceStore().load_or_create(_scope())

    expected = [
        ("user", "Refund window?"),
        ("assistant", "30 days from delivery."),
        ("user", "And for digital goods?"),
        ("assistant", "Digital goods are final sale."),
    ]
    assert created == ["binding-1"]
    assert _turn_text(_history(stored.session_snapshot)) == expected
    assert _turn_text(_history(_stored_binding_snapshot(sqlite_session_factory))) == expected


def test_first_conversation_participant_without_annotation_turns_starts_empty(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_conversation(sqlite_session)
    _record_created_bindings(monkeypatch)

    stored = AgentAppWorkspaceStore().load_or_create(_scope())

    assert stored.session_snapshot is None
    assert _stored_binding_snapshot(sqlite_session_factory) is None


def test_first_conversation_participant_ignores_annotation_turns_of_another_app(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _persist_conversation(sqlite_session)
    _persist_annotation_answered_message(
        sqlite_session,
        message_id="message-1",
        query="Refund window?",
        answer="30 days from delivery.",
        created_at=datetime(2026, 11, 1, 10, 0),
    )
    _persist_annotation_answered_message(
        sqlite_session,
        message_id="foreign-message",
        query="Another app's question",
        answer="Another app's answer",
        created_at=datetime(2026, 11, 1, 9, 0),
        app_id="app-2",
    )
    _record_created_bindings(monkeypatch)

    stored = AgentAppWorkspaceStore().load_or_create(_scope())

    assert _turn_text(_history(stored.session_snapshot)) == [
        ("user", "Refund window?"),
        ("assistant", "30 days from delivery."),
    ]


def test_replacement_participant_does_not_replay_annotation_turns(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    # A retired Workspace means the conversation already had a participant whose
    # context was reset on purpose (for example Build Apply in console preview).
    _persist_conversation(sqlite_session)
    retired = _workspace()
    sqlite_session.add(retired)
    sqlite_session.commit()
    retired.status = AgentWorkingResourceStatus.RETIRED
    retired.active_guard = None
    retired.retired_at = datetime(2026, 11, 1, 9, 30)
    sqlite_session.commit()
    _persist_annotation_answered_message(
        sqlite_session,
        message_id="message-1",
        query="Refund window?",
        answer="30 days from delivery.",
        created_at=datetime(2026, 11, 1, 10, 0),
    )
    _record_created_bindings(monkeypatch)

    stored = AgentAppWorkspaceStore().load_or_create(_scope())

    assert stored.session_snapshot is None
    assert _stored_binding_snapshot(sqlite_session_factory) is None
