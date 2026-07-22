"""TestContainers integration tests for ChatConversationApi status_count behavior."""

import json
import uuid
from datetime import datetime
from unittest.mock import patch

from sqlalchemy.orm import Session

from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models import Account
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import AppMode, Conversation, Message, MessageAnnotation
from models.workflow import WorkflowRun
from tests.test_containers_integration_tests.controllers.console.helpers import (
    AuthenticatedConsoleAppClient,
    AuthenticatedConsoleClient,
    ConsoleAppFactory,
)
from tests.test_containers_integration_tests.helpers import DatabaseState


def _create_conversation(
    db_session: Session,
    app_id: str,
    account_id: str,
    *,
    mode: AppMode = AppMode.CHAT,
) -> Conversation:
    conversation = Conversation(
        app_id=app_id,
        name="Test Conversation",
        inputs={},
        status="normal",
        mode=mode,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account_id,
    )
    db_session.add(conversation)
    db_session.commit()
    return conversation


def _create_workflow_run(db_session: Session, app_id: str, tenant_id: str, account_id: str) -> WorkflowRun:
    workflow_run = WorkflowRun(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=str(uuid.uuid4()),
        type="chat",
        triggered_from="app-run",
        version="1.0.0",
        graph=json.dumps({"nodes": [], "edges": []}),
        inputs=json.dumps({"query": "test"}),
        status=WorkflowExecutionStatus.PAUSED,
        outputs=json.dumps({}),
        elapsed_time=0.0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
        created_at=naive_utc_now(),
    )
    db_session.add(workflow_run)
    db_session.commit()
    return workflow_run


def _create_message(
    db_session: Session, app_id: str, conversation_id: str, workflow_run_id: str | None, account_id: str
) -> Message:
    message = Message(
        app_id=app_id,
        conversation_id=conversation_id,
        query="Hello",
        message={"type": "text", "content": "Hello"},
        answer="Hi there",
        message_tokens=1,
        answer_tokens=1,
        message_unit_price=0.001,
        answer_unit_price=0.001,
        message_price_unit=0.001,
        answer_price_unit=0.001,
        currency="USD",
        status="normal",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account_id,
        workflow_run_id=workflow_run_id,
        inputs={"query": "Hello"},
    )
    db_session.add(message)
    db_session.commit()
    return message


def _simple_model_config() -> dict[str, object]:
    return {"model": None, "pre_prompt": None}


def _full_model_config() -> dict[str, object]:
    return {
        "opening_statement": None,
        "suggested_questions": None,
        "model": None,
        "user_input_form": None,
        "pre_prompt": None,
        "agent_mode": None,
    }


def _simple_message_contract(message: Message) -> dict[str, object]:
    return {
        "inputs": {"query": "Hello"},
        "query": message.query,
        "message": "",
        "answer": message.answer,
    }


def _message_contract(message: Message) -> dict[str, object]:
    return {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "inputs": {"query": "Hello"},
        "query": "Hello",
        "message": {"type": "text", "content": "Hello"},
        "message_tokens": 1,
        "answer": "Hi there",
        "answer_tokens": 1,
        "provider_response_latency": 0.0,
        "from_source": ConversationFromSource.CONSOLE.value,
        "from_end_user_id": None,
        "from_account_id": message.from_account_id,
        "feedbacks": [],
        "workflow_run_id": message.workflow_run_id,
        "annotation": None,
        "annotation_hit_history": None,
        "created_at": int(message.created_at.timestamp()),
        "agent_thoughts": [],
        "message_files": [],
        "metadata": {},
        "status": "normal",
        "error": None,
        "parent_message_id": None,
    }


def _chat_summary_contract(
    conversation: Conversation,
    *,
    account_name: str,
    message_count: int,
    annotated: bool = False,
    status_count: dict[str, int] | None = None,
) -> dict[str, object]:
    return {
        "id": conversation.id,
        "status": "normal",
        "from_source": ConversationFromSource.CONSOLE.value,
        "from_end_user_id": None,
        "from_end_user_session_id": None,
        "from_account_id": conversation.from_account_id,
        "from_account_name": account_name,
        "name": conversation.name,
        "summary": "Hello" if message_count else "",
        "read_at": None,
        "created_at": int(conversation.created_at.timestamp()),
        "updated_at": int(conversation.updated_at.timestamp()),
        "annotated": annotated,
        "model_config": _simple_model_config(),
        "message_count": message_count,
        "user_feedback_stats": {"like": 0, "dislike": 0},
        "admin_feedback_stats": {"like": 0, "dislike": 0},
        "status_count": status_count,
    }


def _chat_detail_contract(conversation: Conversation, *, message_count: int) -> dict[str, object]:
    assert conversation.read_at is not None
    return {
        "id": conversation.id,
        "status": "normal",
        "from_source": ConversationFromSource.CONSOLE.value,
        "from_end_user_id": None,
        "from_account_id": conversation.from_account_id,
        "created_at": int(conversation.created_at.timestamp()),
        "updated_at": int(conversation.updated_at.timestamp()),
        "annotated": False,
        "introduction": None,
        "model_config": _full_model_config(),
        "message_count": message_count,
        "user_feedback_stats": {"like": 0, "dislike": 0},
        "admin_feedback_stats": {"like": 0, "dislike": 0},
    }


def _annotation_contract(annotation: MessageAnnotation, account: Account) -> dict[str, object]:
    return {
        "id": annotation.id,
        "question": annotation.question,
        "content": annotation.content,
        "account": {"id": account.id, "name": account.name, "email": account.email},
        "created_at": int(annotation.created_at.timestamp()),
    }


def _completion_summary_contract(
    conversation: Conversation,
    *,
    account: Account,
    annotation: MessageAnnotation | None = None,
    message: Message | None = None,
) -> dict[str, object]:
    return {
        "id": conversation.id,
        "status": "normal",
        "from_source": ConversationFromSource.CONSOLE.value,
        "from_end_user_id": None,
        "from_end_user_session_id": None,
        "from_account_id": account.id,
        "from_account_name": account.name,
        "read_at": None,
        "created_at": int(conversation.created_at.timestamp()),
        "updated_at": int(conversation.updated_at.timestamp()),
        "annotation": _annotation_contract(annotation, account) if annotation else None,
        "model_config": _simple_model_config(),
        "user_feedback_stats": {"like": 0, "dislike": 0},
        "admin_feedback_stats": {"like": 0, "dislike": 0},
        "message": _simple_message_contract(message) if message else None,
    }


def _single_conversation(payload: dict[str, object], conversation_id: str) -> dict[str, object]:
    assert {key: value for key, value in payload.items() if key != "data"} == {
        "page": 1,
        "limit": 20,
        "total": 1,
        "has_more": False,
    }
    data = payload["data"]
    assert isinstance(data, list)
    assert len(data) == 1
    item = data[0]
    assert isinstance(item, dict)
    assert item["id"] == conversation_id
    return item


def test_chat_conversation_status_count_includes_paused(
    container_transaction: Session,
    authenticated_console_app_client: AuthenticatedConsoleAppClient,
) -> None:
    account = authenticated_console_app_client.account
    tenant = authenticated_console_app_client.tenant
    app = authenticated_console_app_client.app
    conversation = _create_conversation(container_transaction, app.id, account.id)
    workflow_run = _create_workflow_run(container_transaction, app.id, tenant.id, account.id)
    _create_message(container_transaction, app.id, conversation.id, workflow_run.id, account.id)

    response = authenticated_console_app_client.client.get(
        f"/console/api/apps/{app.id}/chat-conversations",
        headers=authenticated_console_app_client.headers,
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    assert payload == {
        "page": 1,
        "limit": 20,
        "total": 1,
        "has_more": False,
        "data": [
            _chat_summary_contract(
                conversation,
                account_name=account.name,
                message_count=1,
                status_count={"success": 0, "failed": 0, "partial_success": 0, "paused": 1},
            )
        ],
    }


def test_chat_conversation_detail_marks_read_and_delete_persists(
    container_transaction: Session,
    authenticated_console_app_client: AuthenticatedConsoleAppClient,
    container_state: DatabaseState,
) -> None:
    conversation = _create_conversation(
        container_transaction,
        authenticated_console_app_client.app.id,
        authenticated_console_app_client.account.id,
    )
    message = _create_message(
        container_transaction,
        authenticated_console_app_client.app.id,
        conversation.id,
        workflow_run_id=None,
        account_id=authenticated_console_app_client.account.id,
    )
    message_id = message.id
    url = f"/console/api/apps/{authenticated_console_app_client.app.id}/chat-conversations/{conversation.id}"

    detail_response = authenticated_console_app_client.client.get(
        url,
        headers=authenticated_console_app_client.headers,
    )

    assert detail_response.status_code == 200
    assert detail_response.json is not None
    persisted = container_state.one(Conversation, Conversation.id == conversation.id)
    assert persisted.read_at is not None
    assert persisted.read_account_id == authenticated_console_app_client.account.id
    assert detail_response.json == _chat_detail_contract(persisted, message_count=1)

    with patch("services.conversation_service.delete_conversation_related_data.delay") as mock_delete_related_data:
        delete_response = authenticated_console_app_client.client.delete(
            url,
            headers=authenticated_console_app_client.headers,
        )

    assert delete_response.status_code == 204
    assert container_state.count(Conversation, Conversation.id == conversation.id) == 0
    assert container_state.count(Message, Message.id == message_id) == 1
    mock_delete_related_data.assert_called_once_with(conversation.id)


def test_completion_conversation_list_detail_and_delete_lifecycle(
    container_transaction: Session,
    authenticated_console_client: AuthenticatedConsoleClient,
    console_app_factory: ConsoleAppFactory,
    container_state: DatabaseState,
) -> None:
    app = console_app_factory(AppMode.COMPLETION)
    conversation = _create_conversation(
        container_transaction,
        app.id,
        authenticated_console_client.account.id,
        mode=AppMode.COMPLETION,
    )
    message = _create_message(
        container_transaction,
        app.id,
        conversation.id,
        workflow_run_id=None,
        account_id=authenticated_console_client.account.id,
    )
    message_id = message.id
    collection_url = f"/console/api/apps/{app.id}/completion-conversations"
    detail_url = f"{collection_url}/{conversation.id}"

    list_response = authenticated_console_client.client.get(
        collection_url,
        headers=authenticated_console_client.headers,
    )
    detail_response = authenticated_console_client.client.get(
        detail_url,
        headers=authenticated_console_client.headers,
    )

    assert list_response.status_code == 200
    assert list_response.json is not None
    expected_list: dict[str, object] = {
        "page": 1,
        "limit": 20,
        "total": 1,
        "has_more": False,
        "data": [
            {
                "id": conversation.id,
                "status": "normal",
                "from_source": ConversationFromSource.CONSOLE.value,
                "from_end_user_id": None,
                "from_end_user_session_id": None,
                "from_account_id": authenticated_console_client.account.id,
                "from_account_name": authenticated_console_client.account.name,
                "read_at": None,
                "created_at": int(conversation.created_at.timestamp()),
                "updated_at": int(conversation.updated_at.timestamp()),
                "annotation": None,
                "model_config": _simple_model_config(),
                "user_feedback_stats": {"like": 0, "dislike": 0},
                "admin_feedback_stats": {"like": 0, "dislike": 0},
                "message": _simple_message_contract(message),
            }
        ],
    }
    assert list_response.json == expected_list
    assert detail_response.status_code == 200
    assert detail_response.json is not None
    persisted = container_state.one(Conversation, Conversation.id == conversation.id)
    assert detail_response.json == {
        "id": conversation.id,
        "status": "normal",
        "from_source": ConversationFromSource.CONSOLE.value,
        "from_end_user_id": None,
        "from_account_id": authenticated_console_client.account.id,
        "created_at": int(conversation.created_at.timestamp()),
        "model_config": _full_model_config(),
        "message": _message_contract(message),
    }
    assert persisted.read_at is not None

    with patch("services.conversation_service.delete_conversation_related_data.delay") as mock_delete_related_data:
        delete_response = authenticated_console_client.client.delete(
            detail_url,
            headers=authenticated_console_client.headers,
        )

    assert delete_response.status_code == 204
    assert container_state.count(Conversation, Conversation.id == conversation.id) == 0
    assert container_state.count(Message, Message.id == message_id) == 1
    mock_delete_related_data.assert_called_once_with(conversation.id)


def test_conversation_lists_apply_persisted_filters_and_validate_ranges(
    container_transaction: Session,
    authenticated_console_client: AuthenticatedConsoleClient,
    console_app_factory: ConsoleAppFactory,
) -> None:
    account = authenticated_console_client.account
    headers = authenticated_console_client.headers
    client = authenticated_console_client.client
    chat_app = console_app_factory(AppMode.CHAT)
    completion_app = console_app_factory(AppMode.COMPLETION)

    chat_annotated = _create_conversation(container_transaction, chat_app.id, account.id)
    chat_annotated.name = "Needle chat"
    chat_annotated.created_at = datetime(2026, 1, 10, 10, 0)
    chat_annotated.updated_at = datetime(2026, 1, 12, 10, 0)
    chat_unannotated = _create_conversation(container_transaction, chat_app.id, account.id)
    chat_unannotated.name = "Other chat"
    chat_unannotated.created_at = datetime(2026, 1, 11, 10, 0)
    chat_unannotated.updated_at = datetime(2026, 1, 11, 10, 0)
    completion_annotated = _create_conversation(
        container_transaction,
        completion_app.id,
        account.id,
        mode=AppMode.COMPLETION,
    )
    completion_annotated.created_at = datetime(2026, 1, 10, 10, 0)
    completion_unannotated = _create_conversation(
        container_transaction,
        completion_app.id,
        account.id,
        mode=AppMode.COMPLETION,
    )
    completion_unannotated.created_at = datetime(2026, 1, 11, 10, 0)
    chat_message = _create_message(
        container_transaction,
        chat_app.id,
        chat_annotated.id,
        workflow_run_id=None,
        account_id=account.id,
    )
    completion_message = _create_message(
        container_transaction,
        completion_app.id,
        completion_annotated.id,
        workflow_run_id=None,
        account_id=account.id,
    )
    completion_message.query = "Find this needle"
    chat_annotation = MessageAnnotation(
        app_id=chat_app.id,
        conversation_id=chat_annotated.id,
        message_id=chat_message.id,
        question="Q",
        content="A",
        account_id=account.id,
    )
    completion_annotation = MessageAnnotation(
        app_id=completion_app.id,
        conversation_id=completion_annotated.id,
        message_id=completion_message.id,
        question="Q",
        content="A",
        account_id=account.id,
    )
    container_transaction.add_all([chat_annotation, completion_annotation])
    container_transaction.commit()
    chat_annotated_id = chat_annotated.id
    chat_unannotated_id = chat_unannotated.id
    completion_annotated_id = completion_annotated.id
    completion_unannotated_id = completion_unannotated.id
    chat_app_id = chat_app.id
    completion_app_id = completion_app.id

    chat_annotated_response = client.get(
        f"/console/api/apps/{chat_app_id}/chat-conversations",
        query_string={
            "keyword": "Needle",
            "annotation_status": "annotated",
            "start": "2026-01-10 00:00",
            "end": "2026-01-10 23:59",
            "sort_by": "created_at",
        },
        headers=headers,
    )
    chat_unannotated_response = client.get(
        f"/console/api/apps/{chat_app_id}/chat-conversations",
        query_string={
            "annotation_status": "not_annotated",
            "start": "2026-01-11 00:00",
            "end": "2026-01-11 23:59",
            "sort_by": "updated_at",
        },
        headers=headers,
    )
    completion_annotated_response = client.get(
        f"/console/api/apps/{completion_app_id}/completion-conversations",
        query_string={
            "keyword": "needle",
            "annotation_status": "annotated",
            "start": "2026-01-10 00:00",
            "end": "2026-01-10 23:59",
        },
        headers=headers,
    )
    completion_unannotated_response = client.get(
        f"/console/api/apps/{completion_app_id}/completion-conversations",
        query_string={"annotation_status": "not_annotated"},
        headers=headers,
    )
    invalid_range_response = client.get(
        f"/console/api/apps/{chat_app_id}/chat-conversations",
        query_string={"start": "2026-01-12 00:00", "end": "2026-01-11 00:00"},
        headers=headers,
    )

    assert chat_annotated_response.status_code == 200
    assert chat_annotated_response.json is not None
    chat_annotated_item = _single_conversation(chat_annotated_response.json, chat_annotated_id)
    assert chat_annotated_item == _chat_summary_contract(
        chat_annotated,
        account_name=account.name,
        message_count=1,
        annotated=True,
    )
    assert chat_unannotated_response.status_code == 200
    assert chat_unannotated_response.json is not None
    chat_unannotated_item = _single_conversation(chat_unannotated_response.json, chat_unannotated_id)
    assert chat_unannotated_item == _chat_summary_contract(
        chat_unannotated,
        account_name=account.name,
        message_count=0,
    )
    assert completion_annotated_response.status_code == 200
    assert completion_annotated_response.json is not None
    completion_annotated_item = _single_conversation(completion_annotated_response.json, completion_annotated_id)
    assert completion_annotated_item == _completion_summary_contract(
        completion_annotated,
        account=account,
        annotation=completion_annotation,
        message=completion_message,
    )
    assert completion_unannotated_response.status_code == 200
    assert completion_unannotated_response.json is not None
    completion_unannotated_item = _single_conversation(completion_unannotated_response.json, completion_unannotated_id)
    assert completion_unannotated_item == _completion_summary_contract(
        completion_unannotated,
        account=account,
    )
    assert invalid_range_response.status_code == 400
