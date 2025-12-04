import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from libs.uuid_utils import uuidv7
from models.enums import CreatorUserRole
from models.model import AppMode, Conversation, Message


def _create_conversation(session) -> Conversation:
    conversation = Conversation(
        app_id=str(uuid.uuid4()),
        mode=AppMode.CHAT,
        name="Test Conversation",
        status="normal",
        from_source=CreatorUserRole.ACCOUNT,
        from_account_id=str(uuid.uuid4()),
    )
    conversation.inputs = {}
    session.add(conversation)
    session.commit()
    return conversation


def _create_message(session, conversation: Conversation) -> Message:
    message = Message(
        app_id=conversation.app_id,
        conversation_id=conversation.id,
        query="Need manual approval",
        message={"type": "text", "content": "Need manual approval"},
        answer="Acknowledged",
        message_tokens=10,
        answer_tokens=20,
        message_unit_price=Decimal("0.001"),
        answer_unit_price=Decimal("0.001"),
        message_price_unit=Decimal("0.001"),
        answer_price_unit=Decimal("0.001"),
        currency="USD",
        status="normal",
        from_source=CreatorUserRole.ACCOUNT,
    )
    message.inputs = {}
    session.add(message)
    session.commit()
    return message


def test_message_auto_loads_multiple_extra_variants(db_session_with_containers):
    conversation = _create_conversation(db_session_with_containers)
    message = _create_message(db_session_with_containers, conversation)

    human_input_result_content_id = str(uuidv7())
    human_input_result_content = HumanInputResultRelation(
        id=human_input_result_content_id,
        message_id=message.id,
        form_id=None,
    )
    db_session_with_containers.add(human_input_result_content)
    db_session_with_containers.commit()

    # polymorphic_extra = with_polymorphic(
    #     MessageExtraContent,
    #     [HumanInputResultRelation],
    # )

    stmt = select(Message).options(selectinload(Message.extra_content)).where(Message.id == message.id)
    loaded_message = db_session_with_containers.execute(stmt).scalar_one()

    assert len(loaded_message.extra_content) == 1
    assert human_input_result_content_id in {extra.id for extra in loaded_message.extra_content}

    loaded_types = {type(extra) for extra in loaded_message.extra_content}
    assert HumanInputResultRelation in loaded_types
