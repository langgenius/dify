from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime
from decimal import Decimal

import pytest
from pydantic import JsonValue

from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.installed_app_access_service import InstalledAppRef
from services.installed_app_message_service import (
    InstalledAppMessageService,
    MessageFeedbackEvent,
    MessageNotChatAppError,
    MessagePage,
    MessageRating,
    MessageRecord,
)

_REF = InstalledAppRef(id="installed", app_id="app", tenant_id="viewer-workspace", app_mode="chat")


def _message(message_id: str) -> MessageRecord:
    return MessageRecord(
        id=message_id,
        conversation_id="conversation",
        parent_message_id=None,
        inputs={"empty": "", "zero": 0, "none": None, "list": []},
        query="Question",
        answer="Answer",
        feedback=None,
        retriever_resources=[],
        created_at=datetime(2026, 9, 8),
        agent_thoughts=[],
        message_files=[],
        message_tokens=2,
        answer_tokens=3,
        provider_response_latency=0,
        total_price=Decimal(0),
        currency="USD",
        status="normal",
        error=None,
        metadata={"usage": {"total_tokens": 5}},
    )


@dataclass
class _Store:
    page: MessagePage = field(
        default_factory=lambda: MessagePage(limit=2, has_more=True, data=(_message("first"), _message("second")))
    )
    events: list[str] = field(default_factory=list)
    write_error: Exception | None = None
    rating: MessageRating | None = None

    def get_page(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        conversation_id: str,
        first_id: str | None,
        limit: int,
    ) -> MessagePage:
        assert (installed_app, account_id, conversation_id, first_id, limit) == (
            _REF,
            "account",
            "conversation",
            None,
            2,
        )
        self.events.append("read closed")
        return self.page

    def set_feedback(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        message_id: str,
        rating: MessageRating | None,
        content: str | None,
    ) -> MessageFeedbackEvent | None:
        if self.write_error is not None:
            raise self.write_error
        self.rating = rating
        self.events.append("write committed and closed")
        if rating is None:
            return None
        return MessageFeedbackEvent(
            tenant_id="owner-workspace",
            app_id=installed_app.app_id,
            conversation_id="conversation",
            message_id=message_id,
            account_id=account_id,
            rating=rating,
            content=content,
        )


@dataclass
class _Callbacks:
    store: _Store
    queried_ids: list[tuple[str, ...]] = field(default_factory=list)
    feedback: list[MessageFeedbackEvent] = field(default_factory=list)
    suggestion_error: Exception | None = None

    def get_extra_contents(self, *, message_ids: Sequence[str]) -> Mapping[str, list[dict[str, JsonValue]]]:
        assert self.store.events == ["read closed"]
        self.store.events.append("extra contents")
        self.queried_ids.append(tuple(message_ids))
        return {"first": [{"type": "workflow", "workflow_run_id": "run"}], "not-in-page": [{"type": "ignored"}]}

    def suggested_questions(self, *, installed_app: InstalledAppRef, account_id: str, message_id: str) -> list[str]:
        assert installed_app.app_id == _REF.app_id
        assert (account_id, message_id) == ("account", "message")
        self.store.events.append("suggested questions")
        if self.suggestion_error is not None:
            raise self.suggestion_error
        return ["Next question?"]

    def emit_feedback(self, *, feedback: MessageFeedbackEvent) -> None:
        assert self.store.events[-1] == "write committed and closed"
        assert self.store.rating == feedback.rating
        self.store.events.append("emit feedback")
        self.feedback.append(feedback)

    def service(self) -> InstalledAppMessageService:
        return InstalledAppMessageService(
            messages=self.store,
            get_extra_contents=self.get_extra_contents,
            suggested_questions=self.suggested_questions,
            emit_feedback=self.emit_feedback,
        )


def test_list_batches_extra_contents_after_read_and_preserves_detached_page() -> None:
    state = _Callbacks(store=_Store())
    page = state.service().get_page(
        installed_app=_REF, account_id="account", conversation_id="conversation", first_id=None, limit=2
    )

    assert state.queried_ids == [("first", "second")]
    assert (page.limit, page.has_more) == (2, True)
    assert [item.id for item in page.data] == ["first", "second"]
    assert page.data[0].extra_contents == [{"type": "workflow", "workflow_run_id": "run"}]
    assert page.data[1].extra_contents == []
    assert replace(page.data[0], extra_contents=[]) == state.store.page.data[0]
    assert state.store.page.data[0].extra_contents == []


def test_empty_page_skips_extra_content_query() -> None:
    state = _Callbacks(store=_Store(page=MessagePage(limit=2, has_more=False, data=())))
    page = state.service().get_page(
        installed_app=_REF, account_id="account", conversation_id="conversation", first_id=None, limit=2
    )
    assert page.data == ()
    assert state.store.events == ["read closed"]
    assert state.queried_ids == []


@pytest.mark.parametrize("rating", ["like", "dislike", None])
def test_feedback_emits_only_for_committed_rating_and_allows_completion_apps(rating: MessageRating | None) -> None:
    state = _Callbacks(store=_Store())
    state.service().set_feedback(
        installed_app=replace(_REF, app_mode="completion"),
        account_id="account",
        message_id="message",
        rating=rating,
        content="",
    )
    if rating is None:
        assert state.feedback == []
        assert state.store.events == ["write committed and closed"]
    else:
        assert state.feedback == [
            MessageFeedbackEvent(
                tenant_id="owner-workspace",
                app_id="app",
                conversation_id="conversation",
                message_id="message",
                account_id="account",
                rating=rating,
                content="",
            )
        ]
        assert state.store.events == ["write committed and closed", "emit feedback"]


def test_feedback_write_error_propagates_without_emitting() -> None:
    failure = MessageNotExistsError("Message was deleted")
    state = _Callbacks(store=_Store(write_error=failure))
    with pytest.raises(MessageNotExistsError) as error:
        state.service().set_feedback(
            installed_app=_REF, account_id="account", message_id="message", rating="like", content=None
        )
    assert error.value is failure
    assert state.store.rating is None
    assert state.feedback == []


@pytest.mark.parametrize("mode", ["completion", "workflow"])
def test_non_chat_admission_rejects_reads_before_database_or_generation(mode: str) -> None:
    state = _Callbacks(store=_Store())
    ref = replace(_REF, app_mode=mode)
    with pytest.raises(MessageNotChatAppError):
        state.service().get_page(
            installed_app=ref, account_id="account", conversation_id="conversation", first_id=None, limit=2
        )
    with pytest.raises(MessageNotChatAppError):
        state.service().get_suggested_questions(installed_app=ref, account_id="account", message_id="message")
    assert state.store.events == []


@pytest.mark.parametrize("mode", ["chat", "agent-chat", "advanced-chat"])
def test_suggested_questions_accepts_all_chat_modes_and_preserves_errors(mode: str) -> None:
    state = _Callbacks(store=_Store())
    ref = replace(_REF, app_mode=mode)
    assert state.service().get_suggested_questions(installed_app=ref, account_id="account", message_id="message") == [
        "Next question?"
    ]
    failure = SuggestedQuestionsAfterAnswerDisabledError("Suggested questions are disabled")
    state.suggestion_error = failure
    with pytest.raises(SuggestedQuestionsAfterAnswerDisabledError) as error:
        state.service().get_suggested_questions(installed_app=ref, account_id="account", message_id="message")
    assert error.value is failure
