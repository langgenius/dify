from datetime import UTC, datetime
from inspect import getsource, signature
from inspect import unwrap as inspect_unwrap
from io import BytesIO
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask, request
from sqlalchemy.orm import Session
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
from controllers.console.explore.trial import ChatRequest, CompletionRequest, TextToSpeechRequest, WorkflowRunRequest
from controllers.web.error import InvokeRateLimitError as InvokeRateLimitHttpError
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.helper import encrypter
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from graphon.model_runtime.errors.invoke import InvokeError
from graphon.variables import SecretVariable, StringVariable
from models import Account, Tenant
from models.account import TenantStatus
from models.dataset import Dataset
from models.model import App, AppMode, Site, UploadFile
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from services.app_ref_service import AppRef, MessageRef
from services.errors.audio import SpeechToTextDisabledServiceError
from services.errors.conversation import ConversationNotExistsError
from services.errors.llm import InvokeRateLimitError

unwrap: Any = inspect_unwrap


class _UsesSQLiteSession:
    sqlite_session: Session

    @pytest.fixture(autouse=True)
    def _provide_sqlite_session(self, sqlite_session: Session):
        self.sqlite_session = sqlite_session


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
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="Trial App",
        mode=mode,
        enable_site=True,
        enable_api=False,
    )


def _upload_file(*, file_id: str = "upload-file-id", tenant_id: str = "app-tenant-id") -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type="opendal",
        key="trial/file.txt",
        name="file.txt",
        size=1,
        extension="txt",
        mime_type="text/plain",
        created_by_role="account",
        created_by="u1",
        created_at=datetime(2024, 1, 1),
        used=False,
    )
    upload_file.id = file_id
    return upload_file


def _file_data() -> Any:
    file_data: Any = BytesIO(b"fake audio data")
    file_data.filename = "test.wav"
    return file_data


def _persist_site(sqlite_session: Session, app_id: str) -> Site:
    site = Site(
        app_id=app_id,
        title="Trial Site",
        default_language="en-US",
        customize_token_strategy="uuid",
    )
    sqlite_session.add(site)
    sqlite_session.commit()
    return site


@pytest.fixture
def trial_app_chat() -> App:
    return _app(app_id="a-chat", mode=AppMode.CHAT)


@pytest.fixture
def trial_app_completion() -> App:
    return _app(app_id="a-comp", mode=AppMode.COMPLETION)


@pytest.fixture
def trial_app_workflow() -> App:
    return _app(app_id="a-workflow", mode=AppMode.WORKFLOW)


def test_trial_workflow_uses_trial_scoped_simple_account_model() -> None:
    assert module.simple_account_model.name == "TrialSimpleAccount"
    assert module.simple_account_model.__schema__["properties"].keys() >= {"id", "name", "email"}


def test_trial_dataset_list_preserves_slim_dataset_fields(app: Flask, unbound_session: Session):
    api = module.DatasetListApi()
    method = unwrap(api.get)
    app_model = _app(app_id="app-1", mode=AppMode.CHAT)
    dataset = Dataset(
        id="dataset-1",
        tenant_id=app_model.tenant_id,
        name="Dataset",
        description="description",
        permission="only_me",
        data_source_type="upload_file",
        indexing_technique="high_quality",
        created_by="user-1",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )
    dataset.permission_keys = ["dataset.acl.readonly"]  # type: ignore[attr-defined]
    with (
        app.test_request_context("/?page=1&limit=20&ids=dataset-1"),
        patch.object(
            module.DatasetService,
            "get_datasets_by_ids",
            return_value=([dataset], 1),
        ) as get_datasets,
    ):
        result = method(api, unbound_session, app_model)

    get_datasets.assert_called_once_with(["dataset-1"], "tenant-1", session=unbound_session)
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


class TestTrialAppFileUploadApi:
    def test_upload_uses_trial_app_tenant(self, app: Flask, account: Account) -> None:
        api = module.TrialAppFileUploadApi()
        method = unwrap(api.post)
        app_model = _app(app_id="app-1", mode=AppMode.CHAT, tenant_id="app-tenant-id")
        upload_file = _upload_file()

        with (
            app.test_request_context("/", method="POST"),
            patch.object(module, "upload_file_from_request", return_value=upload_file) as upload,
            patch.object(module, "dump_response", return_value={"id": "upload-file-id"}),
        ):
            response, status = method(api, account, app_model)

        assert status == 201
        assert response == {"id": "upload-file-id"}
        upload.assert_called_once_with(current_user=account, resource_tenant_id="app-tenant-id")


class TestTrialAppRemoteFileUploadApi:
    def test_upload_uses_trial_app_tenant(self, app: Flask, account: Account) -> None:
        api = module.TrialAppRemoteFileUploadApi()
        method = unwrap(api.post)
        app_model = _app(app_id="app-1", mode=AppMode.CHAT, tenant_id="app-tenant-id")
        remote_file = MagicMock()
        remote_file.model_dump.return_value = {"id": "upload-file-id"}

        with (
            app.test_request_context("/", method="POST", json={"url": "https://example.com/file.txt"}),
            patch.object(module, "upload_remote_file_from_request", return_value=remote_file) as upload,
        ):
            response, status = method(api, account, app_model)

        assert status == 201
        assert response == {"id": "upload-file-id"}
        upload.assert_called_once_with(current_user=account, resource_tenant_id="app-tenant-id")


class TestTrialAppWorkflowRunApi(_UsesSQLiteSession):
    def test_not_workflow_app(self, app: Flask, account: Account) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={"inputs": {}}):
            with pytest.raises(NotWorkflowAppError):
                method(
                    api,
                    WorkflowRunRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    _app(app_id="not-workflow", mode=AppMode.CHAT),
                )

    def test_success(
        self,
        app: Flask,
        trial_app_workflow: App,
        account: Account,
        trial_app_usage: MagicMock,
    ) -> None:
        api = module.TrialAppWorkflowRunApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}}),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
        ):
            result = method(
                api,
                WorkflowRunRequest.model_validate(request.get_json()),
                self.sqlite_session,
                account,
                trial_app_workflow,
            )

        assert result is not None
        trial_app_usage.record.assert_called_once_with(app_id="a-workflow", account_id="u1")

    def test_workflow_provider_not_init(self, app: Flask, trial_app_workflow: App, account: Account) -> None:
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
                method(
                    api,
                    WorkflowRunRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_workflow,
                )

    def test_workflow_quota_exceeded(self, app: Flask, trial_app_workflow: App, account: Account) -> None:
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
                method(
                    api,
                    WorkflowRunRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_workflow,
                )

    def test_workflow_model_not_support(self, app: Flask, trial_app_workflow: App, account: Account) -> None:
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
                method(
                    api,
                    WorkflowRunRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_workflow,
                )

    def test_workflow_invoke_error(self, app: Flask, trial_app_workflow: App, account: Account) -> None:
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
                method(
                    api,
                    WorkflowRunRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_workflow,
                )

    def test_workflow_rate_limit_error(self, app: Flask, trial_app_workflow: App, account: Account) -> None:
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
                method(
                    api,
                    WorkflowRunRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_workflow,
                )

    def test_workflow_value_error(self, app: Flask, trial_app_workflow: App, account: Account) -> None:
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
                method(
                    api,
                    WorkflowRunRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_workflow,
                )

    def test_workflow_generic_exception(self, app: Flask, trial_app_workflow: App, account: Account) -> None:
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
                method(
                    api,
                    WorkflowRunRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_workflow,
                )


class TestTrialChatApi(_UsesSQLiteSession):
    def test_not_chat_app(self, app: Flask, account: Account) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={"inputs": {}, "query": "hi"}):
            with pytest.raises(NotChatAppError):
                method(
                    api,
                    ChatRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    _app(app_id="not-chat", mode=AppMode.COMPLETION),
                )

    def test_success(
        self,
        app: Flask,
        trial_app_chat: App,
        account: Account,
        trial_app_usage: MagicMock,
    ) -> None:
        api = module.TrialChatApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": "hi"}),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
        ):
            result = method(
                api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
            )

        assert result is not None
        trial_app_usage.record.assert_called_once_with(app_id="a-chat", account_id="u1")

    def test_chat_conversation_not_exists(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
                method(
                    api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
                )

    def test_chat_conversation_completed(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
                method(
                    api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
                )

    def test_chat_app_config_broken(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
                method(
                    api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
                )

    def test_chat_provider_not_init(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
                method(
                    api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
                )

    def test_chat_quota_exceeded(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
                method(
                    api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
                )

    def test_chat_model_not_support(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
                method(
                    api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
                )

    def test_chat_invoke_error(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
                method(
                    api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
                )

    def test_chat_rate_limit_error(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
                method(
                    api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
                )

    def test_chat_value_error(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
                method(
                    api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
                )

    def test_chat_generic_exception(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
                method(
                    api, ChatRequest.model_validate(request.get_json()), self.sqlite_session, account, trial_app_chat
                )


class TestTrialCompletionApi(_UsesSQLiteSession):
    def test_not_completion_app(self, app: Flask, account: Account) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with app.test_request_context("/", json={"inputs": {}, "query": ""}):
            with pytest.raises(NotCompletionAppError):
                method(
                    api,
                    CompletionRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    _app(app_id="not-completion", mode=AppMode.CHAT),
                )

    def test_success(
        self,
        app: Flask,
        trial_app_completion: App,
        account: Account,
        trial_app_usage: MagicMock,
    ) -> None:
        api = module.TrialCompletionApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/", json={"inputs": {}, "query": ""}),
            patch.object(module.AppGenerateService, "generate", return_value=MagicMock()),
        ):
            result = method(
                api,
                CompletionRequest.model_validate(request.get_json()),
                self.sqlite_session,
                account,
                trial_app_completion,
            )

        assert result is not None
        trial_app_usage.record.assert_called_once_with(app_id="a-comp", account_id="u1")

    def test_completion_app_config_broken(self, app: Flask, trial_app_completion: App, account: Account) -> None:
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
                method(
                    api,
                    CompletionRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_completion,
                )

    def test_completion_provider_not_init(self, app: Flask, trial_app_completion: App, account: Account) -> None:
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
                method(
                    api,
                    CompletionRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_completion,
                )

    def test_completion_quota_exceeded(self, app: Flask, trial_app_completion: App, account: Account) -> None:
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
                method(
                    api,
                    CompletionRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_completion,
                )

    def test_completion_model_not_support(self, app: Flask, trial_app_completion: App, account: Account) -> None:
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
                method(
                    api,
                    CompletionRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_completion,
                )

    def test_completion_invoke_error(self, app: Flask, trial_app_completion: App, account: Account) -> None:
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
                method(
                    api,
                    CompletionRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_completion,
                )

    def test_completion_rate_limit_error(self, app: Flask, trial_app_completion: App, account: Account) -> None:
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
                method(
                    api,
                    CompletionRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_completion,
                )

    def test_completion_value_error(self, app: Flask, trial_app_completion: App, account: Account) -> None:
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
                method(
                    api,
                    CompletionRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_completion,
                )

    def test_completion_generic_exception(self, app: Flask, trial_app_completion: App, account: Account) -> None:
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
                method(
                    api,
                    CompletionRequest.model_validate(request.get_json()),
                    self.sqlite_session,
                    account,
                    trial_app_completion,
                )


class TestTrialMessageSuggestedQuestionApi:
    def test_not_chat_app(self, app: Flask, account: Account) -> None:
        api = module.TrialMessageSuggestedQuestionApi()
        method = unwrap(api.get)

        with app.test_request_context("/"):
            with pytest.raises(NotChatAppError):
                method(api, account, _app(app_id="not-chat", mode=AppMode.COMPLETION), str(uuid4()))

    def test_success(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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

    def test_conversation_not_exists(self, app: Flask, trial_app_chat: App, account: Account) -> None:
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
    def test_app_unavailable(self, unbound_session: Session) -> None:
        api = module.TrialAppParameterApi()
        method = unwrap(api.get)

        with pytest.raises(AppUnavailableError):
            method(api, unbound_session, None)

    def test_success(self, unbound_session: Session) -> None:
        api = module.TrialAppParameterApi()
        method = unwrap(api.get)
        parameters = get_parameters_from_feature_dict(features_dict={}, user_input_form=[])
        expected = module.ParametersResponse.model_validate(parameters).model_dump(mode="json")
        app_definitions = MagicMock()
        app_definitions.get_parameters.return_value = parameters
        services = SimpleNamespace(app_definitions=app_definitions)

        with patch.object(module, "application_services", return_value=services):
            result = method(api, unbound_session, _app(app_id="app-1", mode=AppMode.CHAT))

        assert result == expected
        app_definitions.get_parameters.assert_called_once_with("app-1")

    def test_unavailable_parameters(self, unbound_session: Session) -> None:
        api = module.TrialAppParameterApi()
        method = unwrap(api.get)
        app_definitions = MagicMock()
        app_definitions.get_parameters.side_effect = module.AppDefinitionUnavailableError
        services = SimpleNamespace(app_definitions=app_definitions)

        with (
            patch.object(module, "application_services", return_value=services),
            pytest.raises(AppUnavailableError),
        ):
            method(api, unbound_session, _app(app_id="app-1", mode=AppMode.CHAT))


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


class TestTrialAppWorkflowTaskStopApi:
    def test_not_workflow_app(self, app: Flask, trial_app_chat: App) -> None:
        api = module.TrialAppWorkflowTaskStopApi()

        with app.test_request_context("/", json={"inputs": {}}):
            with pytest.raises(NotWorkflowAppError):
                api.post(trial_app_chat, str(uuid4()))

    def test_success(self, app: Flask, trial_app_workflow: App) -> None:
        api = module.TrialAppWorkflowTaskStopApi()

        task_id = str(uuid4())
        with (
            app.test_request_context("/"),
            patch.object(module.AppQueueManager, "set_stop_flag_no_user_check") as mock_set_flag,
            patch.object(module.GraphEngineManager, "send_stop_command") as mock_send_cmd,
        ):
            result = api.post(trial_app_workflow, task_id)

        assert result == {"result": "success"}
        mock_set_flag.assert_called_once_with(task_id)
        mock_send_cmd.assert_called_once_with(task_id)


class TestTrialSitApi:
    def test_no_site(
        self,
        app: Flask,
        sqlite_session: Session,
    ) -> None:
        api = module.TrialSitApi()
        method = unwrap(api.get)
        app_model = _app(app_id=str(uuid4()), mode=AppMode.CHAT)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, sqlite_session, app_model)

    def test_archived_tenant(
        self,
        app: Flask,
        sqlite_session: Session,
    ) -> None:
        api = module.TrialSitApi()
        method = unwrap(api.get)

        app_model = _app(app_id=str(uuid4()), mode=AppMode.CHAT)
        tenant = Tenant(name="Archived Tenant", status=TenantStatus.ARCHIVE)
        tenant.id = app_model.tenant_id
        _persist_site(sqlite_session, app_model.id)

        with (
            app.test_request_context("/"),
            patch.object(module.TenantService, "get_tenant_by_id", return_value=tenant) as get_tenant_by_id,
        ):
            with pytest.raises(Forbidden):
                method(api, sqlite_session, app_model)

        get_tenant_by_id.assert_called_once_with("tenant-1", session=sqlite_session)

    def test_success(
        self,
        app: Flask,
        sqlite_session: Session,
    ) -> None:
        api = module.TrialSitApi()
        method = unwrap(api.get)

        app_model = _app(app_id=str(uuid4()), mode=AppMode.CHAT)
        tenant = Tenant(name="Active Tenant", status=TenantStatus.NORMAL)
        tenant.id = app_model.tenant_id
        site = _persist_site(sqlite_session, app_model.id)

        with (
            app.test_request_context("/"),
            patch.object(module.TenantService, "get_tenant_by_id", return_value=tenant) as get_tenant_by_id,
            patch.object(module.SiteResponse, "model_validate") as mock_validate,
        ):
            mock_validate_result = MagicMock()
            mock_validate_result.model_dump.return_value = {"name": "test", "icon": "icon"}
            mock_validate.return_value = mock_validate_result
            result = method(api, sqlite_session, app_model)

        assert result == {"name": "test", "icon": "icon"}
        get_tenant_by_id.assert_called_once_with("tenant-1", session=sqlite_session)
        mock_validate.assert_called_once_with(site)


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
