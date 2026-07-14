from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import InternalServerError

import controllers.console.explore.audio as audio_module
from controllers.console.app.error import (
    AppUnavailableError,
    AudioTooLargeError,
    CompletionRequestError,
    NoAudioUploadedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
    SpeechToTextDisabledError,
)
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from graphon.model_runtime.errors.invoke import InvokeError
from services.app_ref_service import MessageRef
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    SpeechToTextDisabledServiceError,
)


def unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


@pytest.fixture
def installed_app():
    app = MagicMock()
    app.app = MagicMock()
    app.app.id = "app-1"
    app.app.tenant_id = "tenant-1"
    return app


@pytest.fixture
def audio_file():
    return (BytesIO(b"audio"), "audio.wav")


class TestChatAudioApi:
    def setup_method(self):
        self.api = audio_module.ChatAudioApi()
        self.method = unwrap(self.api.post)

    def test_post_success(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                return_value={"text": "ok"},
            ),
        ):
            resp = self.method(installed_app)

        assert resp == {"text": "ok"}

    def test_app_unavailable(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=audio_module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(AppUnavailableError):
                self.method(installed_app)

    def test_no_audio_uploaded(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=NoAudioUploadedServiceError(),
            ),
        ):
            with pytest.raises(NoAudioUploadedError):
                self.method(installed_app)

    def test_audio_too_large(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=AudioTooLargeServiceError("too big"),
            ),
        ):
            with pytest.raises(AudioTooLargeError):
                self.method(installed_app)

    def test_provider_quota_exceeded(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                self.method(installed_app)

    def test_unknown_exception(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=Exception("boom"),
            ),
        ):
            with pytest.raises(InternalServerError):
                self.method(installed_app)

    def test_unsupported_audio_type(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=audio_module.UnsupportedAudioTypeServiceError(),
            ),
        ):
            with pytest.raises(audio_module.UnsupportedAudioTypeError):
                self.method(installed_app)

    def test_provider_not_support_speech_to_text(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=audio_module.ProviderNotSupportSpeechToTextServiceError(),
            ),
        ):
            with pytest.raises(audio_module.ProviderNotSupportSpeechToTextError):
                self.method(installed_app)

    def test_speech_to_text_disabled(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=SpeechToTextDisabledServiceError(),
            ),
        ):
            with pytest.raises(SpeechToTextDisabledError):
                self.method(installed_app)

    def test_provider_not_initialized(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=ProviderTokenNotInitError("not init"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                self.method(installed_app)

    def test_model_currently_not_supported(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                self.method(installed_app)

    def test_invoke_error_asr(self, app: Flask, installed_app, audio_file):
        with (
            app.test_request_context(
                "/",
                data={"file": audio_file},
                content_type="multipart/form-data",
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_asr",
                side_effect=InvokeError("invoke failed"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                self.method(installed_app)


class TestChatTextApi:
    def setup_method(self):
        self.api = audio_module.ChatTextApi()
        self.method = unwrap(self.api.post)

    def test_post_success(self, app: Flask, installed_app):
        transcript_tts = MagicMock(return_value={"audio": "ok"})

        with (
            app.test_request_context(
                "/",
                json={"message_id": "m1", "text": "hello", "voice": "v1"},
            ),
            patch.object(
                audio_module,
                "current_account_with_tenant",
                return_value=(MagicMock(id="account-1"), "tenant-1"),
            ),
            patch.object(audio_module.AudioService, "transcript_tts", transcript_tts),
        ):
            resp = self.method(installed_app)

        assert resp == {"audio": "ok"}
        assert transcript_tts.call_args.kwargs["message_ref"] == MessageRef(
            tenant_id="tenant-1",
            app_id="app-1",
            message_id="m1",
            account_id="account-1",
        )

    def test_provider_not_initialized(self, app: Flask, installed_app):
        with (
            app.test_request_context(
                "/",
                json={"text": "hi"},
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_tts",
                side_effect=ProviderTokenNotInitError("not init"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                self.method(installed_app)

    def test_model_not_supported(self, app: Flask, installed_app):
        with (
            app.test_request_context(
                "/",
                json={"text": "hi"},
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_tts",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                self.method(installed_app)

    def test_invoke_error(self, app: Flask, installed_app):
        with (
            app.test_request_context(
                "/",
                json={"text": "hi"},
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_tts",
                side_effect=InvokeError("invoke failed"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                self.method(installed_app)

    def test_unknown_exception(self, app: Flask, installed_app):
        with (
            app.test_request_context(
                "/",
                json={"text": "hi"},
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_tts",
                side_effect=Exception("boom"),
            ),
        ):
            with pytest.raises(InternalServerError):
                self.method(installed_app)

    def test_app_unavailable_tts(self, app: Flask, installed_app):
        with (
            app.test_request_context(
                "/",
                json={"text": "hi"},
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_tts",
                side_effect=audio_module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(AppUnavailableError):
                self.method(installed_app)

    def test_no_audio_uploaded_tts(self, app: Flask, installed_app):
        with (
            app.test_request_context(
                "/",
                json={"text": "hi"},
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_tts",
                side_effect=NoAudioUploadedServiceError(),
            ),
        ):
            with pytest.raises(NoAudioUploadedError):
                self.method(installed_app)

    def test_audio_too_large_tts(self, app: Flask, installed_app):
        with (
            app.test_request_context(
                "/",
                json={"text": "hi"},
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_tts",
                side_effect=AudioTooLargeServiceError("too big"),
            ),
        ):
            with pytest.raises(AudioTooLargeError):
                self.method(installed_app)

    def test_unsupported_audio_type_tts(self, app: Flask, installed_app):
        with (
            app.test_request_context(
                "/",
                json={"text": "hi"},
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_tts",
                side_effect=audio_module.UnsupportedAudioTypeServiceError(),
            ),
        ):
            with pytest.raises(audio_module.UnsupportedAudioTypeError):
                self.method(installed_app)

    def test_provider_not_support_speech_to_text_tts(self, app: Flask, installed_app):
        with (
            app.test_request_context(
                "/",
                json={"text": "hi"},
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_tts",
                side_effect=audio_module.ProviderNotSupportSpeechToTextServiceError(),
            ),
        ):
            with pytest.raises(audio_module.ProviderNotSupportSpeechToTextError):
                self.method(installed_app)

    def test_quota_exceeded_tts(self, app: Flask, installed_app):
        with (
            app.test_request_context(
                "/",
                json={"text": "hi"},
            ),
            patch.object(
                audio_module.AudioService,
                "transcript_tts",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                self.method(installed_app)
