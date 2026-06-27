from inspect import unwrap as inspect_unwrap
from io import BytesIO
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask, Response, g
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import controllers.console.explore.trial as module
from configs import dify_config
from controllers.console.app.error import (
    AppNotFoundError,
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
from graphon.model_runtime.errors.invoke import InvokeError
from models import Account
from models.account import AccountStatus, TenantStatus
from models.model import AppMode
from services.errors.conversation import ConversationNotExistsError
from services.errors.llm import InvokeRateLimitError

unwrap: Any = inspect_unwrap
TENANT_A_APP_ID = "79b2c301-d895-44c3-b231-afed8857afcb"
TENANT_B_ID = "98aff511-4a83-4be4-a186-a456bc0c1150"


@pytest.fixture
def account() -> Account:
    acc = Account(name="User", email="user@example.com")
    acc.id = "u1"
    return acc


def _file_data() -> Any:
    file_data: Any = BytesIO(b"fake audio data")
    file_data.filename = "test.wav"
    return file_data


@pytest.fixture
def trial_app_chat() -> MagicMock:
    app = MagicMock()
    app.id = "a-chat"
    app.mode = AppMode.CHAT
    return app


@pytest.fixture
def trial_app_completion() -> MagicMock:
    app = MagicMock()
    app.id = "a-comp"
    app.mode = AppMode.COMPLETION
    return app


@pytest.fixture
def trial_app_workflow() -> MagicMock:
    app = MagicMock()
    app.id = "a-workflow"
    app.mode = AppMode.WORKFLOW
    return app


@pytest.fixture
def valid_parameters() -> dict[str, object]:
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


def test_trial_workflow_uses_trial_scoped_simple_account_model() -> None:
    assert module.simple_account_model.name == "TrialSimpleAccount"
    assert hasattr(module.simple_account_model, "items")


def _private_trial_app_from_tenant_a() -> SimpleNamespace:
    return SimpleNamespace(
        id=TENANT_A_APP_ID,
        tenant_id="tenant-a",
        status="normal",
        tenant=SimpleNamespace(status=TenantStatus.NORMAL),
        mode=AppMode.CHAT,
        workflow_id="workflow-a",
        workflow=None,
        app_model_config=SimpleNamespace(to_dict=lambda: {"user_input_form": []}),
    )


def _cross_tenant_scalar(stmt: object) -> object | None:
    where_criteria = getattr(stmt, "_where_criteria", ())
    if any("tenant_id" in str(criterion) for criterion in where_criteria):
        return None

    sql = str(stmt)
    if "sites" in sql:
        return SimpleNamespace(
            title="Private site",
            code="site-secret",
            chat_color_theme=None,
            chat_color_theme_inverted=False,
            default_language="en-US",
            show_workflow_steps=False,
            use_icon_as_answer_icon=False,
        )
    return _private_trial_app_from_tenant_a()


def test_trial_app_detail_read_requires_authenticated_console_user(app: Flask) -> None:
    api = module.AppApi()

    class LoginManager:
        def load_user_from_request_context(self) -> None:
            g._login_user = None

        def unauthorized(self) -> Response:
            return Response(status=401)

    original_login_disabled = dify_config.LOGIN_DISABLED
    dify_config.LOGIN_DISABLED = False
    app.login_manager = LoginManager()
    try:
        with (
            app.test_request_context(f"/trial-apps/{TENANT_A_APP_ID}", method="GET"),
            patch.object(module.db.session, "scalar", side_effect=AssertionError("private app was loaded")),
        ):
            result = api.get(app_id=TENANT_A_APP_ID)
    finally:
        dify_config.LOGIN_DISABLED = original_login_disabled

    assert isinstance(result, Response)
    assert result.status_code == 401


@pytest.mark.parametrize(
    ("resource_cls", "path"),
    [
        (module.TrialSitApi, f"/trial-apps/{TENANT_A_APP_ID}/site"),
        (module.TrialAppParameterApi, f"/trial-apps/{TENANT_A_APP_ID}/parameters"),
        (module.AppApi, f"/trial-apps/{TENANT_A_APP_ID}"),
        (module.AppWorkflowApi, f"/trial-apps/{TENANT_A_APP_ID}/workflows"),
        (module.DatasetListApi, f"/trial-apps/{TENANT_A_APP_ID}/datasets?ids=dataset-a"),
    ],
)
def test_trial_app_read_handlers_reject_cross_tenant_app_ids(
    app: Flask,
    account: Account,
    resource_cls: type,
    path: str,
    valid_parameters: dict[str, object],
) -> None:
    account._current_tenant = SimpleNamespace(id=TENANT_B_ID)
    account.status = AccountStatus.ACTIVE
    api = resource_cls()

    original_login_disabled = dify_config.LOGIN_DISABLED
    dify_config.LOGIN_DISABLED = True
    try:
        with (
            app.test_request_context(path, method="GET"),
            patch("controllers.console.wraps.current_account_with_tenant", return_value=(account, TENANT_B_ID)),
            patch("controllers.console.app.wraps.current_account_with_tenant", return_value=(account, TENANT_B_ID)),
            patch.object(module.db.session, "scalar", side_effect=_cross_tenant_scalar),
            patch.object(module.db.session, "get", return_value=SimpleNamespace(id="workflow-a")),
            patch.object(module.AppService, "get_app", side_effect=lambda app_model: app_model),
            patch.object(module.DatasetService, "get_datasets_by_ids", return_value=([], 0)),
            patch.object(module, "get_parameters_from_feature_dict", return_value=valid_parameters),
            patch.object(
                module.ParametersResponse,
                "model_validate",
                return_value=SimpleNamespace(model_dump=lambda mode=None: {"ok": True}),
            ),
        ):
            with pytest.raises(AppNotFoundError):
                api.get(app_id=TENANT_A_APP_ID)
    finally:
        dify_config.LOGIN_DISABLED = original_login_disabled


class TestTrialAppWorkflowRunApi:
    def test_not_workflow_app(self, app: Flask, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with app.test_request_context("/"):
            with pytest.raises(NotWorkflowAppError):
                method(api, account, MagicMock(mode=AppMode.CHAT))

    def test_success(self, app: Flask, trial_app_workflow: MagicMock, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, account, trial_app_workflow)

        assert result is not None

    def test_workflow_provider_not_init(self, app: Flask, trial_app_workflow: MagicMock, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, account, trial_app_workflow)

    def test_workflow_quota_exceeded(self, app: Flask, trial_app_workflow: MagicMock, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(api, account, trial_app_workflow)

    def test_workflow_model_not_support(self, app: Flask, trial_app_workflow: MagicMock, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(api, account, trial_app_workflow)

    def test_workflow_invoke_error(self, app: Flask, trial_app_workflow: MagicMock, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(api, account, trial_app_workflow)

    def test_workflow_rate_limit_error(self, app: Flask, trial_app_workflow: MagicMock, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeRateLimitError("test"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(api, account, trial_app_workflow)

    def test_workflow_value_error(self, app: Flask, trial_app_workflow: MagicMock, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "files": []}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ValueError("test error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, account, trial_app_workflow)

    def test_workflow_generic_exception(self, app: Flask, trial_app_workflow: MagicMock, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "files": []}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=RuntimeError("unexpected error"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, account, trial_app_workflow)


class TestTrialChatApi:
    def test_not_chat_app(self, app: Flask, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={"inputs": {}, "query": "hi"}):
            with pytest.raises(NotChatAppError):
                method(api, account, MagicMock(mode="completion"))

    def test_success(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, account, trial_app_chat)

        assert result is not None

    def test_chat_conversation_not_exists(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=module.services.errors.conversation.ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, account, trial_app_chat)

    def test_chat_conversation_completed(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=module.services.errors.conversation.ConversationCompletedError(),
            ),
        ):
            with pytest.raises(ConversationCompletedError):
                method(api, account, trial_app_chat)

    def test_chat_app_config_broken(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(AppUnavailableError):
                method(api, account, trial_app_chat)

    def test_chat_provider_not_init(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, account, trial_app_chat)

    def test_chat_quota_exceeded(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(api, account, trial_app_chat)

    def test_chat_model_not_support(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(api, account, trial_app_chat)

    def test_chat_invoke_error(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(api, account, trial_app_chat)

    def test_chat_rate_limit_error(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeRateLimitError("test"),
            ),
        ):
            with pytest.raises(InvokeRateLimitHttpError):
                method(api, account, trial_app_chat)

    def test_chat_value_error(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ValueError("test error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, account, trial_app_chat)

    def test_chat_generic_exception(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=RuntimeError("unexpected error"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, account, trial_app_chat)


class TestTrialCompletionApi:
    def test_not_completion_app(self, app: Flask, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={"inputs": {}, "query": ""}):
            with pytest.raises(NotCompletionAppError):
                method(api, account, MagicMock(mode=AppMode.CHAT))

    def test_success(self, app: Flask, trial_app_completion: MagicMock, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, account, trial_app_completion)

        assert result is not None

    def test_completion_app_config_broken(self, app: Flask, trial_app_completion: MagicMock, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=module.services.errors.app_model_config.AppModelConfigBrokenError(),
            ),
        ):
            with pytest.raises(AppUnavailableError):
                method(api, account, trial_app_completion)

    def test_completion_provider_not_init(self, app: Flask, trial_app_completion: MagicMock, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ProviderTokenNotInitError("test"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, account, trial_app_completion)

    def test_completion_quota_exceeded(self, app: Flask, trial_app_completion: MagicMock, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=QuotaExceededError(),
            ),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(api, account, trial_app_completion)

    def test_completion_model_not_support(self, app: Flask, trial_app_completion: MagicMock, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ModelCurrentlyNotSupportError(),
            ),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(api, account, trial_app_completion)

    def test_completion_invoke_error(self, app: Flask, trial_app_completion: MagicMock, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeError("test error"),
            ),
        ):
            with pytest.raises(CompletionRequestError):
                method(api, account, trial_app_completion)

    def test_completion_rate_limit_error(self, app: Flask, trial_app_completion: MagicMock, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=InvokeRateLimitError("test"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, account, trial_app_completion)

    def test_completion_value_error(self, app: Flask, trial_app_completion: MagicMock, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=ValueError("test error"),
            ),
        ):
            with pytest.raises(ValueError):
                method(api, account, trial_app_completion)

    def test_completion_generic_exception(self, app: Flask, trial_app_completion: MagicMock, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(
                module.AppGenerateService,
                "generate",
                side_effect=RuntimeError("unexpected error"),
            ),
        ):
            with pytest.raises(InternalServerError):
                method(api, account, trial_app_completion)


class TestTrialMessageSuggestedQuestionApi:
    def test_not_chat_app(self, app: Flask, account: Account) -> None:
        api = module.TrialMessageSuggestedQuestionApi()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(NotChatAppError):
                method(api, account, MagicMock(mode="completion"), str(uuid4()))

    def test_success(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialMessageSuggestedQuestionApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                return_value=["q1", "q2"],
            ),
        ):
            result = method(api, account, trial_app_chat, str(uuid4()))

        assert result == {"data": ["q1", "q2"]}

    def test_conversation_not_exists(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialMessageSuggestedQuestionApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                module.MessageService,
                "get_suggested_questions_after_answer",
                side_effect=ConversationNotExistsError(),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, account, trial_app_chat, str(uuid4()))


class TestTrialAppParameterApi:
    def test_app_unavailable(self) -> None:
        api = module.TrialAppParameterApi()
        method = unwrap(api.get)

        with pytest.raises(AppUnavailableError):
            method(api, None)

    def test_success_non_workflow(self, valid_parameters: dict[str, object]) -> None:
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
    def test_success(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatAudioApi()
        method = unwrap(api.post)

        file_data = _file_data()

        with (
            app.test_request_context(
                "/", method="POST", data={"file": (file_data, "test.wav")}, content_type="multipart/form-data"
            ),
            patch.object(module.AudioService, "transcript_asr", return_value={"text": "hello"}),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, account, trial_app_chat)

        assert result == {"text": "hello"}

    def test_app_config_broken(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_no_audio_uploaded(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_audio_too_large(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_unsupported_audio_type(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_provider_not_support_tts(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_provider_not_init(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_quota_exceeded(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)


class TestTrialChatTextApi:
    def test_success(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module.AudioService, "transcript_tts", return_value={"audio": "base64_data"}),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, account, trial_app_chat)

        assert result == {"audio": "base64_data"}

    def test_app_config_broken(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_provider_not_support(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_audio_too_large(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_no_audio_uploaded(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_provider_not_init(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module.AudioService, "transcript_tts", side_effect=ProviderTokenNotInitError("test")),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api, account, trial_app_chat)

    def test_quota_exceeded(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module.AudioService, "transcript_tts", side_effect=QuotaExceededError()),
        ):
            with pytest.raises(ProviderQuotaExceededError):
                method(api, account, trial_app_chat)

    def test_model_not_support(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module.AudioService, "transcript_tts", side_effect=ModelCurrentlyNotSupportError()),
        ):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                method(api, account, trial_app_chat)

    def test_invoke_error(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"text": "hello", "voice": "en-US"}),
            patch.object(module.AudioService, "transcript_tts", side_effect=InvokeError("test error")),
        ):
            with pytest.raises(CompletionRequestError):
                method(api, account, trial_app_chat)


class TestTrialAppWorkflowTaskStopApi:
    def test_not_workflow_app(self, app: Flask, trial_app_chat: MagicMock) -> None:
        api = module.TrialAppWorkflowTaskStopApi()
        method = unwrap(api.post)

        with app.test_request_context("/"):
            with pytest.raises(NotWorkflowAppError):
                method(api, trial_app_chat, str(uuid4()))

    def test_success(self, app: Flask, trial_app_workflow: MagicMock) -> None:
        api = module.TrialAppWorkflowTaskStopApi()
        method = unwrap(api.post)

        task_id = str(uuid4())
        with (
            app.test_request_context("/"),
            patch.object(module.AppQueueManager, "set_stop_flag_no_user_check") as mock_set_flag,
            patch.object(module.GraphEngineManager, "send_stop_command") as mock_send_cmd,
        ):
            result = method(api, trial_app_workflow, task_id)

        assert result == {"result": "success"}
        mock_set_flag.assert_called_once_with(task_id)
        mock_send_cmd.assert_called_once_with(task_id)


class TestTrialSitApi:
    def test_no_site(self, app: Flask) -> None:
        api = module.TrialSitApi()
        method = unwrap(api.get)
        app_model = MagicMock()
        app_model.id = "a1"

        with app.test_request_context("/"), patch.object(module.db.session, "scalar") as mock_scalar:
            mock_scalar.return_value = None
            with pytest.raises(Forbidden):
                method(api, app_model)

    def test_archived_tenant(self, app: Flask) -> None:
        api = module.TrialSitApi()
        method = unwrap(api.get)

        site = MagicMock()
        app_model = MagicMock()
        app_model.id = "a1"
        app_model.tenant = MagicMock()
        app_model.tenant.status = TenantStatus.ARCHIVE

        with app.test_request_context("/"), patch.object(module.db.session, "scalar") as mock_scalar:
            mock_scalar.return_value = site
            with pytest.raises(Forbidden):
                method(api, app_model)

    def test_success(self, app: Flask) -> None:
        api = module.TrialSitApi()
        method = unwrap(api.get)

        site = MagicMock()
        app_model = MagicMock()
        app_model.id = "a1"
        app_model.tenant = MagicMock()
        app_model.tenant.status = TenantStatus.NORMAL

        with (
            app.test_request_context("/"),
            patch.object(module.db.session, "scalar") as mock_scalar,
            patch.object(module.SiteResponse, "model_validate") as mock_validate,
        ):
            mock_scalar.return_value = site
            mock_validate_result = MagicMock()
            mock_validate_result.model_dump.return_value = {"name": "test", "icon": "icon"}
            mock_validate.return_value = mock_validate_result
            result = method(api, app_model)

        assert result == {"name": "test", "icon": "icon"}


class TestTrialChatAudioApiExceptionHandlers:
    def test_provider_not_init(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_quota_exceeded(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_invoke_error(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)


class TestTrialChatTextApiExceptionHandlers:
    def test_app_config_broken(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)

    def test_unsupported_audio_type(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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
                method(api, account, trial_app_chat)
