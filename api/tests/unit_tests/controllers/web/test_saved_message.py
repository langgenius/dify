from collections.abc import Generator
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

import controllers.web.saved_message as module
from controllers.common.controller_schemas import SavedMessageCreatePayload, SavedMessageListQuery
from controllers.web.error import NotCompletionAppError
from graphon.file import File, FileTransferMethod, FileType
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from services.errors.message import LastMessageNotExistsError, MessageNotExistsError
from services.saved_message_service import (
    SavedMessageActor,
    SavedMessageFeedback,
    SavedMessageFileRecord,
    SavedMessagePage,
    SavedMessageRecord,
)

_INPUT_FILE_URL = "https://example.com/input.pdf"
_CREATED_AT = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


def _completion_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.COMPLETION)


def _chat_app() -> App:
    return App(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)


def _end_user() -> EndUser:
    return EndUser(
        id="eu-1",
        tenant_id="tenant-1",
        type=EndUserType.BROWSER,
        session_id="session-1",
    )


def _record() -> SavedMessageRecord:
    input_file = File(
        file_id="66666666-6666-4666-8666-666666666666",
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url=_INPUT_FILE_URL,
        filename="input.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=12,
    )
    return SavedMessageRecord(
        id="55555555-5555-4555-8555-555555555555",
        inputs={"topic": "hello", "document": input_file},
        query="hello",
        answer="world",
        message_files=[
            SavedMessageFileRecord(
                id="77777777-7777-4777-8777-777777777777",
                filename="attachment.pdf",
                type="document",
                url="https://example.com/attachment.pdf",
                mime_type="application/pdf",
                size=34,
                transfer_method="remote_url",
                belongs_to="user",
                upload_file_id="88888888-8888-4888-8888-888888888888",
            )
        ],
        user_feedback=SavedMessageFeedback(rating="like"),
        created_at=_CREATED_AT,
    )


def _expected_record() -> dict[str, object]:
    return {
        "id": "55555555-5555-4555-8555-555555555555",
        "inputs": {
            "topic": "hello",
            "document": {
                "dify_model_identity": "__dify__file__",
                "id": "66666666-6666-4666-8666-666666666666",
                "type": "document",
                "transfer_method": "remote_url",
                "remote_url": _INPUT_FILE_URL,
                "reference": None,
                "filename": "input.pdf",
                "extension": ".pdf",
                "mime_type": "application/pdf",
                "size": 12,
                "related_id": None,
                "url": _INPUT_FILE_URL,
            },
        },
        "query": "hello",
        "answer": "world",
        "message_files": [
            {
                "id": "77777777-7777-4777-8777-777777777777",
                "filename": "attachment.pdf",
                "type": "document",
                "url": "https://example.com/attachment.pdf",
                "mime_type": "application/pdf",
                "size": 34,
                "transfer_method": "remote_url",
                "belongs_to": "user",
                "upload_file_id": "88888888-8888-4888-8888-888888888888",
            }
        ],
        "feedback": {"rating": "like"},
        "created_at": 1767323045,
    }


@pytest.fixture
def saved_messages() -> Generator[MagicMock]:
    service = MagicMock()
    with patch.object(
        module,
        "application_services",
        return_value=SimpleNamespace(saved_messages=service),
    ):
        yield service


_list_get = unwrap(module.SavedMessageListApi.get)
_list_post = unwrap(module.SavedMessageListApi.post)


class TestSavedMessageListApiGet:
    def test_non_completion_mode_raises(self, app: Flask, saved_messages: MagicMock) -> None:
        query = SavedMessageListQuery.model_validate({})
        with app.test_request_context("/saved-messages"), pytest.raises(NotCompletionAppError):
            _list_get(module.SavedMessageListApi(), query, _chat_app(), _end_user())

        saved_messages.pagination_by_last_id.assert_not_called()

    def test_happy_path(self, app: Flask, saved_messages: MagicMock) -> None:
        saved_messages.pagination_by_last_id.return_value = SavedMessagePage(
            limit=20,
            has_more=False,
            data=(_record(),),
        )
        query = SavedMessageListQuery.model_validate({"limit": 20})
        app_model = _completion_app()
        end_user = _end_user()

        with (
            app.test_request_context("/saved-messages?limit=20"),
            patch.object(File, "generate_url", return_value=_INPUT_FILE_URL),
        ):
            result = _list_get(module.SavedMessageListApi(), query, app_model, end_user)

        saved_messages.pagination_by_last_id.assert_called_once_with(
            app_id=app_model.id,
            actor=SavedMessageActor.end_user(end_user.id),
            last_id=None,
            limit=20,
        )
        assert result == {"limit": 20, "has_more": False, "data": [_expected_record()]}

    def test_invalid_last_id_preserves_error_context(self, app: Flask, saved_messages: MagicMock) -> None:
        last_id = str(uuid4())
        description = "The last_id cursor does not belong to the current saved messages."
        saved_messages.pagination_by_last_id.side_effect = LastMessageNotExistsError(description)
        query = SavedMessageListQuery.model_validate({"last_id": last_id})

        with (
            app.test_request_context(f"/saved-messages?last_id={last_id}"),
            pytest.raises(LastMessageNotExistsError, match="last_id") as raised,
        ):
            _list_get(module.SavedMessageListApi(), query, _completion_app(), _end_user())

        assert raised.value.description == description


class TestSavedMessageListApiPost:
    def test_non_completion_mode_raises(self, app: Flask, saved_messages: MagicMock) -> None:
        payload = SavedMessageCreatePayload.model_validate({"message_id": str(uuid4())})
        with app.test_request_context("/saved-messages", method="POST"), pytest.raises(NotCompletionAppError):
            _list_post(module.SavedMessageListApi(), payload, _chat_app(), _end_user())

        saved_messages.save.assert_not_called()

    def test_save_success(self, app: Flask, saved_messages: MagicMock) -> None:
        message_id = str(uuid4())
        payload = SavedMessageCreatePayload.model_validate({"message_id": message_id})
        app_model = _completion_app()
        end_user = _end_user()

        with app.test_request_context("/saved-messages", method="POST"):
            result = _list_post(module.SavedMessageListApi(), payload, app_model, end_user)

        saved_messages.save.assert_called_once_with(
            app_id=app_model.id,
            actor=SavedMessageActor.end_user(end_user.id),
            message_id=message_id,
        )
        assert result == {"result": "success"}

    def test_save_not_found(self, app: Flask, saved_messages: MagicMock) -> None:
        saved_messages.save.side_effect = MessageNotExistsError()
        payload = SavedMessageCreatePayload.model_validate({"message_id": str(uuid4())})

        with (
            app.test_request_context("/saved-messages", method="POST"),
            pytest.raises(NotFound, match="Message Not Exists"),
        ):
            _list_post(module.SavedMessageListApi(), payload, _completion_app(), _end_user())


class TestSavedMessageApi:
    def test_non_completion_mode_raises(self, app: Flask, saved_messages: MagicMock) -> None:
        message_id = uuid4()
        with (
            app.test_request_context(f"/saved-messages/{message_id}", method="DELETE"),
            pytest.raises(NotCompletionAppError),
        ):
            module.SavedMessageApi().delete(_chat_app(), _end_user(), message_id)

        saved_messages.delete.assert_not_called()

    def test_delete_success(self, app: Flask, saved_messages: MagicMock) -> None:
        message_id = uuid4()
        app_model = _completion_app()
        end_user = _end_user()
        with app.test_request_context(f"/saved-messages/{message_id}", method="DELETE"):
            result = module.SavedMessageApi().delete(app_model, end_user, message_id)

        saved_messages.delete.assert_called_once_with(
            app_id=app_model.id,
            actor=SavedMessageActor.end_user(end_user.id),
            message_id=str(message_id),
        )
        assert result == ("", 204)
