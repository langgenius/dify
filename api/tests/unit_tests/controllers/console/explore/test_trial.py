from datetime import UTC, datetime
from inspect import getsource, signature
from inspect import unwrap as inspect_unwrap
from io import BytesIO
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, request
from sqlalchemy.orm import Session

import controllers.console.explore.trial as module
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
    SpeechToTextDisabledError,
)
from controllers.console.explore.trial import TextToSpeechRequest
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.helper import encrypter
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from graphon.model_runtime.errors.invoke import InvokeError
from graphon.variables import SecretVariable, StringVariable
from models import Account
from models.model import App, AppMode
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from services.app_ref_service import AppRef, MessageRef
from services.errors.audio import SpeechToTextDisabledServiceError
from tests.unit_tests.model_factories import make_app

unwrap: Any = inspect_unwrap


@pytest.fixture
def account() -> Account:
    acc = Account(name="User", email="user@example.com")
    acc.id = "u1"
    return acc


@pytest.fixture
def trial_app_usage(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    usage = MagicMock()
    monkeypatch.setattr(
        module,
        "application_services",
        MagicMock(return_value=SimpleNamespace(trial_app_usage=usage)),
    )
    return usage


def _app(*, app_id: str, mode: AppMode, tenant_id: str = "tenant-1") -> App:
    return make_app(app_id=app_id, tenant_id=tenant_id, name="Trial App", mode=mode, icon_type=None, enable_api=False)


def _file_data() -> Any:
    file_data: Any = BytesIO(b"fake audio data")
    file_data.filename = "test.wav"
    return file_data


@pytest.fixture
def trial_app_chat() -> App:
    return _app(app_id="a-chat", mode=AppMode.CHAT)


def test_trial_workflow_uses_trial_scoped_simple_account_model() -> None:
    assert module.simple_account_model.name == "TrialSimpleAccount"
    assert module.simple_account_model.__schema__["properties"].keys() >= {"id", "name", "email"}


@pytest.mark.parametrize(
    "api_type",
    [module.AppApi, module.AppWorkflowApi],
)
def test_preview_handlers_use_explicit_read_session(api_type: type) -> None:
    source = getsource(api_type.get)

    assert "@with_session(write=False)\n    @get_previewable_app_model(None)" in source
    assert tuple(signature(api_type.get).parameters)[:3] == ("self", "session", "app_model")


def test_trial_app_detail_serializes_with_explicit_session(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    app_model = _app(app_id="app-1", mode=AppMode.CHAT)
    response_view = MagicMock()
    get_app = MagicMock(return_value=app_model)
    build_view = MagicMock(return_value=response_view)
    validated = MagicMock()
    validated.model_dump.return_value = {"id": "app-1"}
    monkeypatch.setattr(module, "AppService", lambda: SimpleNamespace(get_app=get_app))
    monkeypatch.setattr(module, "AppResponseView", build_view)
    monkeypatch.setattr(module.TrialAppDetailResponse, "model_validate", MagicMock(return_value=validated))

    with app.test_request_context("/"):
        result = unwrap(module.AppApi.get)(module.AppApi(), unbound_session, app_model)

    assert result == {"id": "app-1"}
    get_app.assert_called_once_with(app_model, session=unbound_session)
    build_view.assert_called_once_with(app_model, session=unbound_session)
    module.TrialAppDetailResponse.model_validate.assert_called_once_with(response_view, from_attributes=True)


class TestTrialChatAudioApi:
    def test_success(
        self,
        app: Flask,
        trial_app_chat: App,
        account: Account,
        trial_app_usage: MagicMock,
    ) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module.AudioService, "transcript_asr", return_value={"text": "hello"}),
        ):
            result = method(api, account, trial_app_chat)

        assert result == {"text": "hello"}
        trial_app_usage.record.assert_called_once_with(app_id="a-chat", account_id="u1")

    def test_app_config_broken(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(module.AppUnavailableError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )

    def test_no_audio_uploaded(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=module.services.errors.audio.NoAudioUploadedServiceError(),
            ),
        ):
            with pytest.raises(module.NoAudioUploadedError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )

    def test_missing_file_field_returns_400(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        """A multipart POST with no `file` field must surface as 400, not 500.

        Verifies the controller passes file=None to AudioService.transcript_asr
        instead of raising a KeyError that would yield HTTP 500.
        """

        def fake_asr(*args, **kwargs):
            assert kwargs["file"] is None
            raise module.services.errors.audio.NoAudioUploadedServiceError()

        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", method="POST", data={}, content_type="multipart/form-data"),
            patch.object(module.AudioService, "transcript_asr", side_effect=fake_asr),
        ):
            with pytest.raises(module.NoAudioUploadedError) as exc_info:
                method(
                    api,
                    account,
                    trial_app_chat,
                )

        assert exc_info.value.code == 400

    def test_audio_too_large(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=module.services.errors.audio.AudioTooLargeServiceError("Too large"),
            ),
        ):
            with pytest.raises(module.AudioTooLargeError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )

    def test_unsupported_audio_type(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=module.services.errors.audio.UnsupportedAudioTypeServiceError(),
            ),
        ):
            with pytest.raises(module.UnsupportedAudioTypeError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )

    def test_provider_not_support_tts(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=module.services.errors.audio.ProviderNotSupportSpeechToTextServiceError(),
            ),
        ):
            with pytest.raises(module.ProviderNotSupportSpeechToTextError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )

    def test_speech_to_text_disabled(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)
        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=SpeechToTextDisabledServiceError(),
            ),
        ):
            with pytest.raises(SpeechToTextDisabledError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )

    def test_provider_not_init(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module.AudioService, "transcript_asr", side_effect=ProviderTokenNotInitError("test")),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )

    def test_quota_exceeded(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module.AudioService, "transcript_asr", side_effect=QuotaExceededError()),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )


class TestTrialChatTextApi:
    def test_success(
        self,
        app: Flask,
        trial_app_chat: App,
        account: Account,
        trial_app_usage: MagicMock,
    ) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module.AudioService, "transcript_tts", return_value={"audio": "base64_data"}),
        ):
            result = method(
                api, TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}), account, trial_app_chat
            )

        assert result == {"audio": "base64_data"}
        trial_app_usage.record.assert_called_once_with(app_id="a-chat", account_id="u1")

    def test_success_with_message_ref(
        self,
        app: Flask,
        trial_app_chat: App,
        account: Account,
        trial_app_usage: MagicMock,
    ) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)
        transcript_tts = MagicMock(return_value={"audio": "base64_data"})
        trial_app_chat.tenant_id = "tenant-1"

        with (
            app.test_request_context("/", json={"text": "hello", "message_id": "message-1"}),
            patch.object(module.AudioService, "transcript_tts", transcript_tts),
        ):
            result = method(
                api, TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}), account, trial_app_chat
            )

        assert result == {"audio": "base64_data"}
        assert transcript_tts.call_args.kwargs["message_ref"] == MessageRef(
            AppRef("tenant-1", "a-chat"),
            "message-1",
            account_id="u1",
        )
        trial_app_usage.record.assert_called_once_with(app_id="a-chat", account_id="u1")

    def test_app_config_broken(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(module.AppUnavailableError):
                method(
                    api,
                    TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}),
                    account,
                    trial_app_chat,
                )

    def test_provider_not_support(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.audio.ProviderNotSupportSpeechToTextServiceError(),
            ),
        ):
            with pytest.raises(module.ProviderNotSupportSpeechToTextError):
                method(
                    api,
                    TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}),
                    account,
                    trial_app_chat,
                )

    def test_audio_too_large(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.audio.AudioTooLargeServiceError("Too large"),
            ),
        ):
            with pytest.raises(module.AudioTooLargeError):
                method(
                    api,
                    TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}),
                    account,
                    trial_app_chat,
                )

    def test_no_audio_uploaded(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.audio.NoAudioUploadedServiceError(),
            ),
        ):
            with pytest.raises(module.NoAudioUploadedError):
                method(
                    api,
                    TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}),
                    account,
                    trial_app_chat,
                )

    def test_provider_not_init(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module.AudioService, "transcript_tts", side_effect=ProviderTokenNotInitError("test")),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(
                    api,
                    TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}),
                    account,
                    trial_app_chat,
                )

    def test_quota_exceeded(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module.AudioService, "transcript_tts", side_effect=QuotaExceededError()),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(
                    api,
                    TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}),
                    account,
                    trial_app_chat,
                )

    def test_model_not_support(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module.AudioService, "transcript_tts", side_effect=ModelCurrentlyNotSupportError()),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(
                    api,
                    TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}),
                    account,
                    trial_app_chat,
                )

    def test_invoke_error(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module.AudioService, "transcript_tts", side_effect=InvokeError("test error")),
        ):
            with pytest.raises(CompletionRequestError):
                method(
                    api,
                    TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}),
                    account,
                    trial_app_chat,
                )


class TestAppWorkflowApi:
    def test_uses_injected_session(self, sqlite_session: Session) -> None:
        api = module.AppWorkflowApi()
        method = unwrap(api.get)
        created_by = Account(name="Creator", email="creator@example.com")
        created_by.id = "account-1"
        app_model = _app(app_id="app-1", mode=AppMode.WORKFLOW)
        with patch("models.workflow.encrypter.encrypt_token", return_value="encrypted-secret"):
            workflow = Workflow.new(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                type="workflow",
                version="draft",
                graph='{"nodes": []}',
                features="{}",
                created_by=created_by.id,
                environment_variables=[
                    SecretVariable(
                        id="env-secret",
                        name="api_key",
                        value="plaintext-secret",
                    ),
                    LLMEnvironmentVariable(
                        id="env-llm",
                        name="shared_model",
                        value={"provider": "provider", "name": "model", "mode": "chat"},
                    ),
                ],
                conversation_variables=[
                    StringVariable(
                        id="conversation-variable-1",
                        name="topic",
                        value="sqlite",
                        selector=["conversation", "topic"],
                    )
                ],
                rag_pipeline_variables=[],
            )
        workflow.id = "workflow-1"
        workflow.created_at = datetime(2024, 1, 1, tzinfo=UTC)
        workflow.updated_at = datetime(2024, 1, 2, tzinfo=UTC)
        app_model.workflow_id = workflow.id
        tool_provider = WorkflowToolProvider(
            name="trial-workflow",
            label="Trial Workflow",
            icon="icon",
            app_id=app_model.id,
            version="1.0.0",
            user_id=created_by.id,
            tenant_id=app_model.tenant_id,
            description="Trial workflow provider",
            parameter_configuration="[]",
        )
        sqlite_session.add_all([created_by, app_model, workflow, tool_provider])
        sqlite_session.commit()

        with patch("models.workflow.encrypter.decrypt_token", return_value="plaintext-secret"):
            result = method(api, sqlite_session, app_model)

        assert result == {
            "id": "workflow-1",
            "graph": {"nodes": []},
            "features": {},
            "hash": workflow.unique_hash,
            "version": "draft",
            "marked_name": "",
            "marked_comment": "",
            "created_by": {"id": "account-1", "name": "Creator", "email": "creator@example.com"},
            "created_at": 1704067200,
            "updated_by": None,
            "updated_at": 1704153600,
            "tool_published": True,
            "environment_variables": [
                {
                    "value_type": "secret",
                    "value": encrypter.full_mask_token(),
                    "id": "env-secret",
                    "name": "api_key",
                    "description": "",
                    "selector": ["env", "api_key"],
                },
                {
                    "value_type": "llm",
                    "value": {"provider": "provider", "name": "model", "mode": "chat"},
                    "id": "env-llm",
                    "name": "shared_model",
                    "description": "",
                    "selector": ["env", "shared_model"],
                },
            ],
            "conversation_variables": [
                {
                    "id": "conversation-variable-1",
                    "name": "topic",
                    "value_type": "string",
                    "value": "sqlite",
                    "description": "",
                }
            ],
            "rag_pipeline_variables": [],
        }


class TestTrialChatAudioApiExceptionHandlers:
    def test_provider_not_init(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )

    def test_quota_exceeded(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )

    def test_invoke_error(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(
                    api,
                    account,
                    trial_app_chat,
                )


class TestTrialChatTextApiExceptionHandlers:
    def test_app_config_broken(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(module.AppUnavailableError):
                method(
                    api,
                    TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}),
                    account,
                    trial_app_chat,
                )

    def test_unsupported_audio_type(self, app: Flask, trial_app_chat: App, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.audio.UnsupportedAudioTypeServiceError("test"),
            ),
        ):
            with pytest.raises(module.UnsupportedAudioTypeError):
                method(
                    api,
                    TextToSpeechRequest.model_validate(request.get_json(silent=True) or {}),
                    account,
                    trial_app_chat,
                )
