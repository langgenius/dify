from inspect import unwrap as inspect_unwrap
from io import BytesIO
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, request

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
from graphon.model_runtime.errors.invoke import InvokeError
from models import Account
from models.model import App, AppMode
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
