from datetime import UTC, datetime
from inspect import getsource, signature
from inspect import unwrap as inspect_unwrap
from io import BytesIO
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import controllers.console.explore.trial as module
from controllers.console.app.error import (
    AppUnavailableError,
    CompletionRequestError,
    ConversationCompletedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
    SpeechToTextDisabledError,
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
from models.account import TenantStatus
from models.model import AppMode
from services.app_ref_service import MessageRef
from services.errors.audio import SpeechToTextDisabledServiceError
from services.errors.conversation import ConversationNotExistsError
from services.errors.llm import InvokeRateLimitError

unwrap: Any = inspect_unwrap


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
    assert module.simple_account_model.__schema__["properties"].keys() >= {"id", "name", "email"}


def test_trial_dataset_list_preserves_slim_dataset_fields(app: Flask):
    class DatasetListItem:
        id = "dataset-1"
        name = "Dataset"
        description = "description"
        permission = "only_me"
        data_source_type = "upload_file"
        indexing_technique = "high_quality"
        created_by = "user-1"
        created_at = datetime(2024, 1, 1, tzinfo=UTC)
        permission_keys = ["dataset.acl.readonly"]

        @property
        def app_count(self):
            raise AssertionError("trial dataset list should not serialize detail-only computed fields")

    api = module.DatasetListApi()
    method = unwrap(api.get)
    app_model = SimpleNamespace(tenant_id="tenant-1")
    session = MagicMock()

    with (
        app.test_request_context("/?page=1&limit=20&ids=dataset-1"),
        patch.object(
            module.DatasetService,
            "get_datasets_by_ids",
            return_value=([DatasetListItem()], 1),
        ) as get_datasets,
    ):
        result = method(api, session, app_model)

    get_datasets.assert_called_once_with(["dataset-1"], "tenant-1", session=session)
    assert result == {
        "data": [
            {
                "id": "dataset-1",
                "name": "Dataset",
                "description": "description",
                "permission": "only_me",
                "data_source_type": "upload_file",
                "indexing_technique": "high_quality",
                "created_by": "user-1",
                "created_at": 1704067200,
                "permission_keys": ["dataset.acl.readonly"],
            }
        ],
        "has_more": False,
        "limit": 20,
        "total": 1,
        "page": 1,
    }


@pytest.mark.parametrize(
    "api_type",
    [module.TrialSitApi, module.TrialAppParameterApi, module.AppApi, module.AppWorkflowApi, module.DatasetListApi],
)
def test_trial_app_handlers_use_explicit_read_session(api_type: type) -> None:
    source = getsource(api_type.get)

    assert "@with_session(write=False)\n    @get_app_model_with_trial(None)" in source
    assert tuple(signature(api_type.get).parameters)[:3] == ("self", "session", "app_model")


def test_trial_app_detail_serializes_with_explicit_session(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    app_model = MagicMock()
    response_view = MagicMock()
    get_app = MagicMock(return_value=app_model)
    build_view = MagicMock(return_value=response_view)
    validated = MagicMock()
    validated.model_dump.return_value = {"id": "app-1"}
    monkeypatch.setattr(module, "AppService", lambda: SimpleNamespace(get_app=get_app))
    monkeypatch.setattr(module, "AppResponseView", build_view)
    monkeypatch.setattr(module.TrialAppDetailResponse, "model_validate", MagicMock(return_value=validated))

    with app.test_request_context("/"):
        result = unwrap(module.AppApi.get)(module.AppApi(), session, app_model)

    assert result == {"id": "app-1"}
    get_app.assert_called_once_with(app_model, session=session)
    build_view.assert_called_once_with(app_model, session=session)
    module.TrialAppDetailResponse.model_validate.assert_called_once_with(response_view, from_attributes=True)


class TestTrialAppWorkflowRunApi:
    def test_not_workflow_app(self, app: Flask, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with app.test_request_context("/"):
            with pytest.raises(NotWorkflowAppError):
                method(api, MagicMock(), account, MagicMock(mode=AppMode.CHAT))

    def test_success(self, app: Flask, trial_app_workflow: MagicMock, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, MagicMock(), account, trial_app_workflow)

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
                method(api, MagicMock(), account, trial_app_workflow)

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
                method(api, MagicMock(), account, trial_app_workflow)

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
                method(api, MagicMock(), account, trial_app_workflow)

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
                method(api, MagicMock(), account, trial_app_workflow)

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
                method(api, MagicMock(), account, trial_app_workflow)

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
                method(api, MagicMock(), account, trial_app_workflow)

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
                method(api, MagicMock(), account, trial_app_workflow)


class TestTrialChatApi:
    def test_not_chat_app(self, app: Flask, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={"inputs": {}, "query": "hi"}):
            with pytest.raises(NotChatAppError):
                method(api, MagicMock(), account, MagicMock(mode="completion"))

    def test_success(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, MagicMock(), account, trial_app_chat)

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
                method(api, MagicMock(), account, trial_app_chat)

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
                method(api, MagicMock(), account, trial_app_chat)

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
                method(api, MagicMock(), account, trial_app_chat)

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
                method(api, MagicMock(), account, trial_app_chat)

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
                method(api, MagicMock(), account, trial_app_chat)

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
                method(api, MagicMock(), account, trial_app_chat)

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
                method(api, MagicMock(), account, trial_app_chat)

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
                method(api, MagicMock(), account, trial_app_chat)

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
                method(api, MagicMock(), account, trial_app_chat)

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
                method(api, MagicMock(), account, trial_app_chat)


class TestTrialCompletionApi:
    def test_not_completion_app(self, app: Flask, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={"inputs": {}, "query": ""}):
            with pytest.raises(NotCompletionAppError):
                method(api, MagicMock(), account, MagicMock(mode=AppMode.CHAT))

    def test_success(self, app: Flask, trial_app_completion: MagicMock, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, MagicMock(), account, trial_app_completion)

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
                method(api, MagicMock(), account, trial_app_completion)

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
                method(api, MagicMock(), account, trial_app_completion)

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
                method(api, MagicMock(), account, trial_app_completion)

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
                method(api, MagicMock(), account, trial_app_completion)

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
                method(api, MagicMock(), account, trial_app_completion)

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
                method(api, MagicMock(), account, trial_app_completion)

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
                method(api, MagicMock(), account, trial_app_completion)

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
                method(api, MagicMock(), account, trial_app_completion)


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
            method(api, MagicMock(), None)

    def test_success_non_workflow(self, valid_parameters: dict[str, object]) -> None:
        api = module.TrialAppParameterApi()
        method = unwrap(api.get)

        app_model = SimpleNamespace(mode=AppMode.CHAT, app_model_config_id="config-1")
        app_model_config = MagicMock(app_id="app-1")
        app_model_config.to_dict.return_value = {"user_input_form": []}
        session = MagicMock()
        session.get.return_value = app_model_config
        annotation_reply = {"enabled": False}

        with (
            patch.object(
                module, "load_annotation_reply_config", return_value=annotation_reply
            ) as load_annotation_reply,
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
            result = method(api, session, app_model)

        assert result == {"ok": True}
        session.get.assert_called_once_with(module.AppModelConfig, "config-1")
        load_annotation_reply.assert_called_once_with(session, "app-1")
        app_model_config.to_dict.assert_called_once_with(annotation_reply=annotation_reply)

    def test_success_workflow(self, valid_parameters: dict[str, object]) -> None:
        api = module.TrialAppParameterApi()
        method = unwrap(api.get)

        app_model = SimpleNamespace(mode=AppMode.WORKFLOW, workflow_id="workflow-1")
        workflow = MagicMock(features_dict={})
        workflow.user_input_form.return_value = []
        session = MagicMock()
        session.get.return_value = workflow

        with (
            patch.object(module, "get_parameters_from_feature_dict", return_value=valid_parameters),
            patch.object(
                module.ParametersResponse,
                "model_validate",
                return_value=MagicMock(model_dump=lambda mode=None: {"ok": True}),
            ),
        ):
            result = method(api, session, app_model)

        assert result == {"ok": True}
        session.get.assert_called_once_with(module.Workflow, "workflow-1")
        workflow.user_input_form.assert_called_once_with(to_old_structure=True)


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

    def test_speech_to_text_disabled(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
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

    def test_success_with_message_ref(self, app: Flask, trial_app_chat: MagicMock, account: Account) -> None:
        api = module.TrialChatTextApi()
        method = unwrap(api.post)
        transcript_tts = MagicMock(return_value={"audio": "base64_data"})
        trial_app_chat.tenant_id = "tenant-1"

        with (
            app.test_request_context("/", json={"text": "hello", "message_id": "message-1"}),
            patch.object(module.AudioService, "transcript_tts", transcript_tts),
            patch.object(module.RecommendedAppService, "add_trial_app_record"),
        ):
            result = method(api, account, trial_app_chat)

        assert result == {"audio": "base64_data"}
        assert transcript_tts.call_args.kwargs["message_ref"] == MessageRef(
            "tenant-1",
            "a-chat",
            "message-1",
            account_id="u1",
        )

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
        session = MagicMock()
        session.scalar.return_value = None

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, session, app_model)

        session.scalar.assert_called_once()

    def test_archived_tenant(self, app: Flask) -> None:
        api = module.TrialSitApi()
        method = unwrap(api.get)

        site = MagicMock()
        app_model = SimpleNamespace(id="a1", tenant_id="tenant-1")
        tenant = SimpleNamespace(status=TenantStatus.ARCHIVE)
        session = MagicMock()
        session.scalar.return_value = site
        session.get.return_value = tenant

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, session, app_model)

        session.scalar.assert_called_once()
        session.get.assert_called_once_with(module.Tenant, "tenant-1")

    def test_success(self, app: Flask) -> None:
        api = module.TrialSitApi()
        method = unwrap(api.get)

        site = MagicMock()
        app_model = SimpleNamespace(id="a1", tenant_id="tenant-1")
        tenant = SimpleNamespace(status=TenantStatus.NORMAL)
        session = MagicMock()
        session.scalar.return_value = site
        session.get.return_value = tenant

        with (
            app.test_request_context("/"),
            patch.object(module.SiteResponse, "model_validate") as mock_validate,
        ):
            mock_validate_result = MagicMock()
            mock_validate_result.model_dump.return_value = {"name": "test", "icon": "icon"}
            mock_validate.return_value = mock_validate_result
            result = method(api, session, app_model)

        assert result == {"name": "test", "icon": "icon"}
        session.scalar.assert_called_once()
        session.get.assert_called_once_with(module.Tenant, "tenant-1")


class TestAppWorkflowApi:
    def test_uses_injected_session(self) -> None:
        api = module.AppWorkflowApi()
        method = unwrap(api.get)
        app_model = SimpleNamespace(workflow_id="workflow-1")
        created_by = SimpleNamespace(id="account-1", name="Creator", email="creator@example.com")
        workflow = SimpleNamespace(
            id="workflow-1",
            graph_dict={"nodes": []},
            features_dict={},
            unique_hash="workflow-hash",
            version="draft",
            marked_name="",
            marked_comment="",
            created_at=datetime(2024, 1, 1, tzinfo=UTC),
            updated_at=datetime(2024, 1, 2, tzinfo=UTC),
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
            get_created_by_account=MagicMock(return_value=created_by),
            get_updated_by_account=MagicMock(return_value=None),
            get_tool_published=MagicMock(return_value=True),
        )
        session = MagicMock()
        session.get.return_value = workflow

        result = method(api, session, app_model)

        assert result == {
            "id": "workflow-1",
            "graph": {"nodes": []},
            "features": {},
            "hash": "workflow-hash",
            "version": "draft",
            "marked_name": "",
            "marked_comment": "",
            "created_by": {"id": "account-1", "name": "Creator", "email": "creator@example.com"},
            "created_at": 1704067200,
            "updated_by": None,
            "updated_at": 1704153600,
            "tool_published": True,
            "environment_variables": [],
            "conversation_variables": [],
            "rag_pipeline_variables": [],
        }
        session.get.assert_called_once_with(module.Workflow, "workflow-1")
        workflow.get_created_by_account.assert_called_once_with(session=session)
        workflow.get_updated_by_account.assert_called_once_with(session=session)
        workflow.get_tool_published.assert_called_once_with(session=session)


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
