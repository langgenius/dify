"""Builder explanations use existing replies/cards while old history stays readable."""

from dataclasses import asdict
from datetime import datetime
from typing import cast
from unittest.mock import MagicMock

import pytest

from controllers.console.dify_builder_fields import DifyBuilderConversationPageResponse, DifyBuilderSessionViewResponse
from core.dify_builder.contract import ConversationItemAppendedEventData
from core.dify_builder.errors import BadRequestError
from core.dify_builder.handlers_build import handle_publish as publish_build
from core.dify_builder.handlers_edit import handle_publish as publish_edit
from core.dify_builder.handlers_fix import handle_publish as publish_fix
from core.dify_builder.models import Action, Actor, ConversationItem, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.ports import DifyBuilderAgent, DifyPort, Repository
from core.dify_builder.runner import Env, Handler, Runner
from core.dify_builder.state import PcState
from services.dify_builder.service import DifyBuilderService, SessionLock
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent, seed_verified_run


@pytest.mark.parametrize(
    ("recovery_class", "can_continue", "can_restart", "description_id"),
    [
        ("unchanged", True, False, "replies.noChangesSinceYouLastLeftResumingWhereYouWere"),
        ("config_only", True, True, "replies.onlyNodeSettingsChangedSinceYouLeftContinueOrRestart"),
        ("structural_compatible", True, True, "replies.theWorkflowStructureChangedButThe"),
        ("structural_invalidating", False, True, "replies.theNodesThisTaskWasWorking"),
    ],
)
def test_recovery_reason_is_in_the_decision_and_old_history_keeps_its_watermark(
    recovery_class: str, can_continue: bool, can_restart: bool, description_id: str
) -> None:
    repo = InMemoryRepository()
    actor = Actor(account_id="account", tenant_id="tenant")
    session = Session(
        app_id="app",
        tenant_id="tenant",
        owner_account_id="account",
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_REVIEW,
    )
    history = [
        ConversationItem(seq=0, kind="notice", payload={"text": "旧恢复提示", "tone": "neutral"}),
        ConversationItem(
            seq=1,
            kind="interaction_response",
            payload={
                "interaction_kind": "form",
                "question": "历史原文",
                "fields": [{"key": "goal", "label": "Goal", "value": "{{name}}", "display_value": "{{name}}"}],
                "submitted_data": {"goal": "{{name}}", "enabled": False, "count": 0},
            },
        ),
    ]
    repo.create_session(session, DifyBuilderContext(recovery_class=recovery_class, reply_language="ja"), history)
    lock = MagicMock(spec=SessionLock)
    lock.exists.return_value = False
    service = DifyBuilderService(cast(Repository, repo), lock, lambda *_args: None)

    view = service.get_session_view(session.id, actor)
    serialized = DifyBuilderSessionViewResponse.model_validate(asdict(view)).model_dump(mode="json")

    assert serialized["recovery"] == {
        "recovery_class": recovery_class,
        "can_continue": can_continue,
        "can_restart": can_restart,
    }
    assert serialized["decision"]["description"] == {"type": "copy", "id": description_id, "params": {}}
    assert serialized["reply_language"] == "ja"
    assert view.decision is not None
    assert [option.id for option in view.decision.options] == (
        (["recovery_continue"] if can_continue else []) + (["restart"] if can_restart else [])
    )
    page = service.get_conversation_page(session.id, actor, limit=20)
    decoded = DifyBuilderConversationPageResponse.model_validate(asdict(page))
    assert [item.kind for item in decoded.data] == ["notice", "interaction_response"]
    assert decoded.last_seq == view.conversation_last_seq == 1
    assert repo.list_conversation(session.id) == history
    if not can_continue:
        with pytest.raises(BadRequestError, match="not allowed"):
            service.submit_action(session.id, actor, Action(kind="recovery_continue", base_version=view.version))
        assert repo.get_session(session.id)[0].version == view.version


@pytest.mark.parametrize(
    ("entry_mode", "working_state", "waiting_state", "handler"),
    [
        (EntryMode.BUILD, PcState.BUILD_PUBLISH, PcState.BUILD_REVIEW, publish_build),
        (EntryMode.EDIT, PcState.EDIT_PUBLISH, PcState.EDIT_REVIEW, publish_edit),
        (EntryMode.FIX, PcState.FIX_PUBLISH, PcState.FIX_AWAIT_DECISION, publish_fix),
    ],
)
@pytest.mark.parametrize("stale", [False, True])
def test_publication_refusal_commits_a_complete_reply_without_publishing_or_streaming(
    entry_mode: EntryMode, working_state: PcState, waiting_state: PcState, handler: Handler, stale: bool
) -> None:
    repo = InMemoryRepository()
    dify = FakeDifyPort()
    session = Session(app_id="app", entry_mode=entry_mode, current_state=working_state)
    repo.create_session(session, DifyBuilderContext(reply_language="zh-Hans"), [])
    if stale:
        seed_verified_run(repo, session, dify)
        dify.hash = "changed-after-test"
    streamed: list[object] = []
    delivered: list[ConversationItem] = []

    def receive(event: ConversationItemAppendedEventData) -> None:
        assert event.item in repo.list_conversation(session.id)
        delivered.append(event.item)

    env = Env(
        dify=cast(DifyPort, dify),
        agent=cast(DifyBuilderAgent, StubAgent()),
        repo=cast(Repository, repo),
        now=lambda: datetime.min,
        emit_message=streamed.append,
        emit_item=receive,
    )

    settled = Runner(env, {working_state: handler}).advance(
        session.id, Turn(actor=Actor(account_id="account", tenant_id="tenant"))
    )

    assert settled.current_state == waiting_state
    assert not dify.published
    assert streamed == []
    assert [item.kind for item in delivered] == ["assistant_turn"]
    reply = delivered[0].payload
    assert reply["reply_mode"] == "complete"
    assert reply["reply_language"] == "zh-Hans"
    assert reply["reply_text"]["id"] == "publish.verificationRequired"
    assert reply["reply_text"]["params"]["reason"] == ("stale_revision" if stale else "no_verified_run")
