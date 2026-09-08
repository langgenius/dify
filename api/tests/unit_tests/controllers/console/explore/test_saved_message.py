from collections.abc import Generator
from dataclasses import dataclass
from datetime import UTC, datetime
from inspect import unwrap
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

import controllers.console.explore.saved_message as module
from controllers.console.app.error import AppUnavailableError
from controllers.console.explore.error import NotCompletionAppError
from controllers.console.explore.wraps import InstalledAppResource
from graphon.file import File, FileTransferMethod, FileType
from models.model import InstalledApp
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
_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"
_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222"


@dataclass(frozen=True)
class _ApplicationServiceMocks:
    app_definitions: MagicMock
    saved_messages: MagicMock


def _installed_app() -> InstalledApp:
    return InstalledApp(
        tenant_id=_WORKSPACE_ID,
        app_id="33333333-3333-4333-8333-333333333333",
        app_owner_tenant_id="44444444-4444-4444-8444-444444444444",
        position=0,
        is_pinned=False,
        last_used_at=None,
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
def services() -> Generator[_ApplicationServiceMocks]:
    service_mocks = _ApplicationServiceMocks(
        app_definitions=MagicMock(),
        saved_messages=MagicMock(),
    )
    service_mocks.app_definitions.get_mode.return_value = "completion"
    with patch.object(
        module,
        "application_services",
        return_value=service_mocks,
    ):
        yield service_mocks


def test_saved_message_resources_use_installed_app_admission() -> None:
    assert issubclass(module.SavedMessageListApi, InstalledAppResource)
    assert issubclass(module.SavedMessageApi, InstalledAppResource)


class TestSavedMessageListApi:
    def test_get_success(self, app: Flask, services: _ApplicationServiceMocks) -> None:
        installed_app = _installed_app()
        services.saved_messages.pagination_by_last_id.return_value = SavedMessagePage(
            limit=20,
            has_more=False,
            data=(_record(),),
        )

        with (
            app.test_request_context("/", query_string={}),
            patch.object(File, "generate_url", return_value=_INPUT_FILE_URL),
        ):
            result = unwrap(module.SavedMessageListApi().get)(
                module.SavedMessageListApi(),
                _ACCOUNT_ID,
                installed_app,
            )

        services.app_definitions.get_mode.assert_called_once_with(installed_app.app_id)
        services.saved_messages.pagination_by_last_id.assert_called_once_with(
            app_id=installed_app.app_id,
            actor=SavedMessageActor.account(_ACCOUNT_ID),
            last_id=None,
            limit=20,
        )
        assert result == {
            "limit": 20,
            "has_more": False,
            "data": [_expected_record()],
        }

    def test_get_forwards_query(self, app: Flask, services: _ApplicationServiceMocks) -> None:
        installed_app = _installed_app()
        last_id = str(uuid4())
        services.saved_messages.pagination_by_last_id.return_value = SavedMessagePage(limit=50, has_more=True, data=())

        with app.test_request_context("/", query_string={"last_id": last_id, "limit": "50"}):
            unwrap(module.SavedMessageListApi().get)(
                module.SavedMessageListApi(),
                _ACCOUNT_ID,
                installed_app,
            )

        services.saved_messages.pagination_by_last_id.assert_called_once_with(
            app_id=installed_app.app_id,
            actor=SavedMessageActor.account(_ACCOUNT_ID),
            last_id=last_id,
            limit=50,
        )

    def test_get_preserves_invalid_last_id_context(self, app: Flask, services: _ApplicationServiceMocks) -> None:
        installed_app = _installed_app()
        last_id = str(uuid4())
        description = "The last_id cursor does not belong to the current saved messages."
        services.saved_messages.pagination_by_last_id.side_effect = LastMessageNotExistsError(description)

        with (
            app.test_request_context("/", query_string={"last_id": last_id}),
            pytest.raises(LastMessageNotExistsError, match="last_id") as raised,
        ):
            unwrap(module.SavedMessageListApi().get)(
                module.SavedMessageListApi(),
                _ACCOUNT_ID,
                installed_app,
            )

        assert raised.value.description == description

    def test_get_rejects_missing_app(self, app: Flask, services: _ApplicationServiceMocks) -> None:
        services.app_definitions.get_mode.side_effect = module.AppDefinitionUnavailableError

        with app.test_request_context("/"), pytest.raises(AppUnavailableError):
            unwrap(module.SavedMessageListApi().get)(
                module.SavedMessageListApi(),
                _ACCOUNT_ID,
                _installed_app(),
            )

    def test_get_rejects_non_completion_app(self, app: Flask, services: _ApplicationServiceMocks) -> None:
        services.app_definitions.get_mode.return_value = "chat"

        with app.test_request_context("/"), pytest.raises(NotCompletionAppError):
            unwrap(module.SavedMessageListApi().get)(
                module.SavedMessageListApi(),
                _ACCOUNT_ID,
                _installed_app(),
            )

    def test_post_success(self, services: _ApplicationServiceMocks) -> None:
        installed_app = _installed_app()
        message_id = str(uuid4())

        result = unwrap(module.SavedMessageListApi().post)(
            module.SavedMessageListApi(),
            module.SavedMessageCreatePayload.model_validate({"message_id": message_id}),
            _ACCOUNT_ID,
            installed_app,
        )

        services.saved_messages.save.assert_called_once_with(
            app_id=installed_app.app_id,
            actor=SavedMessageActor.account(_ACCOUNT_ID),
            message_id=message_id,
        )
        assert result == {"result": "success"}

    def test_post_maps_missing_message_to_not_found(self, services: _ApplicationServiceMocks) -> None:
        services.saved_messages.save.side_effect = MessageNotExistsError()

        with pytest.raises(NotFound, match="Message Not Exists"):
            unwrap(module.SavedMessageListApi().post)(
                module.SavedMessageListApi(),
                module.SavedMessageCreatePayload.model_validate({"message_id": str(uuid4())}),
                _ACCOUNT_ID,
                _installed_app(),
            )


class TestSavedMessageApi:
    def test_delete_success(self, services: _ApplicationServiceMocks) -> None:
        installed_app = _installed_app()
        message_id = uuid4()

        result = unwrap(module.SavedMessageApi().delete)(
            module.SavedMessageApi(),
            _ACCOUNT_ID,
            installed_app,
            message_id,
        )

        services.saved_messages.delete.assert_called_once_with(
            app_id=installed_app.app_id,
            actor=SavedMessageActor.account(_ACCOUNT_ID),
            message_id=str(message_id),
        )
        assert result == ("", 204)

    def test_delete_rejects_non_completion_app(self, services: _ApplicationServiceMocks) -> None:
        services.app_definitions.get_mode.return_value = "chat"

        with pytest.raises(NotCompletionAppError):
            unwrap(module.SavedMessageApi().delete)(
                module.SavedMessageApi(),
                _ACCOUNT_ID,
                _installed_app(),
                uuid4(),
            )
