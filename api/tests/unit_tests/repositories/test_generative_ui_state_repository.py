"""Verify draft persistence, message ownership and terminal-state rules using SQLite."""

import json
from dataclasses import dataclass, replace
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from libs.generative_ui import OpenUIContentBlock
from models.account import Account
from models.enums import ConversationFromSource, EndUserType
from models.model import App, AppMode, Conversation, EndUser, InstalledApp, Message
from repositories.generative_ui_state_repository import SQLAlchemyOpenUIStateRepository
from repositories.message_repository import MessageRepository
from services.entities.message_entities import MessageAccount, MessageActor, MessageEndUser
from services.errors.message import MessageNotExistsError
from services.generative_ui_state_service import OpenUIBlockNotReadyError, OpenUIStateService
from services.installed_app_access_service import InstalledAppRef


@dataclass
class DraftCase:
    service: OpenUIStateService
    factory: sessionmaker[Session]
    actor: MessageActor
    app_id: str
    tenant_id: str
    message_id: str
    block: OpenUIContentBlock

    def save(self, installed_app: InstalledAppRef | None = None) -> OpenUIContentBlock:
        return self.service.save_state(
            actor=self.actor,
            app_id=self.app_id,
            app_owner_tenant_id=self.tenant_id,
            message_id=self.message_id,
            block_id=self.block.id,
            form_state={"email": "reader@example.com"},
            installed_app=installed_app,
        )


@pytest.fixture(params=["account", "end_user"])
def draft_case(request: pytest.FixtureRequest, sqlite_session_factory: sessionmaker[Session]) -> DraftCase:
    block = OpenUIContentBlock(id="message:openui:0", source="root = Stack([]);", status="completed", sequence=4)
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="OpenUI", mode=AppMode.AGENT, enable_site=True, enable_api=True)
        account = Account(name="Owner", email="openui@example.com")
        session.add_all([app, account])
        session.flush()
        user = EndUser(tenant_id=app.tenant_id, app_id=app.id, type=EndUserType.SERVICE_API, session_id=str(uuid4()))
        session.add(user)
        session.flush()
        actor: MessageActor = (
            MessageAccount(account_id=account.id) if request.param == "account" else MessageEndUser(end_user_id=user.id)
        )
        account_id = actor.account_id if isinstance(actor, MessageAccount) else None
        end_user_id = actor.end_user_id if isinstance(actor, MessageEndUser) else None
        source = ConversationFromSource.CONSOLE if isinstance(actor, MessageAccount) else ConversationFromSource.API
        conversation = Conversation(
            app_id=app.id,
            mode=AppMode.AGENT,
            name="Draft",
            _inputs={},
            from_source=source,
            from_account_id=account_id,
            from_end_user_id=end_user_id,
        )
        session.add(conversation)
        session.flush()
        message = Message(
            app_id=app.id,
            conversation_id=conversation.id,
            _inputs={},
            query="Question",
            answer="Summary",
            message={},
            message_unit_price=Decimal(0),
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=source,
            from_account_id=account_id,
            from_end_user_id=end_user_id,
            message_metadata=json.dumps(
                {
                    "usage": {"total_tokens": 7},
                    "retriever_resources": [],
                    "content_blocks": [block.model_dump()],
                }
            ),
        )
        session.add(message)
        session.flush()
        return DraftCase(
            service=OpenUIStateService(SQLAlchemyOpenUIStateRepository(sqlite_session_factory)),
            factory=sqlite_session_factory,
            actor=actor,
            app_id=app.id,
            tenant_id=app.tenant_id,
            message_id=message.id,
            block=block,
        )


def test_state_save_preserves_source_answer_sequence_and_unrelated_metadata(draft_case: DraftCase) -> None:
    updated = draft_case.save()
    assert updated.form_state == {"email": "reader@example.com"}
    assert updated.model_copy(update={"form_state": {}}) == draft_case.block
    with draft_case.factory() as session:
        message = session.get(Message, draft_case.message_id)
        assert message is not None
        assert message.answer == "Summary"
        assert message.message_metadata_dict["usage"] == {"total_tokens": 7}
        assert OpenUIContentBlock.model_validate(message.message_metadata_dict["content_blocks"][0]) == updated


@pytest.mark.parametrize("field", ["app_id", "tenant_id", "actor", "message_id", "block_id"])
def test_state_save_rejects_another_owner_or_resource(draft_case: DraftCase, field: str) -> None:
    match field:
        case "actor":
            draft_case.actor = MessageAccount(account_id=str(uuid4()))
        case "block_id":
            draft_case.block = draft_case.block.model_copy(update={"id": "unknown"})
        case _:
            setattr(draft_case, field, str(uuid4()))
    with pytest.raises(MessageNotExistsError):
        draft_case.save()


@pytest.mark.parametrize("status", ["streaming", "cancelled", "error"])
def test_state_save_rejects_incomplete_or_cancelled_ui_without_writing(draft_case: DraftCase, status: str) -> None:
    metadata = {"content_blocks": [draft_case.block.model_copy(update={"status": status}).model_dump()]}
    with draft_case.factory.begin() as session:
        session.execute(
            update(Message).where(Message.id == draft_case.message_id).values(message_metadata=json.dumps(metadata))
        )
    with pytest.raises(OpenUIBlockNotReadyError):
        draft_case.save()
    with draft_case.factory() as session:
        message = session.get(Message, draft_case.message_id)
        assert message is not None
        assert message.message_metadata_dict == metadata


@pytest.mark.parametrize("mismatch", [None, "id", "tenant_id", "app_id", "app_owner_tenant_id", "deleted"])
def test_installed_state_save_revalidates_all_installation_keys(draft_case: DraftCase, mismatch: str | None) -> None:
    with draft_case.factory.begin() as session:
        installation = InstalledApp(
            tenant_id=str(uuid4()),
            app_id=draft_case.app_id,
            app_owner_tenant_id=draft_case.tenant_id,
        )
        session.add(installation)
        session.flush()
        reference = InstalledAppRef(
            id=installation.id,
            app_id=installation.app_id,
            tenant_id=installation.tenant_id,
            app_owner_tenant_id=installation.app_owner_tenant_id,
            app_mode=AppMode.AGENT,
        )
        if mismatch == "deleted":
            session.delete(installation)
    if mismatch is None:
        assert draft_case.save(reference).form_state == {"email": "reader@example.com"}
        return
    if mismatch != "deleted":
        reference = replace(reference, **{mismatch: str(uuid4())})
    with pytest.raises(MessageNotExistsError):
        draft_case.save(reference)


def test_saved_state_is_hydrated_by_existing_history_contract(draft_case: DraftCase) -> None:
    from fields.message_fields import WebMessageListItem

    expected = draft_case.save()
    with draft_case.factory() as session:
        message = session.get(Message, draft_case.message_id)
        assert message is not None
        conversation_id = message.conversation_id
    page = MessageRepository(session_factory=draft_case.factory).get_message_page(
        app_id=draft_case.app_id,
        app_owner_tenant_id=draft_case.tenant_id,
        actor=draft_case.actor,
        conversation_id=conversation_id,
        first_id=None,
        limit=20,
        installed_app=None,
    )
    history = WebMessageListItem.model_validate(page.data[0].record)
    assert history.content_blocks == [expected]
    assert history.answer == "Summary"
