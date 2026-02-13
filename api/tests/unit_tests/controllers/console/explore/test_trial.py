from io import BytesIO
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import controllers.console.explore.trial as module
from controllers.console.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.explore.error import (
    NotChatAppError,
    NotCompletionAppError,
    NotWorkflowAppError,
)
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.model_runtime.errors.invoke import InvokeError
from models import Account
from models.account import TenantStatus
from models.model import AppMode
from services.errors.conversation import ConversationNotExistsError
from services.errors.llm import InvokeRateLimitError


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def account():
    acc = MagicMock(spec=Account)
    acc.id = "u1"
    return acc


@pytest.fixture
def trial_app_chat():
    app = MagicMock()
    app.id = "a-chat"
    app.mode = AppMode.CHAT
    return app


@pytest.fixture
def trial_app_completion():
    app = MagicMock()
    app.id = "a-comp"
    app.mode = AppMode.COMPLETION
    return app


@pytest.fixture
def trial_app_workflow():
    app = MagicMock()
    app.id = "a-workflow"
    app.mode = AppMode.WORKFLOW
    return app


@pytest.fixture
def valid_parameters():
    return {
        "user_input_form": [],
        "system_parameters": {},
        "suggested_questions": {},
        "suggested_questions_after_answer": {},
        "speech_to_text": {},
        "text_to_speech": {},
        "retriever_resource": {},
        "annotation_reply": {},
        "more_like_this": {},
        "sensitive_word_avoidance": {},
        "file_upload": {},
    }


class TestTrialAppWorkflowRunApi:
    def test_not_workflow_app(self, app):
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with app.test_request_context("/"):
            with pytest.raises(NotWorkflowAppError):
                method(MagicMock(mode=AppMode.CHAT))

    def test_success(self, app, trial_app_workflow, account):
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(module, "current_user", account),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(trial_app_workflow)

        assert result is not None

    def test_workflow_provider_not_init(self, app, trial_app_workflow, account):
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(trial_app_workflow)

    def test_workflow_quota_exceeded(self, app, trial_app_workflow, account):
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(trial_app_workflow)

    def test_workflow_model_not_support(self, app, trial_app_workflow, account):
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(trial_app_workflow)

    def test_workflow_invoke_error(self, app, trial_app_workflow, account):
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(trial_app_workflow)

    def test_workflow_rate_limit_error(self, app, trial_app_workflow, account):
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeRateLimitError("test"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(trial_app_workflow)

    def test_workflow_value_error(self, app, trial_app_workflow, account):
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "files": []}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ValueError("test error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(trial_app_workflow)

    def test_workflow_generic_exception(self, app, trial_app_workflow, account):
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "files": []}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=RuntimeError("unexpected error"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(trial_app_workflow)


class TestTrialChatApi:
    def test_not_chat_app(self, app):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={"inputs": {}, "query": "hi"}):
            with pytest.raises(NotChatAppError):
                method(api, MagicMock(mode="completion"))

    def test_success(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, trial_app_chat)

        assert result is not None

    def test_chat_conversation_not_exists(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=module.services.errors.conversation.ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, trial_app_chat)

    def test_chat_conversation_completed(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=module.services.errors.conversation.ConversationCompletedError(),
            ),
        ):
            with pytest.raises(ConversationCompletedError):
                method(api, trial_app_chat)

    def test_chat_app_config_broken(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(AppUnavailableError):
                method(api, trial_app_chat)

    def test_chat_provider_not_init(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, trial_app_chat)

    def test_chat_quota_exceeded(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(api, trial_app_chat)

    def test_chat_model_not_support(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(api, trial_app_chat)

    def test_chat_invoke_error(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(api, trial_app_chat)

    def test_chat_rate_limit_error(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeRateLimitError("test"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(api, trial_app_chat)

    def test_chat_value_error(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ValueError("test error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, trial_app_chat)

    def test_chat_generic_exception(self, app, trial_app_chat, account):
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=RuntimeError("unexpected error"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, trial_app_chat)


class TestTrialCompletionApi:
    def test_not_completion_app(self, app):
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={"inputs": {}, "query": ""}):
            with pytest.raises(NotCompletionAppError):
                method(api, MagicMock(mode=AppMode.CHAT))

    def test_success(self, app, trial_app_completion, account):
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module, "current_user", account),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, trial_app_completion)

        assert result is not None

    def test_completion_app_config_broken(self, app, trial_app_completion, account):
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(AppUnavailableError):
                method(api, trial_app_completion)

    def test_completion_provider_not_init(self, app, trial_app_completion, account):
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, trial_app_completion)

    def test_completion_quota_exceeded(self, app, trial_app_completion, account):
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(api, trial_app_completion)

    def test_completion_model_not_support(self, app, trial_app_completion, account):
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(api, trial_app_completion)

    def test_completion_invoke_error(self, app, trial_app_completion, account):
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(api, trial_app_completion)

    def test_completion_rate_limit_error(self, app, trial_app_completion, account):
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeRateLimitError("test"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, trial_app_completion)

    def test_completion_value_error(self, app, trial_app_completion, account):
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ValueError("test error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, trial_app_completion)

    def test_completion_generic_exception(self, app, trial_app_completion, account):
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=RuntimeError("unexpected error"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, trial_app_completion)


class TestTrialMessageSuggestedQuestionApi:
    def test_not_chat_app(self, app):
        api = module.TrialMessageSuggestedQuestionApi()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(NotChatAppError):
                method(api, MagicMock(mode="completion"), str(uuid4()))

    def test_success(self, app, trial_app_chat, account):
        api = module.TrialMessageSuggestedQuestionApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(module, "current_user", account),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                return_value=["q1", "q2"],
            ),
        ):
            result = method(api, trial_app_chat, str(uuid4()))

        assert result == {"data": ["q1", "q2"]}

    def test_conversation_not_exists(self, app, trial_app_chat, account):
        api = module.TrialMessageSuggestedQuestionApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(module, "current_user", account),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, trial_app_chat, str(uuid4()))


class TestTrialAppParameterApi:
    def test_app_unavailable(self):
        api = module.TrialAppParameterApi()
        method = unwrap(api.get)

        with pytest.raises(AppUnavailableError):
            method(api, None)

    def test_success_non_workflow(self, valid_parameters):
        api = module.TrialAppParameterApi()
        method = unwrap(api.get)

        app_model = MagicMock(
            mode=AppMode.CHAT,
            app_model_config=MagicMock(to_dict=lambda: {"user_input_form": []}),
        )

        with (
            patch.object(
                module,
                "get_parameters_from_feature_dict",
                return_value=valid_parameters,
            ),
            patch.object(
                module.ParametersResponse,
                "model_validate",
                return_value=MagicMock(model_dump=lambda mode=None: {"ok": True}),
            ),
        ):
            result = method(api, app_model)

        assert result == {"ok": True}


class TestTrialChatAudioApi:
    def test_success(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(module.AudioService, "transcript_asr", return_value={"text": "hello"}),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, trial_app_chat)

        assert result == {"text": "hello"}

    def test_app_config_broken(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(module.AppUnavailableError):
                method(api, trial_app_chat)

    def test_no_audio_uploaded(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=module.services.errors.audio.NoAudioUploadedServiceError(),
            ),
        ):
            with pytest.raises(module.NoAudioUploadedError):
                method(api, trial_app_chat)

    def test_audio_too_large(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=module.services.errors.audio.AudioTooLargeServiceError("Too large"),
            ),
        ):
            with pytest.raises(module.AudioTooLargeError):
                method(api, trial_app_chat)

    def test_unsupported_audio_type(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=module.services.errors.audio.UnsupportedAudioTypeServiceError(),
            ),
        ):
            with pytest.raises(module.UnsupportedAudioTypeError):
                method(api, trial_app_chat)

    def test_provider_not_support_tts(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=module.services.errors.audio.ProviderNotSupportSpeechToTextServiceError(),
            ),
        ):
            with pytest.raises(module.ProviderNotSupportSpeechToTextError):
                method(api, trial_app_chat)

    def test_provider_not_init(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(module.AudioService, "transcript_asr", side_effect=ProviderTokenNotInitError("test")),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, trial_app_chat)

    def test_quota_exceeded(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(module.AudioService, "transcript_asr", side_effect=QuotaExceededError()),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(api, trial_app_chat)


class TestTrialChatTextApi:
    def test_success(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(module.AudioService, "transcript_tts", return_value={"audio": "base64_data"}),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, trial_app_chat)

        assert result == {"audio": "base64_data"}

    def test_app_config_broken(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(module.AppUnavailableError):
                method(api, trial_app_chat)

    def test_provider_not_support(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.audio.ProviderNotSupportSpeechToTextServiceError(),
            ),
        ):
            with pytest.raises(module.ProviderNotSupportSpeechToTextError):
                method(api, trial_app_chat)

    def test_audio_too_large(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.audio.AudioTooLargeServiceError("Too large"),
            ),
        ):
            with pytest.raises(module.AudioTooLargeError):
                method(api, trial_app_chat)

    def test_no_audio_uploaded(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.audio.NoAudioUploadedServiceError(),
            ),
        ):
            with pytest.raises(module.NoAudioUploadedError):
                method(api, trial_app_chat)

    def test_provider_not_init(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(module.AudioService, "transcript_tts", side_effect=ProviderTokenNotInitError("test")),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, trial_app_chat)

    def test_quota_exceeded(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(module.AudioService, "transcript_tts", side_effect=QuotaExceededError()),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(api, trial_app_chat)

    def test_model_not_support(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(module.AudioService, "transcript_tts", side_effect=ModelCurrentlyNotSupportError()),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(api, trial_app_chat)

    def test_invoke_error(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(module.AudioService, "transcript_tts", side_effect=InvokeError("test error")),
        ):
            with pytest.raises(CompletionRequestError):
                method(api, trial_app_chat)


class TestTrialAppWorkflowTaskStopApi:
    def test_not_workflow_app(self, app, trial_app_chat):
        api = module.TrialAppWorkflowTaskStopApi()
        method = unwrap(api.post)

        with app.test_request_context("/"):
            with pytest.raises(NotWorkflowAppError):
                method(trial_app_chat, str(uuid4()))

    def test_success(self, app, trial_app_workflow, account):
        api = module.TrialAppWorkflowTaskStopApi()
        method = unwrap(api.post)

        task_id = str(uuid4())
        with (
            app.test_request_context("/"),
            patch.object(module, "current_user", account),
            patch.object(module.AppQueueManager, "set_stop_flag_no_user_check") as mock_set_flag,
            patch.object(module.GraphEngineManager, "send_stop_command") as mock_send_cmd,
        ):
            result = method(trial_app_workflow, task_id)

        assert result == {"result": "success"}
        mock_set_flag.assert_called_once_with(task_id)
        mock_send_cmd.assert_called_once_with(task_id)


class TestTrialSitApi:
    def test_no_site(self, app):
        api = module.TrialSitApi()
        method = unwrap(api.get)
        app_model = MagicMock()
        app_model.id = "a1"

        with app.test_request_context("/"), patch.object(module.db.session, "query") as mock_query:
            mock_query.return_value.where.return_value.first.return_value = None
            with pytest.raises(Forbidden):
                method(api, app_model)

    def test_archived_tenant(self, app):
        api = module.TrialSitApi()
        method = unwrap(api.get)

        site = MagicMock()
        app_model = MagicMock()
        app_model.id = "a1"
        app_model.tenant = MagicMock()
        app_model.tenant.status = TenantStatus.ARCHIVE

        with app.test_request_context("/"), patch.object(module.db.session, "query") as mock_query:
            mock_query.return_value.where.return_value.first.return_value = site
            with pytest.raises(Forbidden):
                method(api, app_model)

    def test_success(self, app):
        api = module.TrialSitApi()
        method = unwrap(api.get)

        site = MagicMock()
        app_model = MagicMock()
        app_model.id = "a1"
        app_model.tenant = MagicMock()
        app_model.tenant.status = TenantStatus.NORMAL

        with (
            app.test_request_context("/"),
            patch.object(module.db.session, "query") as mock_query,
            patch.object(module.SiteResponse, "model_validate") as mock_validate,
        ):
            mock_query.return_value.where.return_value.first.return_value = site
            mock_validate_result = MagicMock()
            mock_validate_result.model_dump.return_value = {"name": "test", "icon": "icon"}
            mock_validate.return_value = mock_validate_result
            result = method(api, app_model)

        assert result == {"name": "test", "icon": "icon"}


class TestTrialChatAudioApiExceptionHandlers:
    def test_provider_not_init(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, trial_app_chat)

    def test_quota_exceeded(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(api, trial_app_chat)

    def test_invoke_error(self, app, trial_app_chat, account):
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = BytesIO(b"fake audio data")
        file_data.filename = "test.wav"

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_asr",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(api, trial_app_chat)


class TestTrialChatTextApiExceptionHandlers:
    def test_app_config_broken(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(module.AppUnavailableError):
                method(api, trial_app_chat)

    def test_unsupported_audio_type(self, app, trial_app_chat, account):
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module, "current_user", account),
            patch.object(
                module.AudioService,
                "transcript_tts",
                side_effect=module.services.errors.audio.UnsupportedAudioTypeServiceError("test"),
            ),
        ):
            with pytest.raises(module.UnsupportedAudioTypeError):
                method(api, trial_app_chat)
