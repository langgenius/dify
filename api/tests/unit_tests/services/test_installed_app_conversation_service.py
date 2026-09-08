"""Conversation orchestration over a stateful persistence fake."""

from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime

import pytest

from services.errors.conversation import ConversationNotExistsError
from services.installed_app_access_service import InstalledAppRef
from services.installed_app_conversation_service import (
    ConversationDeletion,
    ConversationNameRequiredError,
    ConversationNameSource,
    ConversationNotChatAppError,
    ConversationPage,
    ConversationRecord,
    InstalledAppConversationService,
)

_REF = InstalledAppRef(
    id="11111111-1111-4111-8111-111111111111",
    app_id="22222222-2222-4222-8222-222222222222",
    tenant_id="33333333-3333-4333-8333-333333333333",
    app_mode="chat",
)
_ACCOUNT_ID = "44444444-4444-4444-8444-444444444444"
_CONVERSATION_ID = "55555555-5555-4555-8555-555555555555"
_OWNER_TENANT_ID = "66666666-6666-4666-8666-666666666666"
_UPDATED_AT = datetime(2024, 1, 1)


@dataclass
class _Store:
    conversation: ConversationRecord | None = field(
        default_factory=lambda: ConversationRecord(
            id=_CONVERSATION_ID,
            name="Original title",
            inputs={"count": 0},
            status="normal",
            introduction=None,
            created_at=_UPDATED_AT,
            updated_at=_UPDATED_AT,
        )
    )
    events: list[str] = field(default_factory=list)
    delete_error: Exception | None = None

    def get(self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str) -> ConversationRecord:
        self.events.append("read conversation")
        assert (installed_app, account_id, conversation_id) == (_REF, _ACCOUNT_ID, _CONVERSATION_ID)
        if self.conversation is None:
            raise ConversationNotExistsError()
        return self.conversation

    def get_page(
        self, *, installed_app: InstalledAppRef, account_id: str, last_id: str | None, limit: int, pinned: bool | None
    ) -> ConversationPage:
        raise AssertionError(f"Unexpected listing: {installed_app=}, {account_id=}, {last_id=}, {limit=}, {pinned=}")

    def get_name_source(
        self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str
    ) -> ConversationNameSource:
        self.events.append("read source")
        assert (installed_app, account_id, conversation_id) == (_REF, _ACCOUNT_ID, _CONVERSATION_ID)
        if self.conversation is None:
            raise ConversationNotExistsError()
        return ConversationNameSource(tenant_id=_OWNER_TENANT_ID, query="First query")

    def rename(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        conversation_id: str,
        name: str,
        updated_at: datetime | None,
    ) -> ConversationRecord:
        self.events.append("rename")
        assert (installed_app, account_id, conversation_id) == (_REF, _ACCOUNT_ID, _CONVERSATION_ID)
        if self.conversation is None:
            raise ConversationNotExistsError()
        self.conversation = replace(
            self.conversation,
            name=name,
            updated_at=updated_at if updated_at is not None else self.conversation.updated_at,
        )
        return self.conversation

    def delete(self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str) -> ConversationDeletion:
        assert (installed_app, account_id, conversation_id) == (_REF, _ACCOUNT_ID, _CONVERSATION_ID)
        if self.delete_error is not None:
            raise self.delete_error
        self.conversation = None
        self.events.append("delete committed")
        return ConversationDeletion(
            tenant_id=_OWNER_TENANT_ID, conversation_id=conversation_id, retired_binding_id="retired-binding"
        )

    def set_pinned(
        self, *, installed_app: InstalledAppRef, account_id: str, conversation_id: str, is_pinned: bool
    ) -> None:
        raise AssertionError(f"Unexpected pin: {installed_app=}, {account_id=}, {conversation_id=}, {is_pinned=}")


@dataclass
class _Orchestration:
    store: _Store
    service: InstalledAppConversationService | None = None
    generation_error: Exception | None = None
    generation_action: Callable[[], None] | None = None
    cleanup_calls: list[tuple[str, str, str | None]] = field(default_factory=list)

    def generate_name(self, *, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str:
        self.store.events.append("generate")
        assert (tenant_id, app_id, conversation_id, query, app_mode) == (
            _OWNER_TENANT_ID,
            _REF.app_id,
            _CONVERSATION_ID,
            "First query",
            "chat",
        )
        if self.generation_error is not None:
            raise self.generation_error
        if self.generation_action is not None:
            self.generation_action()
        return "Generated title"

    def cleanup(self, *, tenant_id: str, conversation_id: str, retired_binding_id: str | None) -> None:
        assert self.store.conversation is None
        self.store.events.append("enqueue")
        self.cleanup_calls.append((tenant_id, conversation_id, retired_binding_id))

    def rename(self, *, name: str | None = None, auto_generate: bool = True) -> ConversationRecord:
        assert self.service is not None
        return self.service.rename(
            installed_app=_REF,
            account_id=_ACCOUNT_ID,
            conversation_id=_CONVERSATION_ID,
            name=name,
            auto_generate=auto_generate,
        )

    def delete(self) -> None:
        assert self.service is not None
        self.service.delete(installed_app=_REF, account_id=_ACCOUNT_ID, conversation_id=_CONVERSATION_ID)


@pytest.fixture
def orchestration() -> _Orchestration:
    state = _Orchestration(store=_Store())
    state.service = InstalledAppConversationService(
        conversations=state.store,
        generate_name=state.generate_name,
        enqueue_delete_cleanup=state.cleanup,
    )
    return state


def test_auto_rename_reads_then_generates_then_writes_without_changing_manual_timestamp(
    orchestration: _Orchestration,
) -> None:
    result = orchestration.rename()
    assert result.name == "Generated title"
    assert result.inputs == {"count": 0}
    assert result.updated_at == _UPDATED_AT
    assert orchestration.store.events == ["read source", "generate", "rename"]


def test_generation_failure_returns_original_record_without_writing(orchestration: _Orchestration) -> None:
    original = orchestration.store.conversation
    orchestration.generation_error = RuntimeError("provider unavailable")
    assert orchestration.rename() is original
    assert orchestration.store.conversation is original
    assert orchestration.store.events == ["read source", "generate", "read conversation"]


def test_conversation_deleted_during_generation_is_not_recreated(orchestration: _Orchestration) -> None:
    def remove_conversation() -> None:
        orchestration.store.conversation = None

    orchestration.generation_action = remove_conversation
    with pytest.raises(ConversationNotExistsError):
        orchestration.rename()
    assert orchestration.store.conversation is None
    assert orchestration.store.events == ["read source", "generate", "rename"]


def test_manual_rename_updates_timestamp_without_generating(orchestration: _Orchestration) -> None:
    result = orchestration.rename(name="User title", auto_generate=False)
    assert result.name == "User title"
    assert result.updated_at is not None
    assert result.updated_at > _UPDATED_AT
    assert orchestration.store.events == ["rename"]


def test_manual_rename_requires_name_before_writing(orchestration: _Orchestration) -> None:
    with pytest.raises(ConversationNameRequiredError):
        orchestration.rename(auto_generate=False)
    assert orchestration.store.events == []


def test_cleanup_uses_deleted_app_owner_and_retired_binding_after_commit(orchestration: _Orchestration) -> None:
    orchestration.delete()
    assert orchestration.store.events == ["delete committed", "enqueue"]
    assert orchestration.cleanup_calls == [(_OWNER_TENANT_ID, _CONVERSATION_ID, "retired-binding")]


def test_delete_transaction_failure_does_not_enqueue_cleanup(orchestration: _Orchestration) -> None:
    original = orchestration.store.conversation
    orchestration.store.delete_error = RuntimeError("commit failed")
    with pytest.raises(RuntimeError, match="commit failed"):
        orchestration.delete()
    assert orchestration.store.conversation is original
    assert orchestration.cleanup_calls == []


@pytest.mark.parametrize("mode", ["completion", "workflow", "agent", "unknown"])
def test_non_chat_admission_snapshot_is_rejected_before_persistence(orchestration: _Orchestration, mode: str) -> None:
    assert orchestration.service is not None
    with pytest.raises(ConversationNotChatAppError):
        orchestration.service.delete(
            installed_app=replace(_REF, app_mode=mode), account_id=_ACCOUNT_ID, conversation_id=_CONVERSATION_ID
        )
    assert orchestration.store.events == []
    assert orchestration.store.conversation is not None
    assert orchestration.cleanup_calls == []
