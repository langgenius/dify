import hashlib
import io
import json
import zipfile
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace
from typing import Literal, cast, override
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import httpx
import pytest
from flask import Flask, Request, got_request_exception
from pydantic import JsonValue
from sqlalchemy import Connection, Engine, delete, event, func, select, text, update
from sqlalchemy.engine import ExecutionContext
from sqlalchemy.orm import Mapper, Session, SessionTransaction, sessionmaker
from sqlalchemy.pool import QueuePool
from werkzeug.exceptions import Forbidden, Unauthorized
from werkzeug.test import TestResponse

import controllers.common.fields as fields_module
import controllers.console.explore.trial as trial_module
import controllers.console.explore.trial_app_admission as _trial_audio_admission_module
import controllers.console.explore.trial_app_admission as _trial_file_upload_admission_module
import controllers.console.explore.trial_app_admission as _trial_generation_admission_module
import controllers.console.explore.trial_app_admission as _trial_suggested_questions_admission_module
import controllers.console.files as files_module
import controllers.console.remote_files as remote_module
import controllers.console.wraps as console_wraps
import libs.login as login_module
import services.app_service as app_module
import services.file_service as file_module
import services.message_service as message_module
from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.errors import UnauthorizedError
from controllers.console import api as console_api
from controllers.console import console_ns
from controllers.console.app import agent_config_inspector as inspector
from controllers.console.app import preview_admission
from controllers.console.app import preview_admission as _trial_preview_admission_module
from controllers.console.app import preview_admission as _trial_preview_details_admission_module
from controllers.console.explore import trial
from core.agent.entities import AgentToolEntity
from core.app.apps.agent_app.errors import AgentAppNotPublishedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import (
    AppInvokeQuotaExceededError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.file import remote_fetcher
from core.helper import encrypter
from core.model_context import get_credit_usage_metadata
from core.model_manager import ModelInstance
from core.ops.ops_trace_manager import TraceTask
from core.plugin.plugin_service import PluginService
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolParameter
from core.tools.errors import ToolSSRFError
from core.tools.tool_manager import ToolManager
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from enums import DeploymentEdition
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from extensions.ext_storage import StorageType
from graphon.model_runtime.entities import AssistantPromptMessage, PromptMessage
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.errors.invoke import InvokeBadRequestError, InvokeError
from graphon.variables import SecretVariable, StringVariable
from libs.external_api import ExternalApi
from libs.token import generate_csrf_token
from machinery.errors import ActiveWorkspaceRequiredError
from models import Account, AccountTrialAppRecord, Conversation, Message, Tenant, TrialApp
from models import App as _trial_audio_App
from models import App as _trial_file_upload_App
from models import App as _trial_generation_App
from models import App as _trial_preview_App
from models import App as _trial_preview_details_App
from models import App as _trial_suggested_questions_App
from models import AppMode as _trial_audio_AppMode
from models import AppMode as _trial_file_upload_AppMode
from models import AppMode as _trial_generation_AppMode
from models import AppMode as _trial_preview_AppMode
from models import AppMode as _trial_preview_details_AppMode
from models import AppMode as _trial_suggested_questions_AppMode
from models import UploadFile as _trial_file_upload_UploadFile
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
)
from models.agent_config_entities import AgentSoulConfig
from models.dataset import Dataset
from models.enums import ConversationFromSource, CreatorUserRole, CustomizeTokenStrategy, TagType
from models.model import App as _trial_agent_config_App
from models.model import AppMode as _trial_agent_config_AppMode
from models.model import AppModelConfig, IconType, RecommendedApp, Site, Tag, TagBinding
from models.model import UploadFile as _trial_agent_config_UploadFile
from models.provider_ids import GenericProviderID
from models.tools import ToolFile, WorkflowToolProvider
from models.workflow import Workflow
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.app_preview_query_repository import AppPreviewQueryRepository
from repositories.recommended_app_catalog_repository import DatabaseRecommendedAppCatalogRepository
from repositories.trial_app_repository import TrialAppRepository
from services.account_errors import AccountNotFoundError
from services.agent.errors import AgentVersionNotFoundError
from services.agent_config_service import AgentConfigService
from services.app_definition_query_service import AppDefinitionQueryService, AppDefinitionUnavailableError
from services.app_preview_details_adapters import AppPreviewDetailsRuntime
from services.app_preview_query_service import AppPreviewQueryService
from services.app_service import AppResponseView
from services.audio_types import AudioAppRef, AudioOutput, AudioUpload
from services.entities.feature_entities import FeatureModel
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)
from services.errors.conversation import ConversationCompletedError, ConversationNotExistsError
from services.errors.llm import InvokeRateLimitError
from services.feature_service import FeatureService
from services.file_service import FileService
from services.message_suggested_questions_adapters import MessageSuggestedQuestionsRuntime
from services.message_suggested_questions_service import (
    SuggestedQuestionsAccount,
    SuggestedQuestionsActor,
    SuggestedQuestionsActorNotFoundError,
)
from services.recommended_app_query_service import (
    RecommendedAppCatalogPage,
    RecommendedAppDetailRecord,
    RecommendedAppQueryService,
)
from services.remote_file_service import RemoteFileService
from services.trial_app_access_service import TrialAppAccessService, TrialAppRef
from services.trial_app_generation_service import GenerationResponse, TrialAppGenerationService


class TestTrialCases:
    @staticmethod
    def test_trial_workflow_uses_trial_scoped_simple_account_model() -> None:
        assert trial_module.simple_account_model.name == "TrialSimpleAccount"
        assert trial_module.simple_account_model.__schema__["properties"].keys() >= {"id", "name", "email"}

    @staticmethod
    def test_trial_routes_keep_paths_and_endpoints() -> None:
        expected = {
            "TrialAppFileUploadApi": (("/trial-apps/<uuid:app_id>/files/upload",), "trial_app_file_upload"),
            "TrialAppRemoteFileUploadApi": (
                ("/trial-apps/<uuid:app_id>/remote-files/upload",),
                "trial_app_remote_file_upload",
            ),
            "TrialAppWorkflowRunApi": (("/trial-apps/<uuid:app_id>/workflows/run",), "trial_app_workflow_run"),
            "TrialAppWorkflowTaskStopApi": (
                ("/trial-apps/<uuid:app_id>/workflows/tasks/<string:task_id>/stop",),
                None,
            ),
            "TrialChatApi": (("/trial-apps/<uuid:app_id>/chat-messages",), "trial_app_chat_completion"),
            "TrialChatTaskStopApi": (
                ("/trial-apps/<uuid:app_id>/chat-messages/<string:task_id>/stop",),
                "trial_app_stop_chat_completion",
            ),
            "TrialAgentComposerApi": (("/trial-apps/<uuid:app_id>/agent-composer",), None),
            "TrialMessageSuggestedQuestionApi": (
                ("/trial-apps/<uuid:app_id>/messages/<uuid:message_id>/suggested-questions",),
                "trial_app_suggested_question",
            ),
            "TrialChatAudioApi": (("/trial-apps/<uuid:app_id>/audio-to-text",), "trial_app_audio"),
            "TrialChatTextApi": (("/trial-apps/<uuid:app_id>/text-to-audio",), "trial_app_text"),
            "TrialCompletionApi": (("/trial-apps/<uuid:app_id>/completion-messages",), "trial_app_completion"),
            "TrialSitApi": (("/trial-apps/<uuid:app_id>/site",), None),
            "TrialAppParameterApi": (("/trial-apps/<uuid:app_id>/parameters",), "trial_app_parameters"),
            "AppApi": (("/trial-apps/<uuid:app_id>",), "trial_app"),
            "AppWorkflowApi": (("/trial-apps/<uuid:app_id>/workflows",), "trial_app_workflow"),
            "DatasetListApi": (("/trial-apps/<uuid:app_id>/datasets",), "trial_app_datasets"),
        }
        actual = {
            resource.__name__: (urls, kwargs.get("endpoint"))
            for resource, urls, _route_doc, kwargs in console_ns.resources
            if resource.__module__ == trial_module.__name__
        }

        assert actual == expected


"""Exercise public template assets through real admission, snapshots, and file services."""


@dataclass
class Harness:
    app: Flask
    factory: sessionmaker[Session]
    source: _trial_agent_config_App
    agent: Agent
    snapshot: AgentConfigSnapshot
    upload_id: str
    skill_id: str
    reads: list[str]

    def url(self, suffix: str) -> str:
        return f"/console/api/trial-apps/{self.source.id}/agent/config/{suffix}"

    def get(self, suffix: str, **query: str) -> TestResponse:
        return self.app.test_client().get(self.url(suffix), query_string=query)


class TestTrialAgentConfigCases:
    @staticmethod
    @pytest.fixture
    def harness(
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
    ) -> Harness:
        config_overrides(SECRET_KEY="trial-config-test", FILES_URL="http://localhost")
        tenant_id, agent_id, snapshot_id, account_id = (str(uuid4()) for _ in range(4))
        source = _trial_agent_config_App(
            id=str(uuid4()),
            tenant_id=tenant_id,
            name="Template",
            mode=_trial_agent_config_AppMode.AGENT,
            is_public=True,
            enable_site=False,
            enable_api=False,
        )
        agent = Agent(
            id=agent_id,
            tenant_id=tenant_id,
            app_id=source.id,
            name="Template",
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            active_config_snapshot_id=snapshot_id,
        )
        skill_id = str(uuid4())
        skill_zip = io.BytesIO()
        with zipfile.ZipFile(skill_zip, "w") as archive:
            archive.writestr("SKILL.md", "---\nname: research\ndescription: Research\n---\nPublished skill")
            archive.writestr("scripts/run.py", "print('published')")
        payloads = {"skill.zip": skill_zip.getvalue(), "guide.txt": b"Published attachment"}
        upload = _trial_agent_config_UploadFile(
            tenant_id=tenant_id,
            storage_type=StorageType.LOCAL,
            key="guide.txt",
            name="guide.txt",
            size=len(payloads["guide.txt"]),
            extension="txt",
            mime_type="text/plain",
            created_by=account_id,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_at=datetime(2026, 1, 1),
            used=False,
        )
        snapshot = AgentConfigSnapshot(
            id=snapshot_id,
            tenant_id=tenant_id,
            agent_id=agent_id,
            version=1,
            config_snapshot=AgentSoulConfig.model_validate(
                {
                    "config_skills": [{"name": "research", "file_id": skill_id}],
                    "config_files": [{"name": "guide.txt", "file_kind": "upload_file", "file_id": upload.id}],
                }
            ),
        )
        skill_file = ToolFile(
            tenant_id=tenant_id,
            user_id=account_id,
            conversation_id=None,
            file_key="skill.zip",
            mimetype="application/zip",
            name="research.zip",
            size=len(payloads["skill.zip"]),
        )
        skill_file.id = skill_id
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    source,
                    agent,
                    snapshot,
                    upload,
                    skill_file,
                    RecommendedApp(
                        app_id=source.id,
                        description={},
                        copyright="",
                        privacy_policy="",
                        category="Agent",
                        categories=["Agent"],
                        custom_disclaimer="",
                        position=1,
                        is_listed=True,
                        language="en-US",
                    ),
                    AgentConfigRevision(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                        current_snapshot_id=snapshot_id,
                        revision=1,
                        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
                    ),
                    AgentConfigDraft(
                        tenant_id=tenant_id,
                        agent_id=agent_id,
                        draft_type=AgentConfigDraftType.DRAFT,
                        draft_owner_key="",
                        base_snapshot_id=snapshot_id,
                        config_snapshot=AgentSoulConfig.model_validate(
                            {
                                "config_files": [
                                    {"name": "private.txt", "file_kind": "upload_file", "file_id": upload.id}
                                ],
                            }
                        ),
                    ),
                ]
            )

        reads: list[str] = []

        def load_once(key: str) -> bytes:
            reads.append(key)
            return payloads[key]

        monkeypatch.setattr("services.agent_config_service.storage", SimpleNamespace(load_once=load_once))
        catalog = DatabaseRecommendedAppCatalogRepository(sqlite_session_factory, redis=Mock())
        services = SimpleNamespace(
            app_previews=AppPreviewQueryService(
                apps=AppPreviewQueryRepository(session_factory=sqlite_session_factory),
                is_previewable=catalog.contains,
            )
        )
        monkeypatch.setattr(preview_admission, "application_services", lambda: services)
        monkeypatch.setattr(inspector, "application_services", lambda: services)
        monkeypatch.setattr(trial, "application_services", lambda: services)
        monkeypatch.setattr(inspector, "_service", lambda: AgentConfigService(session_factory=sqlite_session_factory))
        app = Flask(__name__)
        api = ExternalApi(app)
        api.add_resource(trial.TrialAgentComposerApi, "/console/api/trial-apps/<uuid:app_id>/agent-composer")
        routes = [
            (inspector.TrialAgentConfigSkillsApi, "skills"),
            (inspector.TrialAgentConfigFilesApi, "files"),
            (inspector.TrialAgentConfigSkillInspectApi, "skills/<string:name>/inspect"),
            (inspector.TrialAgentConfigSkillDownloadApi, "skills/<string:name>/download"),
            (inspector.TrialAgentConfigSkillFilePreviewApi, "skills/<string:name>/files/preview"),
            (inspector.TrialAgentConfigSkillFileDownloadApi, "skills/<string:name>/files/download"),
            (inspector.TrialAgentConfigFilePreviewApi, "files/<string:name>/preview"),
            (inspector.TrialAgentConfigFileDownloadApi, "files/<string:name>/download"),
        ]
        prefix = "/console/api/trial-apps/<uuid:app_id>/agent/config/"
        for resource, suffix in routes:
            api.add_resource(resource, prefix + suffix)
        api.add_resource(
            inspector.TrialAgentConfigSkillFileContentApi,
            prefix + "skills/<string:name>/files/content",
            endpoint="console.trial_agent_config_skill_file_content",
        )
        return Harness(app, sqlite_session_factory, source, agent, snapshot, upload.id, skill_id, reads)

    @staticmethod
    def test_published_template_configuration_is_readable_without_workspace_membership(harness: Harness) -> None:
        composer_url = f"/console/api/trial-apps/{harness.source.id}/agent-composer"
        composer = harness.app.test_client().get(composer_url)
        assert composer.status_code == 200
        assert composer.json is not None
        assert composer.json["agent_soul"]["config_files"][0]["name"] == "guide.txt"
        assert composer.json["active_config_snapshot"]["id"] == harness.snapshot.id
        assert composer.json["draft"] is None
        assert composer.json["save_options"] == []
        for kind, name in [("skills", "research"), ("files", "guide.txt")]:
            response = harness.get(kind)
            assert response.status_code == 200
            assert response.json is not None
            assert response.json["items"][0]["name"] == name
            assert response.json["config_version"] == {"id": harness.snapshot.id, "kind": "snapshot", "writable": False}
        response = harness.get("skills/research/inspect")
        assert response.status_code == 200
        assert response.json is not None
        assert "Published skill" in response.json["skill_md"]["text"]
        response = harness.get("skills/research/files/preview", path="scripts/run.py")
        assert response.status_code == 200
        assert response.json is not None
        assert response.json["text"] == "print('published')"
        response = harness.get("files/guide.txt/preview", version_id=harness.snapshot.id)
        assert response.status_code == 200
        assert response.json is not None
        assert response.json["text"] == "Published attachment"
        assert response.headers["Cache-Control"] == "no-store"
        for path in ["files/guide.txt/download", "skills/research/download"]:
            response = harness.get(path)
            assert response.status_code == 200
            assert response.json is not None
            assert {"timestamp", "nonce", "sign"} <= parse_qs(urlsplit(response.json["url"]).query).keys()
        response = harness.get("skills/research/files/download", path="scripts/run.py")
        assert response.json is not None
        url = response.json["url"]
        download = harness.app.test_client().get(url)
        assert download.status_code == 200
        assert download.data == b"print('published')"
        assert download.headers["Content-Disposition"].startswith("attachment;")
        with harness.factory() as session:
            assert session.scalar(select(func.count()).select_from(AgentConfigDraft)) == 1
            assert session.scalar(select(func.count()).select_from(_trial_agent_config_UploadFile)) == 1
        with harness.factory.begin() as session:
            app = session.get(_trial_agent_config_App, harness.source.id)
            assert app is not None
            app.is_public = False
        reads_before = list(harness.reads)
        assert harness.app.test_client().get(url).status_code == 404
        assert harness.app.test_client().get(composer_url).status_code == 404
        assert harness.reads == reads_before

    @staticmethod
    @pytest.mark.parametrize(
        ("query", "status"),
        [
            ({"draft_type": "draft"}, 422),
            ({"file_id": "other"}, 422),
            ({"version_id": str(uuid4())}, 404),
        ],
    )
    def test_version_and_resource_selectors_cannot_bypass_admission(
        harness: Harness,
        query: dict[str, str],
        status: int,
    ) -> None:
        assert harness.get("files/guide.txt/preview", **query).status_code == status
        assert harness.reads == []

    @staticmethod
    @pytest.mark.parametrize("path", ["../SKILL.md", "scripts/../../SKILL.md"])
    def test_skill_member_paths_cannot_escape_archive(harness: Harness, path: str) -> None:
        assert harness.get("skills/research/files/preview", path=path).status_code == 400
        assert harness.reads == []

    @staticmethod
    @pytest.mark.parametrize("kind", ["file", "skill"])
    def test_foreign_tenant_payloads_are_not_read(harness: Harness, kind: str) -> None:
        with harness.factory.begin() as session:
            if kind == "file":
                upload = session.get(_trial_agent_config_UploadFile, harness.upload_id)
                assert upload is not None
                upload.tenant_id = str(uuid4())
            else:
                skill = session.get(ToolFile, harness.skill_id)
                assert skill is not None
                skill.tenant_id = str(uuid4())
        suffix = "files/guide.txt/preview" if kind == "file" else "skills/research/files/preview"
        assert harness.get(suffix, **({"path": "SKILL.md"} if kind == "skill" else {})).status_code == 404
        assert harness.reads == []

    @staticmethod
    def test_draft_only_files_and_writes_are_unavailable(harness: Harness) -> None:
        assert harness.get("files/private.txt/preview").status_code == 404
        for method in ["POST", "PUT", "PATCH", "DELETE"]:
            assert harness.app.test_client().open(harness.url("files"), method=method).status_code == 405
        assert harness.reads == []

    @staticmethod
    @pytest.mark.parametrize(
        ("state", "status"),
        [
            ("unlisted", 404),
            ("unpublished", 400),
            ("foreign_snapshot", 400),
        ],
    )
    def test_unavailable_template_never_reads_storage(harness: Harness, state: str, status: int) -> None:
        with harness.factory.begin() as session:
            if state == "unlisted":
                listing = session.scalar(select(RecommendedApp).where(RecommendedApp.app_id == harness.source.id))
                assert listing is not None
                listing.is_listed = False
            elif state == "unpublished":
                revision = session.scalar(
                    select(AgentConfigRevision).where(AgentConfigRevision.agent_id == harness.agent.id)
                )
                assert revision is not None
                revision.operation = AgentConfigRevisionOperation.IMPORT_PACKAGE
            else:
                snapshot = session.get(AgentConfigSnapshot, harness.snapshot.id)
                assert snapshot is not None
                snapshot.tenant_id = str(uuid4())
        preview = harness.get("files/guide.txt/preview")
        assert preview.status_code == status
        assert preview.json is not None
        assert preview.json["status"] == status
        if status == 400:
            # Raised inside the template guard, so its error answer is built by the surface and not cached.
            assert preview.headers["Cache-Control"] == "no-store"
        composer = harness.app.test_client().get(f"/console/api/trial-apps/{harness.source.id}/agent-composer")
        assert composer.status_code == status
        if status == 400:
            assert composer.json is not None
            assert composer.json["code"] == "app_unavailable"
        assert harness.reads == []


"""Trial audio admission, response and usage contracts through HTTP and SQLite."""


_ASR = "audio-to-text"
_TTS = "text-to-audio"
_WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"a" * 32


@dataclass
class _TrialAudioFeaturestate:
    enabled: bool = True
    setup_completed: bool = True
    events: list[str] = field(default_factory=list)

    def is_trial_enabled(self) -> bool:
        self.events.append("feature")
        return self.enabled


@dataclass(frozen=True)
class _AsrCall:
    app: AudioAppRef
    content: bytes | None
    mime_type: str | None


@dataclass(frozen=True)
class _TtsCall:
    app: AudioAppRef
    account_id: str
    text: str | None
    voice: str | None
    message_id: str | None


@dataclass
class _TrialAudioStream(Iterator[bytes]):
    chunks: Iterator[bytes] = field(default_factory=lambda: iter([b"a" * 32, b"remaining-audio"]))
    reads: int = 0
    close_calls: int = 0
    close_error: Exception | None = None

    @override
    def __next__(self) -> bytes:
        chunk = next(self.chunks)
        self.reads += 1
        return chunk

    def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


@dataclass
class _TrialAudioRuntime:
    sessions: list[Session]
    output: AudioOutput | None = field(default_factory=lambda: AudioOutput(data=_WAV, mime_type=None))
    error: Exception | None = None
    calls: list[_AsrCall | _TtsCall] = field(default_factory=list)

    def _assert_admission_closed(self) -> None:
        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)

    def transcript_asr(self, *, app: AudioAppRef, audio: AudioUpload | None) -> dict[str, str]:
        self._assert_admission_closed()
        self.calls.append(_AsrCall(app, audio.stream.read() if audio else None, audio.mime_type if audio else None))
        if self.error is not None:
            raise self.error
        if audio is None:
            raise NoAudioUploadedServiceError()
        return {"text": " transcript "}

    def transcript_tts(
        self,
        *,
        app: AudioAppRef,
        account_id: str,
        text: str | None,
        voice: str | None,
        message_id: str | None,
    ) -> AudioOutput | None:
        self._assert_admission_closed()
        self.calls.append(_TtsCall(app, account_id, text, voice, message_id))
        if self.error is not None:
            raise self.error
        return self.output


@dataclass(frozen=True)
class _TrialAudioTrialappservices:
    access: TrialAppAccessService
    usage: TrialAppRepository


@dataclass(frozen=True)
class _TrialAudioApplicationservices:
    trial_apps: _TrialAudioTrialappservices
    app_audio: _TrialAudioRuntime
    recommended_app_queries: _TrialAudioFeaturestate


@dataclass(frozen=True)
class _TrialAudioHarness:
    app: Flask
    account: Account
    target: _trial_audio_App
    trial: TrialApp
    factory: sessionmaker[Session]
    runtime: _TrialAudioRuntime
    state: _TrialAudioFeaturestate

    def post(self, endpoint: str, *, payload: Mapping[str, object] | None = None) -> TestResponse:
        client = self.app.test_client()
        url = f"/trial-apps/{self.target.id}/{endpoint}"
        if endpoint == _ASR:
            return client.post(url, data={"file": (BytesIO(b"audio input"), "recording.m4a", "audio/x-m4a")})
        return client.post(url, json=dict(payload) if payload is not None else {"text": "Hello"})

    def usage(self) -> int | None:
        with self.factory() as session:
            return session.scalar(
                select(AccountTrialAppRecord.count).where(
                    AccountTrialAppRecord.app_id == self.target.id,
                    AccountTrialAppRecord.account_id == self.account.id,
                )
            )


def _trial_audio_assert_error(response: TestResponse, status: int, code: str) -> Mapping[str, object]:
    assert response.status_code == status
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == code
    assert body["status"] == status
    assert response.headers["Content-Type"] == "application/json"
    assert isinstance(body["message"], str)
    assert body["message"]
    return body


class TestTrialAudioCases:
    @staticmethod
    @pytest.fixture
    def harness(
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        sqlite_session_factory: sessionmaker[Session],
    ) -> _TrialAudioHarness:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, INIT_PASSWORD="", LOGIN_DISABLED=False)
        state = _TrialAudioFeaturestate()
        account = Account(name="Viewer", email="viewer@example.com")
        account.status = AccountStatus.ACTIVE
        account._current_tenant = Tenant(name="Viewer workspace")
        target = _trial_audio_App(
            id=str(uuid4()),
            tenant_id=str(uuid4()),
            name="Trial app",
            mode=_trial_audio_AppMode.CHAT,
            enable_site=True,
            enable_api=True,
        )
        trial = TrialApp(app_id=target.id, tenant_id=target.tenant_id, trial_limit=3)
        with sqlite_session_factory.begin() as session:
            session.add_all([target, trial])

        sessions: list[Session] = []
        repository_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

        @event.listens_for(repository_factory, "after_begin")
        def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            sessions.append(session)

        runtime = _TrialAudioRuntime(sessions=sessions)
        repository = TrialAppRepository(session_factory=repository_factory)
        services = _TrialAudioApplicationservices(
            trial_apps=_TrialAudioTrialappservices(access=TrialAppAccessService(apps=repository), usage=repository),
            app_audio=runtime,
            recommended_app_queries=state,
        )

        def setup_completed() -> bool:
            state.events.append("setup")
            return state.setup_completed

        def csrf(_request: Request, account_id: str) -> None:
            assert account_id == account.id
            state.events.append("csrf")

        for module in (trial_module, _trial_audio_admission_module):
            monkeypatch.setattr(module, "application_services", lambda: services)
        monkeypatch.setattr(console_wraps, "_is_setup_completed", setup_completed)
        monkeypatch.setattr(login_module, "current_user", account)
        monkeypatch.setattr(login_module, "check_csrf_token", csrf)
        app = Flask(__name__)
        app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
        login_manager = DifyLoginManager()
        login_manager.init_app(app)
        login_manager.unauthorized_handler(unauthorized_handler)
        api = ExternalApi(app)
        api.add_resource(trial_module.TrialChatAudioApi, "/trial-apps/<uuid:app_id>/audio-to-text")
        api.add_resource(trial_module.TrialChatTextApi, "/trial-apps/<uuid:app_id>/text-to-audio")
        return _TrialAudioHarness(app, account, target, trial, sqlite_session_factory, runtime, state)

    @staticmethod
    def test_asr_upload_keeps_transcript_and_owner_tenant(harness: _TrialAudioHarness) -> None:
        response = harness.post(_ASR)

        assert response.status_code == 200
        assert response.get_json() == {"text": " transcript "}
        assert response.headers["Content-Type"] == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        assert harness.runtime.calls == [
            _AsrCall(AudioAppRef(harness.target.id, harness.target.tenant_id, "chat"), b"audio input", "audio/x-m4a")
        ]
        assert harness.target.tenant_id != harness.account.current_tenant_id
        assert harness.state.events == ["setup", "csrf", "feature"]
        assert harness.usage() == 1

    @staticmethod
    @pytest.mark.parametrize("streaming", [None, False, True])
    def test_tts_preserves_payload_actor_and_binary_response_ignoring_streaming_flag(
        harness: _TrialAudioHarness, streaming: bool | None
    ) -> None:
        message_id = str(uuid4())
        response = harness.post(
            _TTS, payload={"text": "  hello  ", "voice": "voice-1", "message_id": message_id, "streaming": streaming}
        )

        assert response.status_code == 200
        assert response.data == _WAV
        assert response.headers["Content-Type"] == "audio/wav"
        assert int(response.headers["Content-Length"]) == len(_WAV)
        assert harness.runtime.calls == [
            _TtsCall(
                AudioAppRef(harness.target.id, harness.target.tenant_id, "chat"),
                harness.account.id,
                "  hello  ",
                "voice-1",
                message_id,
            )
        ]
        assert harness.usage() == 1

    @staticmethod
    @pytest.mark.parametrize("null_fields", [False, True])
    def test_missing_message_null_response_still_records_usage(harness: _TrialAudioHarness, null_fields: bool) -> None:
        harness.runtime.output = None
        payload: dict[str, object] = {"text": None, "voice": None, "message_id": None} if null_fields else {}
        response = harness.post(_TTS, payload=payload)

        assert response.status_code == 200
        assert response.get_json() is None
        assert response.headers["Content-Type"] == "application/json"
        assert harness.runtime.calls == [
            _TtsCall(
                AudioAppRef(harness.target.id, harness.target.tenant_id, "chat"), harness.account.id, None, None, None
            )
        ]
        assert harness.usage() == 1

    @staticmethod
    def test_missing_upload_passes_none_and_does_not_record_usage(harness: _TrialAudioHarness) -> None:
        response = harness.app.test_client().post(f"/trial-apps/{harness.target.id}/{_ASR}", data={})

        _trial_audio_assert_error(response, 400, "no_audio_uploaded")
        assert harness.runtime.calls == [
            _AsrCall(AudioAppRef(harness.target.id, harness.target.tenant_id, "chat"), None, None)
        ]
        assert harness.usage() is None

    @staticmethod
    def test_oversized_multipart_request_keeps_transport_error(harness: _TrialAudioHarness) -> None:
        harness.app.config["MAX_CONTENT_LENGTH"] = 1

        response = harness.post(_ASR)

        _trial_audio_assert_error(response, 413, "request_entity_too_large")
        assert harness.runtime.calls == []
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize("endpoint", [_ASR, _TTS])
    @pytest.mark.parametrize(
        ("error", "status", "code"),
        [
            (AppDefinitionUnavailableError("app removed"), 400, "app_unavailable"),
            (AppModelConfigBrokenError(), 400, "app_unavailable"),
            (ProviderTokenNotInitError("provider key missing"), 400, "provider_not_initialize"),
            (QuotaExceededError(), 400, "provider_quota_exceeded"),
            (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support"),
            (InvokeError("provider rejected audio"), 400, "completion_request_error"),
            (ValueError("Text is required"), 400, "invalid_param"),
            (UnauthorizedError("session expired"), 401, "unauthorized"),
            (AgentVersionNotFoundError(), 404, "agent_version_not_found_error"),
            (RuntimeError("private provider failure"), 500, "internal_server_error"),
            (Forbidden("private provider failure"), 500, "internal_server_error"),
        ],
    )
    def test_runtime_errors_keep_specific_codes_without_recording_usage(
        harness: _TrialAudioHarness, endpoint: str, error: Exception, status: int, code: str
    ) -> None:
        harness.runtime.error = error
        response = harness.post(endpoint)

        body = _trial_audio_assert_error(response, status, code)
        if isinstance(error, (ProviderTokenNotInitError, InvokeError)):
            assert body["message"] == error.description
        elif code in {"audio_too_large", "invalid_param"}:
            assert str(error) in str(body["message"])
        elif status == 401:
            assert body["message"] == "session expired"
            assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
        elif status == 404:
            assert body["message"] == "Agent config version not found."
        elif status == 500:
            assert body["message"] == (
                "The server encountered an internal error and was unable to complete your request. "
                "Either the server is overloaded or there is an error in the application."
            )
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize(
        ("error", "status", "code"),
        [
            (NoAudioUploadedServiceError(), 400, "no_audio_uploaded"),
            (AudioTooLargeServiceError("Audio size larger than 30 mb"), 413, "audio_too_large"),
            (UnsupportedAudioTypeServiceError(), 415, "unsupported_audio_type"),
            (ProviderNotSupportSpeechToTextServiceError(), 400, "provider_not_support_speech_to_text"),
            (SpeechToTextDisabledServiceError(), 400, "speech_to_text_disabled"),
        ],
    )
    def test_transcription_errors_keep_specific_codes_without_recording_usage(
        harness: _TrialAudioHarness, error: Exception, status: int, code: str
    ) -> None:
        # Only transcription validates the upload and needs a speech-to-text model; synthesis documents none of these.
        harness.runtime.error = error
        body = _trial_audio_assert_error(harness.post(_ASR), status, code)
        if code == "audio_too_large":
            assert str(error) in str(body["message"])
        assert harness.usage() is None

    @staticmethod
    def test_unsupported_tts_provider_has_specific_error(harness: _TrialAudioHarness) -> None:
        harness.runtime.error = ProviderNotSupportTextToSpeechServiceError()

        _trial_audio_assert_error(harness.post(_TTS), 400, "provider_not_support_text_to_speech")
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize("field", ["text", "voice", "message_id", "streaming"])
    def test_invalid_tts_payload_keeps_field_context(harness: _TrialAudioHarness, field: str) -> None:
        response = harness.post(_TTS, payload={field: ["invalid"]})

        body = _trial_audio_assert_error(response, 422, "unprocessable_entity")
        assert field in str(body)
        assert harness.runtime.calls == []
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize("endpoint", [_ASR, _TTS])
    @pytest.mark.parametrize(
        ("gate", "status", "code"),
        [
            ("setup", 401, "not_setup"),
            ("login", 401, "unauthorized"),
            ("csrf", 401, "unauthorized"),
            ("initialization", 400, "account_not_initialized"),
            ("feature", 403, "trial_app_feature_disabled"),
        ],
    )
    def test_console_and_trial_gates_run_before_app_lookup(
        harness: _TrialAudioHarness, monkeypatch: pytest.MonkeyPatch, endpoint: str, gate: str, status: int, code: str
    ) -> None:
        if gate == "setup":
            harness.state.setup_completed = False
        elif gate == "login":
            monkeypatch.setattr(login_module, "current_user", None)
        elif gate == "csrf":

            def reject_csrf(_request: Request, _account_id: str) -> None:
                raise Unauthorized("invalid csrf token")

            monkeypatch.setattr(login_module, "check_csrf_token", reject_csrf)
        elif gate == "initialization":
            harness.account.status = AccountStatus.UNINITIALIZED
        else:
            harness.state.enabled = False
        response = harness.post(endpoint)

        if gate == "login":
            assert response.status_code == 401
            assert response.get_json() == {"code": "unauthorized", "message": "Unauthorized.", "status": 401}
            assert response.headers["Content-Type"] == "application/json"
        else:
            _trial_audio_assert_error(response, status, code)
        assert harness.runtime.calls == []
        assert harness.runtime.sessions == []
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize("endpoint", [_ASR, _TTS])
    @pytest.mark.parametrize("gate", ["membership", "missing-app", "quota"])
    def test_trial_membership_and_account_quota_block_audio(
        harness: _TrialAudioHarness, endpoint: str, gate: str
    ) -> None:
        with harness.factory.begin() as session:
            if gate == "membership":
                trial = session.get(TrialApp, harness.trial.id)
                assert trial is not None
                session.delete(trial)
            elif gate == "missing-app":
                app = session.get(_trial_audio_App, harness.target.id)
                assert app is not None
                session.delete(app)
            else:
                session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))
        response = harness.post(endpoint)

        _trial_audio_assert_error(
            response, 403, "trial_app_limit_exceeded" if gate == "quota" else "trial_app_not_allowed"
        )
        assert harness.runtime.calls == []
        assert harness.usage() == (3 if gate == "quota" else None)

    @staticmethod
    @pytest.mark.parametrize("endpoint", [_ASR, _TTS])
    def test_usage_is_isolated_to_current_account(harness: _TrialAudioHarness, endpoint: str) -> None:
        other_id = str(uuid4())
        with harness.factory.begin() as session:
            session.add_all(
                [
                    AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=1),
                    AccountTrialAppRecord(app_id=harness.target.id, account_id=other_id, count=99),
                ]
            )
        response = harness.post(endpoint)

        assert response.status_code == 200
        assert harness.usage() == 2
        with harness.factory() as session:
            assert (
                session.scalar(select(AccountTrialAppRecord.count).where(AccountTrialAppRecord.account_id == other_id))
                == 99
            )

    @staticmethod
    @pytest.mark.parametrize("failure", ["mime", "first-chunk"])
    def test_stream_preparation_failure_closes_provider_without_consuming_trial(
        harness: _TrialAudioHarness, failure: str
    ) -> None:
        def broken_chunks() -> Iterator[bytes]:
            raise InvokeBadRequestError("first audio chunk failed")
            yield b"unreachable"

        stream = _TrialAudioStream(chunks=iter([_WAV]) if failure == "mime" else broken_chunks())
        harness.runtime.output = AudioOutput(data=stream, mime_type="audio/mpeg")
        response = harness.post(_TTS)

        body = _trial_audio_assert_error(response, 400, "completion_request_error")
        assert ("MIME" if failure == "mime" else "first audio chunk failed") in str(body["message"])
        assert stream.close_calls == 1
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize("cleanup_fails", [False, True])
    def test_usage_write_failure_closes_stream_without_hiding_database_error(
        harness: _TrialAudioHarness, cleanup_fails: bool, caplog: pytest.LogCaptureFixture
    ) -> None:
        stream = _TrialAudioStream(close_error=RuntimeError("cleanup failed") if cleanup_fails else None)
        harness.runtime.output = AudioOutput(data=stream, mime_type="audio/mpeg")
        failure = RuntimeError("usage database unavailable")

        def reject_usage_insert(
            _mapper: Mapper[AccountTrialAppRecord], _connection: Connection, _record: AccountTrialAppRecord
        ) -> None:
            raise failure

        event.listen(AccountTrialAppRecord, "before_insert", reject_usage_insert)
        try:
            response = harness.post(_TTS)
        finally:
            event.remove(AccountTrialAppRecord, "before_insert", reject_usage_insert)

        _trial_audio_assert_error(response, 500, "internal_server_error")
        assert stream.reads == 1
        assert stream.close_calls == 1
        assert harness.usage() is None
        assert any(record.exc_info is not None and record.exc_info[1] is failure for record in caplog.records)

    @staticmethod
    def test_partial_http_consumption_closes_provider_stream(harness: _TrialAudioHarness) -> None:
        stream = _TrialAudioStream()
        harness.runtime.output = AudioOutput(data=stream, mime_type="audio/mpeg")
        response = harness.post(_TTS)

        assert response.status_code == 200
        assert response.headers["Content-Type"] == "audio/mpeg"
        assert "Content-Length" not in response.headers
        assert next(iter(response.response)) == b"a" * 32
        assert stream.reads == 1
        assert stream.close_calls == 0
        response.close()
        assert stream.close_calls == 1
        assert harness.usage() == 1


"""Trial uploads through HTTP, real file services, and SQLite admission/persistence."""


_TrialFileUploadEndpoint = Literal["files/upload", "remote-files/upload"]
_TRIAL_FILE_UPLOAD_CREATED_AT = datetime(2024, 1, 1)
_REMOTE_URL = "https://example.com/trial.txt"
_CONTENT = b"trial upload"


@dataclass
class _TrialFileUploadFeatures:
    enabled: bool = True
    events: list[str] = field(default_factory=list)

    def is_trial_enabled(self) -> bool:
        self.events.append("feature")
        return self.enabled


@dataclass
class _TrialFileUploadExternalio:
    admission_sessions: list[Session]
    saved: dict[str, bytes] = field(default_factory=dict)
    requests: list[tuple[str, str, Mapping[str, object]]] = field(default_factory=list)
    head_status: int = 200
    get_status: int = 200
    content_length: str = str(len(_CONTENT))
    error: Exception | None = None

    def assert_admission_closed(self) -> None:
        assert self.admission_sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.admission_sessions)

    def save(self, key: str, content: bytes) -> None:
        self.assert_admission_closed()
        self.saved[key] = content

    def request(self, method: str, *, url: str, **kwargs: object) -> httpx.Response:
        self.assert_admission_closed()
        self.requests.append((method, url, kwargs))
        if self.error is not None:
            raise self.error
        return httpx.Response(
            self.head_status if method == "HEAD" else self.get_status,
            headers={"Content-Type": "text/plain", "Content-Length": self.content_length},
            content=_CONTENT if method == "GET" else b"",
            request=httpx.Request(method, url),
        )


@dataclass(frozen=True)
class _TrialFileUploadTrialappservices:
    access: TrialAppAccessService


@dataclass(frozen=True)
class _TrialFileUploadApplicationservices:
    trial_apps: _TrialFileUploadTrialappservices
    recommended_app_queries: _TrialFileUploadFeatures
    files: FileService
    remote_files: RemoteFileService


@dataclass(frozen=True)
class _TrialFileUploadHarness:
    app: Flask
    account: Account
    target: _trial_file_upload_App
    trial: TrialApp
    factory: sessionmaker[Session]
    features: _TrialFileUploadFeatures
    io: _TrialFileUploadExternalio

    def url(self, endpoint: _TrialFileUploadEndpoint) -> str:
        return f"/trial-apps/{self.target.id}/{endpoint}"

    def post(self, endpoint: _TrialFileUploadEndpoint, *, query: str = "") -> TestResponse:
        if endpoint == "remote-files/upload":
            return self.app.test_client().post(self.url(endpoint) + query, json={"url": _REMOTE_URL})
        return self.app.test_client().post(
            self.url(endpoint) + query,
            data={"file": (BytesIO(_CONTENT), "trial.txt", "text/plain")},
        )

    def uploaded(self) -> list[_trial_file_upload_UploadFile]:
        with self.factory() as session:
            return list(session.scalars(select(_trial_file_upload_UploadFile)))

    def usage(self) -> int | None:
        with self.factory() as session:
            return session.scalar(
                select(AccountTrialAppRecord.count).where(
                    AccountTrialAppRecord.app_id == self.target.id,
                    AccountTrialAppRecord.account_id == self.account.id,
                )
            )


def _trial_file_upload_assert_error(response: TestResponse, status: int, code: str) -> None:
    assert response.status_code == status, response.get_json()
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == code
    assert body["status"] == status
    assert isinstance(body["message"], str)
    assert body["message"]
    assert response.headers["Content-Type"] == "application/json"


def _assert_signed_url(url: object, file_id: str) -> None:
    assert isinstance(url, str)
    parsed = urlsplit(url)
    assert parsed.path == f"/files/{file_id}/file-preview"
    assert parse_qs(parsed.query).keys() == {"timestamp", "nonce", "sign"}


class TestTrialFileUploadCases:
    @staticmethod
    @pytest.fixture
    def harness(
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        sqlite_session_factory: sessionmaker[Session],
    ) -> _TrialFileUploadHarness:
        config_overrides(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            INIT_PASSWORD="",
            LOGIN_DISABLED=False,
            RBAC_ENABLED=False,
            UPLOAD_FILE_SIZE_LIMIT=1,
            inner_UPLOAD_FILE_EXTENSION_BLACKLIST="exe",
        )
        features = _TrialFileUploadFeatures()
        account = Account(name="Trial viewer", email="trial@example.com")
        account._current_tenant = Tenant(name="Viewer workspace")
        account.role = TenantAccountRole.OWNER
        target = _trial_file_upload_App(
            tenant_id=str(uuid4()),
            name="Trial app",
            mode=_trial_file_upload_AppMode.CHAT,
            enable_site=True,
            enable_api=False,
        )
        target.id = str(uuid4())
        trial = TrialApp(app_id=target.id, tenant_id=str(uuid4()), trial_limit=3)
        with sqlite_session_factory.begin() as session:
            session.add_all([target, trial])

        sessions: list[Session] = []
        repository_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

        @event.listens_for(repository_factory, "after_begin")
        def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            sessions.append(session)

        io = _TrialFileUploadExternalio(sessions)
        files = FileService(session_factory=sqlite_session_factory)
        services = _TrialFileUploadApplicationservices(
            trial_apps=_TrialFileUploadTrialappservices(
                access=TrialAppAccessService(apps=TrialAppRepository(session_factory=repository_factory))
            ),
            recommended_app_queries=features,
            files=files,
            remote_files=RemoteFileService(files=files),
        )

        def setup_completed() -> bool:
            features.events.append("setup")
            return True

        def csrf(_request: Request, account_id: str) -> None:
            assert account_id == account.id
            features.events.append("csrf")

        for module in (trial_module, _trial_file_upload_admission_module, files_module, remote_module):
            monkeypatch.setattr(module, "application_services", lambda: services)
        monkeypatch.setattr(console_wraps, "_is_setup_completed", setup_completed)
        monkeypatch.setattr(login_module, "current_user", account)
        monkeypatch.setattr(login_module, "check_csrf_token", csrf)
        monkeypatch.setattr(file_module.storage, "save", io.save)
        monkeypatch.setattr(file_module, "naive_utc_now", lambda: _TRIAL_FILE_UPLOAD_CREATED_AT)
        monkeypatch.setattr(remote_fetcher, "make_request", io.request)

        app = Flask(__name__)
        app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
        login_manager = DifyLoginManager()
        login_manager.init_app(app)
        login_manager.unauthorized_handler(unauthorized_handler)
        api = ExternalApi(app)
        api.add_resource(trial_module.TrialAppFileUploadApi, "/trial-apps/<uuid:app_id>/files/upload")
        api.add_resource(trial_module.TrialAppRemoteFileUploadApi, "/trial-apps/<uuid:app_id>/remote-files/upload")
        return _TrialFileUploadHarness(app, account, target, trial, sqlite_session_factory, features, io)

    @staticmethod
    @pytest.mark.parametrize("content", [_CONTENT, b""])
    def test_local_upload_preserves_complete_response_and_owner_tenant(
        harness: _TrialFileUploadHarness, content: bytes
    ) -> None:
        response = harness.app.test_client().post(
            harness.url("files/upload"), data={"file": (BytesIO(content), "trial.txt", "text/plain")}
        )

        assert response.status_code == 201
        assert response.headers["Content-Type"] == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        body = response.get_json()
        uploaded = harness.uploaded()
        assert len(uploaded) == 1
        file = uploaded[0]
        assert body == {
            "id": file.id,
            "reference": None,
            "name": "trial.txt",
            "size": len(content),
            "extension": "txt",
            "mime_type": "text/plain",
            "created_by": harness.account.id,
            "created_at": int(_TRIAL_FILE_UPLOAD_CREATED_AT.timestamp()),
            "preview_url": None,
            "source_url": body["source_url"],
            "original_url": None,
            "user_id": None,
            "tenant_id": harness.target.tenant_id,
            "conversation_id": None,
            "file_key": None,
        }
        assert str(UUID(file.id)) == file.id
        _assert_signed_url(body["source_url"], file.id)
        assert file.created_by_role == CreatorUserRole.ACCOUNT
        assert file.created_by == harness.account.id
        assert file.tenant_id == harness.target.tenant_id
        assert file.tenant_id not in {harness.trial.tenant_id, harness.account.current_tenant_id}
        assert file.key.startswith(f"upload_files/{file.tenant_id}/")
        assert file.hash == hashlib.sha3_256(content).hexdigest()
        assert file.used is False
        assert harness.io.saved == {file.key: content}
        assert harness.features.events == ["setup", "csrf", "feature"]
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize("head_status", [200, 405])
    def test_remote_upload_fetches_once_and_preserves_response_and_actor(
        harness: _TrialFileUploadHarness, head_status: int
    ) -> None:
        harness.io.head_status = head_status
        response = harness.post("remote-files/upload")

        assert response.status_code == 201
        assert response.headers["Content-Type"] == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        body = response.get_json()
        uploaded = harness.uploaded()
        assert len(uploaded) == 1
        file = uploaded[0]
        assert body == {
            "id": file.id,
            "name": "trial.txt",
            "size": len(_CONTENT),
            "extension": "txt",
            "url": body["url"],
            "mime_type": "text/plain",
            "created_by": harness.account.id,
            "created_at": int(_TRIAL_FILE_UPLOAD_CREATED_AT.timestamp()),
        }
        _assert_signed_url(body["url"], file.id)
        assert file.source_url == _REMOTE_URL
        assert file.tenant_id == harness.target.tenant_id
        assert file.tenant_id not in {harness.trial.tenant_id, harness.account.current_tenant_id}
        assert file.created_by == harness.account.id
        assert file.created_by_role == CreatorUserRole.ACCOUNT
        assert harness.io.saved == {file.key: _CONTENT}
        assert harness.io.requests == [
            ("HEAD", _REMOTE_URL, {}),
            ("GET", _REMOTE_URL, {} if head_status == 200 else {"timeout": 3, "follow_redirects": True}),
        ]
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize("endpoint", ["files/upload", "remote-files/upload"])
    @pytest.mark.parametrize(
        ("denial", "code"),
        [
            ("feature", "trial_app_feature_disabled"),
            ("missing_trial", "trial_app_not_allowed"),
            ("missing_app", "trial_app_not_allowed"),
            ("quota", "trial_app_limit_exceeded"),
        ],
    )
    def test_trial_admission_rejects_before_parsing_or_external_io(
        harness: _TrialFileUploadHarness, endpoint: _TrialFileUploadEndpoint, denial: str, code: str
    ) -> None:
        if denial == "feature":
            harness.features.enabled = False
        else:
            with harness.factory.begin() as session:
                if denial == "missing_trial":
                    session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
                elif denial == "missing_app":
                    session.execute(
                        delete(_trial_file_upload_App).where(_trial_file_upload_App.id == harness.target.id)
                    )
                else:
                    session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))

        response = harness.app.test_client().post(harness.url(endpoint), json={})

        _trial_file_upload_assert_error(response, 403, code)
        assert harness.io.saved == {}
        assert harness.io.requests == []
        assert harness.uploaded() == []
        assert harness.usage() == (3 if denial == "quota" else None)
        if denial == "feature":
            assert harness.io.admission_sessions == []
        else:
            harness.io.assert_admission_closed()

    @staticmethod
    @pytest.mark.parametrize("endpoint", ["files/upload", "remote-files/upload"])
    def test_upload_does_not_charge_usage_or_inherit_another_accounts_exhausted_quota(
        harness: _TrialFileUploadHarness, endpoint: _TrialFileUploadEndpoint
    ) -> None:
        other_account_id = str(uuid4())
        with harness.factory.begin() as session:
            session.add_all(
                [
                    AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=1),
                    AccountTrialAppRecord(app_id=harness.target.id, account_id=other_account_id, count=3),
                ]
            )

        response = harness.post(endpoint)

        assert response.status_code == 201
        assert harness.usage() == 1
        with harness.factory() as session:
            assert (
                session.scalar(
                    select(AccountTrialAppRecord.count).where(AccountTrialAppRecord.account_id == other_account_id)
                )
                == 3
            )

    @staticmethod
    @pytest.mark.parametrize(
        ("shape", "code"),
        [("missing", "no_file_uploaded"), ("multiple", "too_many_files"), ("empty_name", "filename_not_exists_error")],
    )
    def test_multipart_shape_errors_precede_dataset_permissions(
        harness: _TrialFileUploadHarness, shape: str, code: str
    ) -> None:
        harness.account.role = TenantAccountRole.NORMAL
        data = {}
        if shape != "missing":
            data["file"] = (BytesIO(_CONTENT), "" if shape == "empty_name" else "trial.txt", "text/plain")
        if shape == "multiple":
            data["second_file"] = (BytesIO(_CONTENT), "second.txt", "text/plain")

        response = harness.app.test_client().post(harness.url("files/upload") + "?source=datasets", data=data)

        _trial_file_upload_assert_error(response, 400, code)
        assert harness.io.saved == {}
        assert harness.uploaded() == []

    @staticmethod
    @pytest.mark.parametrize(
        ("query_source", "form_source", "status"),
        [("datasets", "unknown", 403), ("unknown", "datasets", 201), ("", "datasets", 403)],
    )
    def test_query_source_takes_precedence_over_form_before_active_workspace_permission(
        harness: _TrialFileUploadHarness, query_source: str, form_source: str, status: int
    ) -> None:
        harness.account.role = TenantAccountRole.NORMAL
        response = harness.app.test_client().post(
            harness.url("files/upload") + f"?source={query_source}",
            data={"file": (BytesIO(_CONTENT), "trial.txt", "text/plain"), "source": form_source},
        )

        assert response.status_code == status
        if status == 403:
            _trial_file_upload_assert_error(response, status, "forbidden")
            assert harness.io.saved == {}
        else:
            assert len(harness.uploaded()) == 1

    @staticmethod
    @pytest.mark.parametrize(
        ("role", "rbac", "status"),
        [
            (TenantAccountRole.OWNER, False, 201),
            (TenantAccountRole.DATASET_OPERATOR, False, 201),
            (TenantAccountRole.NORMAL, False, 403),
            (TenantAccountRole.NORMAL, True, 201),
        ],
    )
    def test_dataset_upload_uses_active_workspace_role_and_retains_rbac_bypass(
        harness: _TrialFileUploadHarness,
        config_overrides: Callable[..., None],
        role: TenantAccountRole,
        rbac: bool,
        status: int,
    ) -> None:
        harness.account.role = role
        config_overrides(RBAC_ENABLED=rbac)

        response = harness.post("files/upload", query="?source=datasets")

        assert response.status_code == status
        assert len(harness.uploaded()) == (1 if status == 201 else 0)

    @staticmethod
    @pytest.mark.parametrize("endpoint", ["files/upload", "remote-files/upload"])
    def test_cloud_document_quota_uses_active_workspace_before_upload(
        harness: _TrialFileUploadHarness,
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        endpoint: _TrialFileUploadEndpoint,
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        checked_tenants: list[str] = []

        def get_features(tenant_id: str, exclude_vector_space: bool = False) -> FeatureModel:
            checked_tenants.append(tenant_id)
            assert exclude_vector_space is True
            features = FeatureModel()
            features.documents_upload_quota.limit = 1
            features.documents_upload_quota.size = 1
            return features

        monkeypatch.setattr(FeatureService, "get_features", get_features)

        response = harness.post(endpoint, query="?source=datasets")

        _trial_file_upload_assert_error(response, 403, "forbidden")
        assert checked_tenants == [harness.account.current_tenant_id]
        assert harness.io.saved == {}
        assert harness.io.requests == []
        assert harness.usage() is None

    @staticmethod
    def test_dataset_file_size_limit_comes_from_app_owner_tenant(
        harness: _TrialFileUploadHarness, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        quota_tenants: list[str] = []
        size_limit_tenants: list[str | None] = []

        def get_features(tenant_id: str, exclude_vector_space: bool = False) -> FeatureModel:
            quota_tenants.append(tenant_id)
            assert exclude_vector_space is True
            return FeatureModel()

        def get_size_limit(tenant_id: str | None) -> int:
            size_limit_tenants.append(tenant_id)
            return 0

        monkeypatch.setattr(FeatureService, "get_features", get_features)
        monkeypatch.setattr(FeatureService, "get_knowledge_file_size_limit", get_size_limit)

        response = harness.post("files/upload", query="?source=datasets")

        _trial_file_upload_assert_error(response, 413, "file_too_large")
        assert response.get_json()["message"] == "File size exceeded."
        assert quota_tenants == [harness.account.current_tenant_id]
        assert size_limit_tenants == [harness.target.tenant_id]
        assert harness.io.saved == {}
        assert harness.uploaded() == []

    @staticmethod
    @pytest.mark.parametrize(
        ("filename", "query", "status", "code"),
        [
            ("trial.exe", "", 400, "file_extension_blocked"),
            ("trial.png", "?source=datasets", 415, "unsupported_file_type"),
        ],
    )
    def test_local_file_policy_errors_keep_specific_codes(
        harness: _TrialFileUploadHarness, filename: str, query: str, status: int, code: str
    ) -> None:
        response = harness.app.test_client().post(
            harness.url("files/upload") + query,
            data={"file": (BytesIO(_CONTENT), filename, "application/octet-stream")},
        )

        _trial_file_upload_assert_error(response, status, code)
        assert harness.io.saved == {}
        assert harness.uploaded() == []

    @staticmethod
    @pytest.mark.parametrize(
        ("get_status", "status", "code"),
        [
            (404, 404, "remote_file_not_found"),
            (403, 400, "remote_file_access_denied"),
            (503, 502, "remote_file_unavailable"),
        ],
    )
    def test_remote_http_failures_keep_precise_error_codes(
        harness: _TrialFileUploadHarness, get_status: int, status: int, code: str
    ) -> None:
        harness.io.head_status = 405
        harness.io.get_status = get_status

        response = harness.post("remote-files/upload")

        _trial_file_upload_assert_error(response, status, code)
        assert [method for method, _url, _kwargs in harness.io.requests] == ["HEAD", "GET"]
        assert harness.io.saved == {}
        assert harness.uploaded() == []
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize(
        ("failure", "status", "code"),
        [
            ("blocked", 400, "remote_file_url_blocked"),
            ("timeout", 502, "remote_file_unavailable"),
            ("metadata", 502, "remote_file_invalid_response"),
            ("size", 413, "file_too_large"),
        ],
    )
    def test_remote_transport_metadata_and_size_failures_prevent_storage(
        harness: _TrialFileUploadHarness, failure: str, status: int, code: str
    ) -> None:
        if failure == "blocked":
            harness.io.error = ToolSSRFError("Blocked by SSRF proxy")
        elif failure == "timeout":
            harness.io.error = httpx.ReadTimeout("Timed out")
        elif failure == "metadata":
            harness.io.content_length = "invalid"
        else:
            harness.io.content_length = str(1024 * 1024 + 1)

        response = harness.post("remote-files/upload")

        _trial_file_upload_assert_error(response, status, code)
        assert len(harness.io.requests) == 1
        assert harness.io.saved == {}
        assert harness.uploaded() == []
        assert harness.usage() is None

    @staticmethod
    def test_remote_invalid_url_fails_before_network(harness: _TrialFileUploadHarness) -> None:
        response = harness.app.test_client().post(
            harness.url("remote-files/upload"), json={"url": "file:///etc/passwd"}
        )

        _trial_file_upload_assert_error(response, 400, "remote_file_invalid_url")
        assert harness.io.requests == []
        assert harness.io.saved == {}

    @staticmethod
    def test_remote_payload_validation_stays_on_http_boundary(harness: _TrialFileUploadHarness) -> None:
        response = harness.app.test_client().post(harness.url("remote-files/upload"), json={})

        assert response.status_code == 422
        assert "url" in response.get_json()["message"]
        assert harness.io.requests == []
        assert harness.io.saved == {}


"""Trial admission and generation through real HTTP handlers and SQLite repositories."""


@dataclass
class _TrialGenerationFeaturestate:
    enabled: bool = True
    setup_completed: bool = True
    events: list[str] = field(default_factory=list)

    def is_trial_enabled(self) -> bool:
        self.events.append("feature")
        return self.enabled


@dataclass(frozen=True)
class _GenerationCall:
    app: TrialAppRef
    account_id: str
    args: Mapping[str, object]
    streaming: bool


@dataclass
class _TrialGenerationStream(Iterator[str]):
    chunks: Iterator[str] = field(default_factory=lambda: iter(['data: {"answer":"first"}\n\n', "data: [DONE]\n\n"]))
    reads: int = 0
    close_calls: int = 0
    close_error: Exception | None = None
    on_read: Callable[[], None] | None = None

    @override
    def __next__(self) -> str:
        if self.on_read is not None:
            self.on_read()
        chunk = next(self.chunks)
        self.reads += 1
        return chunk

    def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


@dataclass
class _TrialGenerationRuntime:
    sessions: list[Session]
    response: GenerationResponse = field(
        default_factory=lambda: {"answer": "", "metadata": dict[str, object](), "created_at": 0}
    )
    error: Exception | None = None
    calls: list[_GenerationCall] = field(default_factory=list)
    before_generate: Callable[[], None] | None = None

    def generate(
        self, *, app: TrialAppRef, account_id: str, args: Mapping[str, object], streaming: bool
    ) -> GenerationResponse:
        # Database admission must release its connection before model invocation.
        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        self.calls.append(_GenerationCall(app, account_id, dict(args), streaming))
        if self.before_generate is not None:
            self.before_generate()
        if self.error is not None:
            raise self.error
        return self.response


@dataclass
class _Tasks:
    calls: list[str] = field(default_factory=list)
    chat_calls: list[tuple[str, str]] = field(default_factory=list)

    def stop_task(self, *, task_id: str, invoke_from: InvokeFrom, user_id: str) -> None:
        assert invoke_from == InvokeFrom.EXPLORE
        self.chat_calls.append((task_id, user_id))

    def stop_workflow_task(
        self,
        *,
        task_id: str,
        tenant_id: str,
        app_id: str,
        app_mode: _trial_generation_AppMode,
        owner: tuple[CreatorUserRole, str] | None,
    ) -> None:
        assert tenant_id
        assert app_id
        if app_mode == _trial_generation_AppMode.ADVANCED_CHAT:
            assert owner is not None
            assert owner[0] == CreatorUserRole.ACCOUNT
            self.chat_calls.append((task_id, owner[1]))
        else:
            assert owner is None
            assert app_mode == _trial_generation_AppMode.WORKFLOW
            self.calls.append(task_id)


@dataclass(frozen=True)
class _TrialGenerationTrialappservices:
    access: TrialAppAccessService
    generation: TrialAppGenerationService


@dataclass(frozen=True)
class _TrialGenerationApplicationservices:
    trial_apps: _TrialGenerationTrialappservices
    recommended_app_queries: _TrialGenerationFeaturestate
    app_tasks: _Tasks


@dataclass(frozen=True)
class _TrialGenerationHarness:
    app: Flask
    account: Account
    target: _trial_generation_App
    trial: TrialApp
    factory: sessionmaker[Session]
    services: _TrialGenerationApplicationservices
    runtime: _TrialGenerationRuntime
    state: _TrialGenerationFeaturestate

    def url(self, endpoint: str, *, app_id: str | None = None) -> str:
        return f"/trial-apps/{app_id or self.target.id}/{endpoint}"

    def post(self, endpoint: str, *, payload: Mapping[str, object] | None = None) -> TestResponse:
        return self.app.test_client().post(self.url(endpoint), json=dict(payload or {"inputs": {}}))

    def set_mode(self, mode: _trial_generation_AppMode) -> None:
        with self.factory.begin() as session:
            app = session.get(_trial_generation_App, self.target.id)
            assert app is not None
            app.mode = mode

    def usage(self) -> int | None:
        with self.factory() as session:
            return session.scalar(
                select(AccountTrialAppRecord.count).where(
                    AccountTrialAppRecord.app_id == self.target.id,
                    AccountTrialAppRecord.account_id == self.account.id,
                )
            )


def _trial_generation_assert_error(response: TestResponse, status: int, code: str) -> Mapping[str, object]:
    assert response.status_code == status
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == code
    assert body["status"] == status
    assert response.headers["Content-Type"] == "application/json"
    assert isinstance(body["message"], str)
    assert body["message"]
    return body


class TestTrialGenerationCases:
    @staticmethod
    @pytest.fixture
    def harness(
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        sqlite_session_factory: sessionmaker[Session],
    ) -> _TrialGenerationHarness:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, INIT_PASSWORD="", LOGIN_DISABLED=False)
        state = _TrialGenerationFeaturestate()
        account = Account(name="Viewer", email="viewer@example.com")
        account._current_tenant = Tenant(name="Viewer workspace")
        target = _trial_generation_App(
            tenant_id=str(uuid4()),
            name="Trial app",
            mode=_trial_generation_AppMode.COMPLETION,
            enable_site=True,
            enable_api=True,
        )
        target.id = str(uuid4())
        trial = TrialApp(app_id=target.id, tenant_id=target.tenant_id, trial_limit=3)
        with sqlite_session_factory.begin() as session:
            session.add_all([target, trial])

        sessions: list[Session] = []
        repository_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

        @event.listens_for(repository_factory, "after_begin")
        def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            sessions.append(session)

        runtime = _TrialGenerationRuntime(sessions=sessions)
        repository = TrialAppRepository(session_factory=repository_factory)
        services = _TrialGenerationApplicationservices(
            trial_apps=_TrialGenerationTrialappservices(
                access=TrialAppAccessService(apps=repository),
                generation=TrialAppGenerationService(runtime=runtime, usage=repository),
            ),
            recommended_app_queries=state,
            app_tasks=_Tasks(),
        )

        def setup_completed() -> bool:
            state.events.append("setup")
            return state.setup_completed

        def csrf(_request: Request, account_id: str) -> None:
            assert account_id == account.id
            state.events.append("csrf")

        for module in (trial_module, _trial_generation_admission_module):
            monkeypatch.setattr(module, "application_services", lambda: services)
        monkeypatch.setattr(console_wraps, "_is_setup_completed", setup_completed)
        monkeypatch.setattr(login_module, "current_user", account)
        monkeypatch.setattr(login_module, "check_csrf_token", csrf)

        app = Flask(__name__)
        app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
        login_manager = DifyLoginManager()
        login_manager.init_app(app)
        login_manager.unauthorized_handler(unauthorized_handler)
        api = ExternalApi(app)
        for resource, endpoint in (
            (trial_module.TrialAppWorkflowRunApi, "workflows/run"),
            (trial_module.TrialChatApi, "chat-messages"),
            (trial_module.TrialChatTaskStopApi, "chat-messages/<string:task_id>/stop"),
            (trial_module.TrialCompletionApi, "completion-messages"),
            (trial_module.TrialAppWorkflowTaskStopApi, "workflows/tasks/<string:task_id>/stop"),
        ):
            api.add_resource(resource, f"/trial-apps/<uuid:app_id>/{endpoint}")
        return _TrialGenerationHarness(app, account, target, trial, sqlite_session_factory, services, runtime, state)

    @staticmethod
    @pytest.mark.parametrize("response_mode", [None, "blocking"])
    def test_completion_blocking_preserves_response_and_uses_app_owner(
        harness: _TrialGenerationHarness, response_mode: str | None
    ) -> None:
        response = harness.post("completion-messages", payload={"inputs": {}, "response_mode": response_mode})

        assert response.status_code == 200
        assert response.get_json() == {"answer": "", "metadata": {}, "created_at": 0}
        assert response.headers["Content-Type"] == "application/json; charset=utf-8"
        assert int(response.headers["Content-Length"]) == len(response.data)
        assert harness.usage() == 1
        assert harness.state.events == ["setup", "csrf", "feature"]
        call = harness.runtime.calls[0]
        assert call.app == TrialAppRef(
            app_id=harness.target.id, tenant_id=harness.target.tenant_id, app_mode=_trial_generation_AppMode.COMPLETION
        )
        assert call.app.tenant_id != harness.account.current_tenant_id
        assert call.account_id == harness.account.id
        assert call.streaming is False
        assert call.args == {
            "inputs": {},
            "query": "",
            "files": None,
            "response_mode": response_mode,
            "retriever_from": "explore_app",
            "auto_generate_name": False,
        }

    @staticmethod
    @pytest.mark.parametrize(
        ("endpoint", "mode", "payload"),
        [
            ("workflows/run", _trial_generation_AppMode.WORKFLOW, {"inputs": {"number": 0}, "files": []}),
            ("chat-messages", _trial_generation_AppMode.CHAT, {"inputs": {}, "query": "hello"}),
            ("chat-messages", _trial_generation_AppMode.AGENT, {"inputs": {}, "query": "hello"}),
            ("chat-messages", _trial_generation_AppMode.ADVANCED_CHAT, {"inputs": {}, "query": "hello"}),
            ("chat-messages", _trial_generation_AppMode.AGENT_CHAT, {"inputs": {}, "query": "hello"}),
            ("completion-messages", _trial_generation_AppMode.COMPLETION, {"inputs": {}, "response_mode": "streaming"}),
        ],
    )
    def test_stream_records_usage_after_runtime_returns_before_consumption(
        harness: _TrialGenerationHarness, endpoint: str, mode: _trial_generation_AppMode, payload: Mapping[str, object]
    ) -> None:
        harness.set_mode(mode)

        def before_generate() -> None:
            assert harness.usage() is None

        def before_read() -> None:
            assert harness.usage() == 1

        stream = _TrialGenerationStream(on_read=before_read)
        harness.runtime.response = stream
        harness.runtime.before_generate = before_generate
        response = harness.post(endpoint, payload=payload)

        assert response.status_code == 200
        assert response.headers["Content-Type"] == "text/event-stream; charset=utf-8"
        assert "Content-Length" not in response.headers
        assert response.data == b'data: {"answer":"first"}\n\ndata: [DONE]\n\n'
        response.close()
        assert harness.usage() == 1
        assert harness.runtime.calls[0].streaming is True
        if endpoint == "chat-messages":
            assert harness.runtime.calls[0].args["auto_generate_name"] is False
        elif endpoint == "workflows/run":
            assert harness.runtime.calls[0].args == payload

    @staticmethod
    @pytest.mark.parametrize(
        "endpoint",
        [
            "completion-messages",
            "chat-messages",
            "chat-messages/task/stop",
            "workflows/run",
            "workflows/tasks/task/stop",
        ],
    )
    @pytest.mark.parametrize(
        ("state", "status", "code"), [("setup", 401, "not_setup"), ("feature", 403, "trial_app_feature_disabled")]
    )
    def test_bootstrap_and_feature_admission_apply_before_trial_lookup(
        harness: _TrialGenerationHarness, endpoint: str, state: str, status: int, code: str
    ) -> None:
        if state == "setup":
            harness.state.setup_completed = False
        else:
            harness.state.enabled = False
        response = harness.app.test_client().post(harness.url(endpoint, app_id=str(uuid4())), json={})

        _trial_generation_assert_error(response, status, code)
        assert harness.state.events == (["setup"] if state == "setup" else ["setup", "csrf", "feature"])
        assert harness.runtime.calls == []
        assert harness.services.app_tasks.calls == []

    @staticmethod
    @pytest.mark.parametrize(
        ("case", "code"),
        [
            ("missing_trial", "trial_app_not_allowed"),
            ("missing_app", "trial_app_not_allowed"),
            ("limit", "trial_app_limit_exceeded"),
        ],
    )
    def test_trial_lookup_and_account_limit_block_generation(
        harness: _TrialGenerationHarness, case: str, code: str
    ) -> None:
        with harness.factory.begin() as session:
            if case == "missing_trial":
                trial = session.get(TrialApp, harness.trial.id)
                assert trial is not None
                session.delete(trial)
            elif case == "missing_app":
                target = session.get(_trial_generation_App, harness.target.id)
                assert target is not None
                session.delete(target)
            else:
                session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))
        response = harness.post("completion-messages")

        _trial_generation_assert_error(response, 403, code)
        assert harness.runtime.calls == []

    @staticmethod
    @pytest.mark.parametrize("count", [0, 2])
    def test_usage_increments_existing_record_and_ignores_other_account(
        harness: _TrialGenerationHarness, count: int
    ) -> None:
        other_id = str(uuid4())
        with harness.factory.begin() as session:
            session.add_all(
                [
                    AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=count),
                    AccountTrialAppRecord(app_id=harness.target.id, account_id=other_id, count=99),
                ]
            )
        response = harness.post("completion-messages")

        assert response.status_code == 200
        assert harness.usage() == count + 1
        with harness.factory() as session:
            assert (
                session.scalar(select(AccountTrialAppRecord.count).where(AccountTrialAppRecord.account_id == other_id))
                == 99
            )

    @staticmethod
    @pytest.mark.parametrize(
        ("endpoint", "mode", "code"),
        [
            ("completion-messages", _trial_generation_AppMode.CHAT, "not_completion_app"),
            ("chat-messages", _trial_generation_AppMode.COMPLETION, "not_chat_app"),
            ("workflows/run", _trial_generation_AppMode.CHAT, "not_workflow_app"),
            ("workflows/tasks/task/stop", _trial_generation_AppMode.CHAT, "not_workflow_app"),
        ],
    )
    def test_wrong_mode_returns_specific_error_without_invocation(
        harness: _TrialGenerationHarness, endpoint: str, mode: _trial_generation_AppMode, code: str
    ) -> None:
        harness.set_mode(mode)
        response = harness.post(endpoint, payload={"inputs": {}, "query": "hello"})

        _trial_generation_assert_error(response, 400, code)
        assert harness.runtime.calls == []
        assert harness.services.app_tasks.calls == []
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize("field", ["conversation_id", "parent_message_id"])
    def test_chat_rejects_invalid_uuid_before_runtime(harness: _TrialGenerationHarness, field: str) -> None:
        harness.set_mode(_trial_generation_AppMode.CHAT)
        response = harness.post("chat-messages", payload={"inputs": {}, "query": "hello", field: "not-a-uuid"})

        _trial_generation_assert_error(response, 400, "invalid_param")
        assert harness.runtime.calls == []
        assert harness.usage() is None

    @staticmethod
    def test_unpublished_agent_remains_unavailable_after_service_migration(harness: _TrialGenerationHarness) -> None:
        harness.set_mode(_trial_generation_AppMode.AGENT)
        harness.runtime.error = AgentAppNotPublishedError("Agent has not been published")
        response = harness.post("chat-messages", payload={"inputs": {}, "query": "hello"})
        _trial_generation_assert_error(response, 400, "app_unavailable")
        assert harness.usage() is None

    @staticmethod
    def test_stop_chat_rejects_workflow(harness: _TrialGenerationHarness) -> None:
        harness.set_mode(_trial_generation_AppMode.WORKFLOW)
        _trial_generation_assert_error(harness.post("chat-messages/task-1/stop"), 400, "not_chat_app")
        assert harness.services.app_tasks.chat_calls == []

    @staticmethod
    @pytest.mark.parametrize(
        "mode",
        [
            _trial_generation_AppMode.CHAT,
            _trial_generation_AppMode.AGENT_CHAT,
            _trial_generation_AppMode.AGENT,
            _trial_generation_AppMode.ADVANCED_CHAT,
        ],
    )
    def test_last_trial_can_be_stopped_without_allowing_another_generation(
        harness: _TrialGenerationHarness, mode: _trial_generation_AppMode
    ) -> None:
        harness.set_mode(mode)
        with harness.factory.begin() as session:
            session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=2))

        response = harness.post("chat-messages", payload={"inputs": {}, "query": "hello"})
        assert response.status_code == 200
        assert harness.usage() == 3

        stopped = harness.post("chat-messages/task-last/stop")
        assert stopped.status_code == 200
        assert harness.services.app_tasks.chat_calls == [("task-last", harness.account.id)]
        assert harness.usage() == 3
        unavailable = harness.app.test_client().post(harness.url("chat-messages/task-last/stop", app_id=str(uuid4())))
        _trial_generation_assert_error(unavailable, 403, "trial_app_not_allowed")
        assert len(harness.services.app_tasks.chat_calls) == 1
        _trial_generation_assert_error(
            harness.post("chat-messages", payload={"inputs": {}, "query": "again"}),
            403,
            "trial_app_limit_exceeded",
        )

    @staticmethod
    def test_chat_normalizes_uuid_and_preserves_empty_ids(harness: _TrialGenerationHarness) -> None:
        harness.set_mode(_trial_generation_AppMode.CHAT)
        conversation_id = uuid4()
        response = harness.post(
            "chat-messages",
            payload={
                "inputs": {},
                "query": "hello",
                "conversation_id": conversation_id.hex.upper(),
                "parent_message_id": "",
            },
        )

        assert response.status_code == 200
        assert harness.runtime.calls[0].args["conversation_id"] == str(conversation_id)
        assert harness.runtime.calls[0].args["parent_message_id"] == ""

    @staticmethod
    @pytest.mark.parametrize(
        ("error", "status", "code"),
        [
            (ProviderTokenNotInitError("missing key for provider"), 400, "provider_not_initialize"),
            (QuotaExceededError(), 400, "provider_quota_exceeded"),
            (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support"),
            (InvokeError("provider rejected request"), 400, "completion_request_error"),
            (InvokeRateLimitError("too many requests"), 429, "rate_limit_error"),
            (AppInvokeQuotaExceededError("active requests exceeded"), 429, "rate_limit_error"),
            (AppDefinitionUnavailableError("app removed"), 400, "app_unavailable"),
            (AccountNotFoundError("account removed"), 401, "unauthorized"),
            (AppModelConfigBrokenError(), 400, "app_unavailable"),
        ],
    )
    @pytest.mark.parametrize(
        ("endpoint", "mode"),
        [
            ("completion-messages", _trial_generation_AppMode.COMPLETION),
            ("chat-messages", _trial_generation_AppMode.CHAT),
            ("workflows/run", _trial_generation_AppMode.WORKFLOW),
        ],
    )
    def test_runtime_errors_keep_specific_codes_and_do_not_record_usage(
        harness: _TrialGenerationHarness,
        endpoint: str,
        mode: _trial_generation_AppMode,
        error: Exception,
        status: int,
        code: str,
    ) -> None:
        harness.set_mode(mode)
        harness.runtime.error = error
        response = harness.post(endpoint, payload={"inputs": {}, "query": "hello"})

        body = _trial_generation_assert_error(response, status, code)
        if isinstance(error, (ProviderTokenNotInitError, InvokeError, InvokeRateLimitError)):
            assert body["message"] == error.description
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize(
        ("error", "status", "code"),
        [
            (ConversationNotExistsError(), 404, "not_found"),
            # Nothing raises ConversationCompletedError today, so the contract does not list its code.
            pytest.param(
                ConversationCompletedError(),
                400,
                "conversation_completed",
                marks=pytest.mark.allow_error_contract_violations,
            ),
            (AppModelConfigBrokenError(), 400, "app_unavailable"),
        ],
    )
    @pytest.mark.parametrize(
        ("endpoint", "mode"),
        [
            ("completion-messages", _trial_generation_AppMode.COMPLETION),
            ("chat-messages", _trial_generation_AppMode.CHAT),
        ],
    )
    def test_conversation_and_config_errors_remain_actionable(
        harness: _TrialGenerationHarness,
        endpoint: str,
        mode: _trial_generation_AppMode,
        error: Exception,
        status: int,
        code: str,
    ) -> None:
        harness.set_mode(mode)
        harness.runtime.error = error
        response = harness.post(endpoint, payload={"inputs": {}, "query": "hello"})

        _trial_generation_assert_error(response, status, code)
        assert harness.usage() is None

    @staticmethod
    def test_stop_retains_trial_quota_admission_without_recording_usage(harness: _TrialGenerationHarness) -> None:
        harness.set_mode(_trial_generation_AppMode.WORKFLOW)
        response = harness.post("workflows/tasks/task-123/stop")

        assert response.status_code == 200
        assert response.get_json() == {"result": "success"}
        assert harness.services.app_tasks.calls == ["task-123"]
        assert harness.usage() is None
        with harness.factory.begin() as session:
            session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))
        blocked = harness.post("workflows/tasks/task-456/stop")
        _trial_generation_assert_error(blocked, 403, "trial_app_limit_exceeded")
        assert harness.services.app_tasks.calls == ["task-123"]

    @staticmethod
    def test_unauthenticated_account_cannot_enter_trial(
        harness: _TrialGenerationHarness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(login_module, "current_user", None)
        response = harness.post("completion-messages")

        assert response.status_code == 401
        assert harness.state.events == ["setup"]
        assert harness.runtime.calls == []

    @staticmethod
    def test_uninitialized_account_cannot_enter_trial(harness: _TrialGenerationHarness) -> None:
        harness.account.status = AccountStatus.UNINITIALIZED
        response = harness.post("completion-messages")

        _trial_generation_assert_error(response, 400, "account_not_initialized")
        assert harness.state.events == ["setup", "csrf"]
        assert harness.runtime.calls == []

    @staticmethod
    def test_failed_csrf_cannot_enter_trial(harness: _TrialGenerationHarness, monkeypatch: pytest.MonkeyPatch) -> None:
        def reject_csrf(_request: Request, _account_id: str) -> None:
            raise Unauthorized("invalid csrf token")

        monkeypatch.setattr(login_module, "check_csrf_token", reject_csrf)
        response = harness.post("completion-messages")

        _trial_generation_assert_error(response, 401, "unauthorized")
        assert harness.runtime.calls == []

    @staticmethod
    def test_payload_validation_keeps_field_context(harness: _TrialGenerationHarness) -> None:
        response = harness.post("completion-messages", payload={"inputs": [], "response_mode": "invalid"})

        body = _trial_generation_assert_error(response, 422, "unprocessable_entity")
        assert "inputs" in str(body)
        assert harness.runtime.calls == []
        assert harness.usage() is None

    @staticmethod
    @pytest.mark.parametrize("cleanup_fails", [False, True])
    @pytest.mark.parametrize(
        ("endpoint", "mode"),
        [
            ("completion-messages", _trial_generation_AppMode.COMPLETION),
            ("chat-messages", _trial_generation_AppMode.CHAT),
            ("workflows/run", _trial_generation_AppMode.WORKFLOW),
        ],
    )
    def test_usage_write_failure_closes_unconsumed_stream_without_hiding_database_error(
        harness: _TrialGenerationHarness,
        endpoint: str,
        mode: _trial_generation_AppMode,
        cleanup_fails: bool,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        harness.set_mode(mode)
        stream = _TrialGenerationStream(close_error=RuntimeError("cleanup failed") if cleanup_fails else None)
        harness.runtime.response = stream
        failure = RuntimeError("usage database unavailable")

        def reject_usage_insert(
            _mapper: Mapper[AccountTrialAppRecord], _connection: Connection, _record: AccountTrialAppRecord
        ) -> None:
            raise failure

        # Fail the persistence boundary, retaining the real service, unit of work,
        # SQLAlchemy rollback and HTTP error handler.
        event.listen(AccountTrialAppRecord, "before_insert", reject_usage_insert)
        try:
            response = harness.post(endpoint, payload={"inputs": {}, "query": "hello", "response_mode": "streaming"})
        finally:
            event.remove(AccountTrialAppRecord, "before_insert", reject_usage_insert)

        _trial_generation_assert_error(response, 500, "internal_server_error")
        assert stream.close_calls == 1
        assert stream.reads == 0
        assert harness.usage() is None
        assert any(record.exc_info is not None and record.exc_info[1] is failure for record in caplog.records)

    @staticmethod
    def test_later_stream_failure_does_not_refund_trial_usage(harness: _TrialGenerationHarness) -> None:
        def chunks() -> Iterator[str]:
            yield 'data: {"answer":"partial"}\n\n'
            raise RuntimeError("provider disconnected")

        harness.runtime.response = _TrialGenerationStream(chunks=chunks())
        response = harness.post("completion-messages", payload={"inputs": {}, "response_mode": "streaming"})

        chunks = iter(response.response)
        assert next(chunks) == b'data: {"answer":"partial"}\n\n'
        with pytest.raises(RuntimeError, match="provider disconnected"):
            next(chunks)
        response.close()
        assert harness.usage() == 1


"""Anonymous app previews through HTTP and real SQLite query boundaries."""


_TrialPreviewEndpoint = Literal["parameters", "site", "datasets"]
_TRIAL_PREVIEW_CREATED_AT = datetime(2024, 1, 1)
_INPUT_FORM = [{"number": {"label": "Count", "variable": "count", "required": False, "default": 0}}]


@dataclass
class _TrialPreviewCatalog:
    engine: Engine
    ids: set[str] = field(default_factory=set)
    calls: list[str] = field(default_factory=list)

    def contains(self, app_id: str) -> bool:
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        self.calls.append(app_id)
        return app_id in self.ids

    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        raise AssertionError(f"Unexpected list request for {language}")

    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        raise AssertionError(f"Unexpected list request for {language}")

    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        raise AssertionError(f"Unexpected detail request for {app_id}")


@dataclass(frozen=True)
class _TrialPreviewApplicationservices:
    app_previews: AppPreviewQueryService
    app_definitions: AppDefinitionQueryService
    recommended_app_queries: RecommendedAppQueryService


@dataclass(frozen=True)
class _TrialPreviewHarness:
    app: Flask
    owner: Tenant
    target: _trial_preview_App
    listing: TrialApp
    site: Site
    config: AppModelConfig
    dataset: Dataset
    creator_id: str
    factory: sessionmaker[Session]
    engine: Engine
    catalog: _TrialPreviewCatalog
    sessions: list[Session]
    signed_icons: list[str]

    def get(self, endpoint: _TrialPreviewEndpoint, *, query: str = "", app_id: str | None = None) -> TestResponse:
        response = self.app.test_client().get(f"/trial-apps/{app_id or self.target.id}/{endpoint}{query}")
        assert response.headers["Content-Type"] == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        return response

    def dataset_query(self) -> str:
        return f"?ids={self.dataset.id}"


def _trial_preview_assert_error(response: TestResponse, status: int, code: str) -> None:
    assert response.status_code == status, response.get_json()
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert isinstance(body["message"], str)
    assert body["message"]


class TestTrialPreviewCases:
    @staticmethod
    @pytest.fixture
    def harness(
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        sqlite_engine: Engine,
        sqlite_session_factory: sessionmaker[Session],
    ) -> _TrialPreviewHarness:
        config_overrides(
            LOGIN_DISABLED=False,
            INIT_PASSWORD="preview-does-not-require-setup",
            UPLOAD_IMAGE_FILE_SIZE_LIMIT=1,
            UPLOAD_VIDEO_FILE_SIZE_LIMIT=2,
            UPLOAD_AUDIO_FILE_SIZE_LIMIT=3,
            UPLOAD_FILE_SIZE_LIMIT=4,
            WORKFLOW_FILE_UPLOAD_LIMIT=5,
        )
        owner = Tenant(name="App owner")
        creator_id = str(uuid4())
        target = _trial_preview_App(
            id=str(uuid4()),
            tenant_id=owner.id,
            name="Preview",
            mode=_trial_preview_AppMode.CHAT,
            enable_site=False,
            enable_api=False,
        )
        listing = TrialApp(app_id=target.id, tenant_id=str(uuid4()), trial_limit=0)
        config = AppModelConfig(
            app_id=target.id,
            opening_statement="",
            suggested_questions="[]",
            suggested_questions_after_answer='{"enabled":false}',
            speech_to_text='{"enabled":false}',
            text_to_speech='{"enabled":false,"voice":"","autoPlay":"disabled"}',
            retriever_resource='{"enabled":false}',
            more_like_this='{"enabled":false}',
            sensitive_word_avoidance='{"enabled":false,"type":"","configs":[]}',
            file_upload='{"enabled":false,"number_limits":0}',
            user_input_form=json.dumps(_INPUT_FORM),
        )
        site = Site(
            app_id=target.id,
            title="Preview site",
            default_language="en-US",
            customize_token_strategy=CustomizeTokenStrategy.UUID,
            icon_type=IconType.IMAGE,
            icon=str(uuid4()),
            icon_background="",
            chat_color_theme="",
            chat_color_theme_inverted=False,
            description=None,
            copyright="",
            privacy_policy=None,
            input_placeholder="",
            custom_disclaimer="",
            show_workflow_steps=False,
            use_icon_as_answer_icon=False,
            prompt_public=False,
        )
        dataset = Dataset(
            tenant_id=owner.id,
            name="Owner dataset",
            description=None,
            permission="only_me",
            data_source_type="upload_file",
            indexing_technique=None,
            created_by=creator_id,
        )
        dataset.created_at = _TRIAL_PREVIEW_CREATED_AT
        with sqlite_session_factory.begin() as session:
            session.add_all([owner, target, listing, config, site, dataset])
            session.flush()
            target.app_model_config_id = config.id
            session.add(AccountTrialAppRecord(app_id=target.id, account_id=creator_id, count=100))

        factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
        sessions: list[Session] = []

        @event.listens_for(factory, "after_begin")
        def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            assert all(not previous.in_transaction() for previous in sessions)
            assert isinstance(sqlite_engine.pool, QueuePool)
            assert sqlite_engine.pool.checkedout() == 1
            sessions.append(session)

        catalog = _TrialPreviewCatalog(sqlite_engine)
        recommendations = RecommendedAppQueryService(
            catalog=catalog, trial_apps=TrialAppRepository(factory), trial_enabled=False
        )
        services = _TrialPreviewApplicationservices(
            app_previews=AppPreviewQueryService(
                apps=AppPreviewQueryRepository(session_factory=factory), is_previewable=recommendations.is_previewable
            ),
            app_definitions=AppDefinitionQueryService(
                definitions=AppDefinitionQueryRepository(session_factory=factory), builtin_icon_url_prefix="/tools/"
            ),
            recommended_app_queries=recommendations,
        )
        signed_icons: list[str] = []

        def sign_icon(file_id: str) -> str:
            assert isinstance(sqlite_engine.pool, QueuePool)
            assert sqlite_engine.pool.checkedout() == 0
            signed_icons.append(file_id)
            return f"https://files.example/{file_id}?sign=preview"

        for module in (trial_module, _trial_preview_admission_module):
            monkeypatch.setattr(module, "application_services", lambda: services)
        monkeypatch.setattr(login_module, "current_user", None)
        monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: False)
        monkeypatch.setattr(fields_module.file_helpers, "get_signed_file_url", sign_icon)
        app = Flask(__name__)
        app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
        api = ExternalApi(app)
        api.add_resource(trial_module.TrialAppParameterApi, "/trial-apps/<uuid:app_id>/parameters")
        api.add_resource(trial_module.TrialSitApi, "/trial-apps/<uuid:app_id>/site")
        api.add_resource(trial_module.DatasetListApi, "/trial-apps/<uuid:app_id>/datasets")
        return _TrialPreviewHarness(
            app,
            owner,
            target,
            listing,
            site,
            config,
            dataset,
            creator_id,
            sqlite_session_factory,
            sqlite_engine,
            catalog,
            sessions,
            signed_icons,
        )

    @staticmethod
    @pytest.mark.parametrize("endpoint", ["parameters", "site", "datasets"])
    @pytest.mark.parametrize("membership", ["trial", "catalog"])
    def test_anonymous_preview_ignores_trial_feature_quota_and_setup(
        harness: _TrialPreviewHarness, endpoint: _TrialPreviewEndpoint, membership: str
    ) -> None:
        if membership == "catalog":
            with harness.factory.begin() as session:
                session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
            harness.catalog.ids.add(harness.target.id)

        response = harness.get(endpoint, query=harness.dataset_query() if endpoint == "datasets" else "")

        assert response.status_code == 200, response.get_json()
        assert harness.catalog.calls == ([] if membership == "trial" else [harness.target.id])
        with harness.factory() as session:
            assert session.scalar(select(AccountTrialAppRecord.count)) == 100

    @staticmethod
    @pytest.mark.parametrize("endpoint", ["parameters", "site", "datasets"])
    @pytest.mark.parametrize("unavailable", ["unlisted", "disabled", "missing"])
    def test_preview_rejects_unavailable_apps_before_loading_content(
        harness: _TrialPreviewHarness, endpoint: _TrialPreviewEndpoint, unavailable: str
    ) -> None:
        with harness.factory.begin() as session:
            if unavailable == "unlisted":
                session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
            elif unavailable == "disabled":
                session.execute(
                    text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"), {"app_id": harness.target.id}
                )
            else:
                session.execute(delete(_trial_preview_App).where(_trial_preview_App.id == harness.target.id))

        _trial_preview_assert_error(harness.get(endpoint, query=harness.dataset_query()), 404, "app_not_found")
        assert harness.signed_icons == []

    @staticmethod
    def test_parameters_preserve_complete_shape_and_zero_false_empty_values(harness: _TrialPreviewHarness) -> None:
        response = harness.get("parameters")
        assert response.status_code == 200, response.get_json()
        assert response.get_json() == {
            "opening_statement": "",
            "suggested_questions": [],
            "suggested_questions_after_answer": {"enabled": False},
            "speech_to_text": {"enabled": False},
            "text_to_speech": {"enabled": False, "voice": "", "autoPlay": "disabled"},
            "retriever_resource": {"enabled": False},
            "annotation_reply": {"enabled": False},
            "more_like_this": {"enabled": False},
            "user_input_form": _INPUT_FORM,
            "sensitive_word_avoidance": {"enabled": False, "type": "", "configs": []},
            "file_upload": {"enabled": False, "number_limits": 0},
            "system_parameters": {
                "image_file_size_limit": 1,
                "video_file_size_limit": 2,
                "audio_file_size_limit": 3,
                "file_size_limit": 4,
                "workflow_file_upload_limit": 5,
            },
        }

    @staticmethod
    def test_missing_parameter_configuration_is_app_unavailable(harness: _TrialPreviewHarness) -> None:
        with harness.factory.begin() as session:
            session.execute(delete(AppModelConfig).where(AppModelConfig.id == harness.config.id))
        _trial_preview_assert_error(harness.get("parameters"), 400, "app_unavailable")

    @staticmethod
    def test_site_preserves_complete_fields_and_signs_after_session_closes(harness: _TrialPreviewHarness) -> None:
        response = harness.get("site")
        assert response.status_code == 200, response.get_json()
        assert harness.target.enable_site is False
        assert response.get_json() == {
            "title": "Preview site",
            "chat_color_theme": "",
            "chat_color_theme_inverted": False,
            "icon_type": "image",
            "icon": harness.site.icon,
            "icon_background": "",
            "description": None,
            "copyright": "",
            "privacy_policy": None,
            "input_placeholder": "",
            "custom_disclaimer": "",
            "default_language": "en-US",
            "show_workflow_steps": False,
            "use_icon_as_answer_icon": False,
            "icon_url": f"https://files.example/{harness.site.icon}?sign=preview",
        }
        assert harness.signed_icons == [harness.site.icon]

    @staticmethod
    @pytest.mark.parametrize("icon_type", [IconType.EMOJI, None])
    def test_non_image_site_icon_has_no_signed_url(harness: _TrialPreviewHarness, icon_type: IconType | None) -> None:
        with harness.factory.begin() as session:
            session.execute(update(Site).where(Site.id == harness.site.id).values(icon_type=icon_type, icon=""))
        response = harness.get("site")
        assert response.status_code == 200
        assert response.get_json()["icon_url"] is None
        assert harness.signed_icons == []

    @staticmethod
    @pytest.mark.parametrize(
        ("missing", "code"),
        [
            ("site", "app_site_unavailable"),
            ("owner", "app_owner_unavailable"),
            ("archived_owner", "app_owner_unavailable"),
        ],
    )
    def test_site_errors_distinguish_site_and_owner_unavailability(
        harness: _TrialPreviewHarness, missing: str, code: str
    ) -> None:
        with harness.factory.begin() as session:
            if missing == "site":
                session.execute(delete(Site).where(Site.app_id == harness.target.id))
            elif missing == "owner":
                session.execute(delete(Tenant).where(Tenant.id == harness.owner.id))
            else:
                session.execute(update(Tenant).where(Tenant.id == harness.owner.id).values(status=TenantStatus.ARCHIVE))
        _trial_preview_assert_error(harness.get("site"), 403, code)
        assert harness.signed_icons == []

    @staticmethod
    def test_dataset_ids_filter_by_actual_app_owner_without_requiring_binding(harness: _TrialPreviewHarness) -> None:
        with harness.factory.begin() as session:
            other_owner = Dataset(
                tenant_id=harness.listing.tenant_id, name="Listing tenant dataset", created_by=harness.creator_id
            )
            unrequested = Dataset(tenant_id=harness.owner.id, name="Not requested", created_by=harness.creator_id)
            session.add_all([other_owner, unrequested])
        response = harness.get(
            "datasets", query=f"?ids={harness.dataset.id}&ids={harness.dataset.id}&ids={other_owner.id}&ids={uuid4()}"
        )
        assert response.status_code == 200, response.get_json()
        assert response.get_json() == {
            "data": [
                {
                    "id": harness.dataset.id,
                    "name": "Owner dataset",
                    "description": None,
                    "permission": "only_me",
                    "data_source_type": "upload_file",
                    "indexing_technique": None,
                    "created_by": harness.creator_id,
                    "created_at": int(_TRIAL_PREVIEW_CREATED_AT.timestamp()),
                    "permission_keys": [],
                }
            ],
            "has_more": False,
            "limit": 20,
            "total": 1,
            "page": 1,
        }

    @staticmethod
    @pytest.mark.parametrize(
        ("query", "page", "limit", "has_more"),
        [
            ("&page=0&limit=0", 0, 0, False),
            ("&page=-2&limit=-1", -2, -1, False),
            ("&page=invalid&limit=invalid", 1, 20, False),
            ("&page=99&limit=1", 99, 1, False),
        ],
    )
    def test_dataset_page_and_limit_are_metadata_without_slicing(
        harness: _TrialPreviewHarness, query: str, page: int, limit: int, has_more: bool
    ) -> None:
        response = harness.get("datasets", query=harness.dataset_query() + query)
        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert [item["id"] for item in body["data"]] == [harness.dataset.id]
        assert {key: body[key] for key in ("page", "limit", "total", "has_more")} == {
            "page": page,
            "limit": limit,
            "total": 1,
            "has_more": has_more,
        }

    @staticmethod
    @pytest.mark.parametrize("ids", ["missing", "empty"])
    @pytest.mark.parametrize("limit", [20, 0])
    def test_unmatched_dataset_ids_return_empty_result(harness: _TrialPreviewHarness, ids: str, limit: int) -> None:
        response = harness.get("datasets", query=f"?ids={uuid4() if ids == 'missing' else ''}&limit={limit}")
        assert response.status_code == 200
        assert response.get_json() == {"data": [], "has_more": False, "limit": limit, "total": 0, "page": 1}

    @staticmethod
    def test_dataset_list_requires_ids(harness: _TrialPreviewHarness) -> None:
        _trial_preview_assert_error(harness.get("datasets"), 400, "need_add_ids")


"""Preview detail contracts through real HTTP, services, and SQLite queries."""


_TrialPreviewDetailsEndpoint = Literal["detail", "workflows"]
_TRIAL_PREVIEW_DETAILS_CREATED_AT = datetime(2024, 1, 1)
_UPDATED_AT = datetime(2024, 1, 2)


@dataclass
class _TrialPreviewDetailsCatalog:
    engine: Engine
    ids: set[str] = field(default_factory=set)
    calls: list[str] = field(default_factory=list)

    def contains(self, app_id: str) -> bool:
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        self.calls.append(app_id)
        return app_id in self.ids

    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        raise AssertionError(f"Unexpected listing for {language}")

    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        raise AssertionError(f"Unexpected listing for {language}")

    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        raise AssertionError(f"Unexpected catalog detail for {app_id}")


@dataclass
class _TrialPreviewDetailsExternalio:
    engine: Engine
    owner_id: str
    viewer_workspace_id: str
    decryptions: list[tuple[str, str]] = field(default_factory=list)
    tool_calls: list[tuple[str, str, str]] = field(default_factory=list)

    def encrypt(self, tenant_id: str, token: str) -> str:
        assert tenant_id == self.owner_id
        assert token == "workflow-secret"
        return "cipher-workflow"

    def decrypt(self, tenant_id: str, token: str) -> str:
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        self.decryptions.append((tenant_id, token))
        if token == "cipher-workflow":
            assert tenant_id == self.owner_id
            return "workflow-secret"
        assert token == "cipher-tool"
        assert tenant_id == self.viewer_workspace_id
        return "tool-secret"

    def tool_runtime(self, *, tenant_id: str, app_id: str, agent_tool: AgentToolEntity, user_id: str) -> Tool:
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        assert tenant_id == self.viewer_workspace_id
        assert agent_tool.tool_name == "search"
        self.tool_calls.append((tenant_id, app_id, user_id))
        parameter = ToolParameter.model_validate(
            {"name": "api_key", "label": {"en_US": "Key"}, "type": "secret-input", "form": "form"}
        )
        return cast(
            Tool, _ToolRuntime(SimpleNamespace(parameters=[parameter], identity=SimpleNamespace(name="search")))
        )


@dataclass
class _ToolRuntime:
    entity: SimpleNamespace

    def get_runtime_parameters(self) -> list[ToolParameter]:
        return []


@dataclass(frozen=True)
class _TrialPreviewDetailsApplicationservices:
    app_previews: AppPreviewQueryService
    app_preview_details: AppPreviewDetailsRuntime
    recommended_app_queries: RecommendedAppQueryService


@dataclass(frozen=True)
class _TrialPreviewDetailsHarness:
    app: Flask
    owner: Tenant
    viewer_workspace: Tenant
    viewer: Account
    author: Account
    updater: Account
    target: _trial_preview_details_App
    config: AppModelConfig
    site: Site
    workflow: Workflow
    tag: Tag
    factory: sessionmaker[Session]
    engine: Engine
    catalog: _TrialPreviewDetailsCatalog
    io: _TrialPreviewDetailsExternalio
    sessions: list[Session]

    def get(
        self,
        endpoint: _TrialPreviewDetailsEndpoint = "detail",
        *,
        method: str = "GET",
        csrf_token: str | None = None,
    ) -> TestResponse:
        suffix = "" if endpoint == "detail" else "/workflows"
        statements: list[str] = []
        token = generate_csrf_token(self.viewer.id) if csrf_token is None else csrf_token
        client = self.app.test_client()
        client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)

        def record_statement(
            _connection: Connection,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: ExecutionContext,
            _executemany: bool,
        ) -> None:
            statements.append(statement)

        event.listen(self.engine, "before_cursor_execute", record_statement)
        try:
            response = client.open(
                f"/trial-apps/{self.target.id}{suffix}", method=method, headers={HEADER_NAME_CSRF_TOKEN: token}
            )
        finally:
            event.remove(self.engine, "before_cursor_execute", record_statement)
        assert not [sql for sql in statements if sql.lstrip().upper().startswith(("INSERT ", "UPDATE ", "DELETE "))]
        assert response.headers["Content-Type"] == "application/json"
        if method != "HEAD":
            assert int(response.headers["Content-Length"]) == len(response.data)
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        return response

    def assert_app_not_queried(self) -> None:
        assert self.sessions == []
        assert self.catalog.calls == []
        assert self.io.tool_calls == []
        assert self.io.decryptions == []

    def legacy_detail(self) -> dict[str, object]:
        """The unchanged ORM response view is the pre-migration serialization oracle."""
        with self.app.test_request_context(f"/trial-apps/{self.target.id}"), self.factory() as session:
            app = session.get(_trial_preview_details_App, self.target.id)
            assert app is not None
            return trial_module.TrialAppDetailResponse.model_validate(
                AppResponseView(app, session=session, account=self.viewer), from_attributes=True
            ).model_dump(mode="json")


def _trial_preview_details_assert_error(response: TestResponse, status: int, code: str) -> None:
    assert response.status_code == status, response.get_json()
    body = response.get_json()
    assert body["status"] == status
    assert body["code"] == code
    assert body["message"]


class TestTrialPreviewDetailsCases:
    @staticmethod
    @pytest.fixture
    def harness(
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        sqlite_engine: Engine,
        sqlite_session_factory: sessionmaker[Session],
    ) -> _TrialPreviewDetailsHarness:
        config_overrides(
            LOGIN_DISABLED=False,
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            INIT_PASSWORD="",
            SECRET_KEY="preview-admission-test-secret-key",
            CONSOLE_WEB_URL="",
            CONSOLE_API_URL="",
            SERVICE_API_URL="",
            APP_WEB_URL="",
        )
        owner = Tenant(name="App owner")
        viewer_workspace = Tenant(name="Viewer workspace")
        viewer = Account(name="Viewer", email="viewer@example.com", status=AccountStatus.ACTIVE)
        viewer._current_tenant = viewer_workspace
        author = Account(name="Author", email="author@example.com")
        updater = Account(name="Updater", email="updater@example.com")
        target = _trial_preview_details_App(
            id=str(uuid4()),
            tenant_id=owner.id,
            name="Preview app",
            description="",
            mode=_trial_preview_details_AppMode.CHAT,
            icon_type=IconType.EMOJI,
            icon="",
            icon_background=None,
            enable_site=False,
            enable_api=False,
            max_active_requests=0,
            created_at=_TRIAL_PREVIEW_DETAILS_CREATED_AT,
            updated_at=_UPDATED_AT,
        )
        config = AppModelConfig(
            app_id=target.id,
            opening_statement="",
            suggested_questions="[]",
            model='{"provider":"example/model","name":"model","mode":"chat","completion_params":{"temperature":0}}',
            agent_mode='{"enabled":false,"strategy":"function_call","tools":[]}',
            user_input_form='[{"number":{"label":"Count","variable":"count","default":0,"required":false}}]',
        )
        config.created_at = _TRIAL_PREVIEW_DETAILS_CREATED_AT
        config.updated_at = _UPDATED_AT
        site = Site(
            app_id=target.id,
            title="Preview site",
            default_language="en-US",
            customize_token_strategy=CustomizeTokenStrategy.UUID,
            code="preview-code",
            icon_type=IconType.EMOJI,
            icon="",
            icon_background=None,
            chat_color_theme="",
            description=None,
            custom_disclaimer="",
            show_workflow_steps=False,
        )
        site.created_at = _TRIAL_PREVIEW_DETAILS_CREATED_AT
        site.updated_at = _UPDATED_AT
        io = _TrialPreviewDetailsExternalio(sqlite_engine, owner.id, viewer_workspace.id)
        monkeypatch.setattr(encrypter, "encrypt_token", io.encrypt)
        monkeypatch.setattr(encrypter, "decrypt_token", io.decrypt)
        monkeypatch.setattr(ToolManager, "get_agent_tool_runtime", io.tool_runtime)
        monkeypatch.setattr(ToolManager, "get_hardcoded_provider", lambda _provider_id: object())
        with sqlite_session_factory.begin() as session:
            session.add_all([owner, viewer_workspace, viewer, author, updater, target, config, site])
            session.flush()
            target.created_by = author.id
            target.updated_by = updater.id
            target.app_model_config_id = config.id
            workflow = Workflow.new(
                tenant_id=owner.id,
                app_id=target.id,
                type="workflow",
                version="draft",
                graph='{"nodes":[],"edges":[]}',
                features='{"suggested_questions_after_answer":{"enabled":false}}',
                created_by=author.id,
                environment_variables=[
                    SecretVariable(id="secret", name="api_key", value="workflow-secret"),
                    LLMEnvironmentVariable(
                        id="llm", name="shared_model", value={"provider": "provider", "name": "model", "mode": "chat"}
                    ),
                ],
                conversation_variables=[
                    StringVariable(id="topic", name="topic", value="sqlite", selector=["conversation", "topic"])
                ],
                rag_pipeline_variables=[],
            )
            workflow.created_at = _TRIAL_PREVIEW_DETAILS_CREATED_AT
            workflow.updated_at = _UPDATED_AT
            workflow.updated_by = updater.id
            target.workflow_id = workflow.id
            tag = Tag(tenant_id=owner.id, type=TagType.APP, name="Owner tag", created_by=author.id)
            session.add_all([workflow, tag])
            session.flush()
            session.add_all(
                [
                    TrialApp(app_id=target.id, tenant_id=str(uuid4()), trial_limit=0),
                    AccountTrialAppRecord(app_id=target.id, account_id=viewer.id, count=100),
                    TagBinding(tenant_id=owner.id, tag_id=tag.id, target_id=target.id, created_by=author.id),
                    WorkflowToolProvider(
                        name="trial-workflow",
                        label="Trial workflow",
                        icon="icon",
                        app_id=target.id,
                        version="1.0.0",
                        user_id=author.id,
                        tenant_id=owner.id,
                        description="Workflow provider",
                        parameter_configuration="[]",
                    ),
                ]
            )
        factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
        sessions: list[Session] = []

        @event.listens_for(factory, "after_begin")
        def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            assert all(previous is session or not previous.in_transaction() for previous in sessions)
            sessions.append(session)

        catalog = _TrialPreviewDetailsCatalog(sqlite_engine)
        recommendations = RecommendedAppQueryService(
            catalog=catalog, trial_apps=TrialAppRepository(factory), trial_enabled=False
        )
        services = _TrialPreviewDetailsApplicationservices(
            app_previews=AppPreviewQueryService(
                apps=AppPreviewQueryRepository(session_factory=factory), is_previewable=recommendations.is_previewable
            ),
            app_preview_details=AppPreviewDetailsRuntime(details=AppPreviewQueryRepository(session_factory=factory)),
            recommended_app_queries=recommendations,
        )
        for module in (trial_module, _trial_preview_details_admission_module):
            monkeypatch.setattr(module, "application_services", lambda: services)
        monkeypatch.setattr(login_module, "current_user", viewer)
        monkeypatch.setattr(app_module, "current_user", viewer)
        monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: True)
        app = Flask(__name__)
        app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
        login_manager = DifyLoginManager()
        login_manager.init_app(app)
        login_manager.unauthorized_handler(unauthorized_handler)
        api = ExternalApi(app)
        api.error_handlers = console_api.error_handlers.copy()
        api.add_resource(trial_module.AppApi, "/trial-apps/<uuid:app_id>")
        api.add_resource(trial_module.AppWorkflowApi, "/trial-apps/<uuid:app_id>/workflows")
        return _TrialPreviewDetailsHarness(
            app,
            owner,
            viewer_workspace,
            viewer,
            author,
            updater,
            target,
            config,
            site,
            workflow,
            tag,
            sqlite_session_factory,
            sqlite_engine,
            catalog,
            io,
            sessions,
        )

    @staticmethod
    @pytest.mark.parametrize(
        "mode",
        [
            _trial_preview_details_AppMode.CHAT,
            _trial_preview_details_AppMode.COMPLETION,
            _trial_preview_details_AppMode.ADVANCED_CHAT,
            _trial_preview_details_AppMode.WORKFLOW,
            _trial_preview_details_AppMode.AGENT_CHAT,
        ],
    )
    def test_app_detail_keeps_original_response_fields_and_stored_audit_times(
        harness: _TrialPreviewDetailsHarness, mode: _trial_preview_details_AppMode
    ) -> None:
        with harness.factory.begin() as session:
            session.execute(
                update(_trial_preview_details_App)
                .where(_trial_preview_details_App.id == harness.target.id)
                .values(mode=mode)
            )
        expected = harness.legacy_detail()
        if mode == _trial_preview_details_AppMode.AGENT_CHAT:
            expected_config = expected["model_config"]
            assert isinstance(expected_config, dict)
            # Legacy masking could autoflush a response-only config mutation and bump
            # this timestamp. A read-only preview returns the actual stored audit value.
            expected_config["updated_at"] = int(_UPDATED_AT.timestamp())

        response = harness.get()

        assert response.status_code == 200, response.get_json()
        assert response.get_json() == expected
        body = response.get_json()
        assert body["max_active_requests"] == 0
        assert body["enable_site"] is False
        assert body["tags"] == [{"id": harness.tag.id, "name": "Owner tag", "type": "app"}]
        assert body["api_base_url"] == "http://localhost/v1"
        assert body["site"]["app_base_url"] == "http://localhost"
        assert body["site"]["access_token"] == "preview-code"
        with harness.factory() as session:
            assert session.scalar(select(AccountTrialAppRecord.count)) == 100
            assert (
                session.scalar(select(AppModelConfig.updated_at).where(AppModelConfig.id == harness.config.id))
                == _UPDATED_AT
            )

    @staticmethod
    def test_legacy_agent_preview_masks_tools_without_upgrading_mode_or_mutating_config(
        harness: _TrialPreviewDetailsHarness,
    ) -> None:
        agent_mode = {
            "enabled": True,
            "strategy": "function_call",
            "tools": [
                {
                    "provider_type": "builtin",
                    "provider_id": "example",
                    "tool_name": "search",
                    "tool_parameters": {"api_key": "cipher-tool"},
                }
            ],
        }
        with harness.factory.begin() as session:
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == harness.config.id)
                .values(agent_mode=json.dumps(agent_mode))
            )
            app_updated_at = session.scalar(
                select(_trial_preview_details_App.updated_at).where(_trial_preview_details_App.id == harness.target.id)
            )
            config_updated_at = session.scalar(
                select(AppModelConfig.updated_at).where(AppModelConfig.id == harness.config.id)
            )

        response = harness.get()

        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body["mode"] == "agent-chat"
        assert body["model_config"]["agent_mode"]["tools"][0]["tool_parameters"] == {"api_key": "to*******et"}
        assert harness.io.tool_calls == [(harness.viewer_workspace.id, harness.target.id, harness.viewer.id)]
        assert harness.io.decryptions == [(harness.viewer_workspace.id, "cipher-tool")]
        assert harness.viewer_workspace.id != harness.owner.id
        with harness.factory() as session:
            app = session.get(_trial_preview_details_App, harness.target.id)
            config = session.get(AppModelConfig, harness.config.id)
            assert app is not None
            assert config is not None
            assert app.mode == _trial_preview_details_AppMode.CHAT
            assert app.updated_at == app_updated_at
            assert config.agent_mode == json.dumps(agent_mode)
            assert config.updated_at == config_updated_at

    @staticmethod
    @pytest.mark.parametrize(
        "provider_fields",
        [{}, {"provider_id": None}, {"provider_id": 42}, {"provider_id": ""}, {"provider_id": "invalid/provider"}],
        ids=["missing", "null", "non-string", "empty", "invalid-format"],
    )
    def test_invalid_builtin_config_does_not_break_detail_or_valid_tool_masking(
        harness: _TrialPreviewDetailsHarness, monkeypatch: pytest.MonkeyPatch, provider_fields: dict[str, JsonValue]
    ) -> None:
        agent_mode: dict[str, JsonValue] = {
            "enabled": True,
            "strategy": "function_call",
            "tools": [
                {
                    "provider_type": "builtin",
                    "tool_name": "broken",
                    "tool_parameters": {"api_key": "cipher-secret"},
                    "credential_id": None,
                    **provider_fields,
                },
                {
                    "provider_type": "builtin",
                    "provider_id": "example",
                    "tool_name": "search",
                    "tool_parameters": {"api_key": "cipher-tool"},
                },
            ],
        }
        with harness.factory.begin() as session:
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == harness.config.id)
                .values(agent_mode=json.dumps(agent_mode))
            )

        def hardcoded_provider(provider_id: str) -> object:
            if provider_id == "example":
                return object()
            raise KeyError(provider_id)

        def tool_runtime(*, tenant_id: str, app_id: str, agent_tool: AgentToolEntity, user_id: str) -> Tool:
            if agent_tool.provider_id != "example":
                raise ValueError("Invalid historical provider ID")
            return harness.io.tool_runtime(tenant_id=tenant_id, app_id=app_id, agent_tool=agent_tool, user_id=user_id)

        plugin_queries: list[str] = []

        def check_plugins(tenant_id: str, provider_ids: Sequence[GenericProviderID]) -> Sequence[bool]:
            assert tenant_id == harness.owner.id
            plugin_queries.extend(str(provider_id) for provider_id in provider_ids)
            return [False] * len(provider_ids)

        monkeypatch.setattr(ToolManager, "get_hardcoded_provider", hardcoded_provider)
        monkeypatch.setattr(ToolManager, "get_agent_tool_runtime", tool_runtime)
        monkeypatch.setattr(PluginService, "check_tools_existence", check_plugins)

        response = harness.get()

        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body["deleted_tools"] == []
        assert body["model_config"]["agent_mode"]["tools"][0]["tool_parameters"] == {}
        assert body["model_config"]["agent_mode"]["tools"][1]["tool_parameters"] == {"api_key": "to*******et"}
        assert b"cipher-secret" not in response.data
        assert plugin_queries == []
        assert harness.io.tool_calls == [(harness.viewer_workspace.id, harness.target.id, harness.viewer.id)]
        with harness.factory() as session:
            assert session.scalar(
                select(AppModelConfig.agent_mode).where(AppModelConfig.id == harness.config.id)
            ) == json.dumps(agent_mode)

    @staticmethod
    @pytest.mark.parametrize("failure", ["short-config", "runtime", "masking"])
    def test_unmaskable_tool_parameters_are_removed_from_detail_without_changing_storage(
        harness: _TrialPreviewDetailsHarness, monkeypatch: pytest.MonkeyPatch, failure: str
    ) -> None:
        broken_tool: dict[str, JsonValue] = {
            "provider_type": "builtin",
            "tool_parameters": {"api_key": "cipher-secret"},
        }
        if failure != "short-config":
            broken_tool.update(provider_id="broken", tool_name="broken")
        agent_mode: dict[str, JsonValue] = {
            "enabled": True,
            "strategy": "function_call",
            "tools": [
                broken_tool,
                {
                    "provider_type": "builtin",
                    "provider_id": "example",
                    "tool_name": "search",
                    "tool_parameters": {"api_key": "cipher-tool"},
                },
            ],
        }
        with harness.factory.begin() as session:
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == harness.config.id)
                .values(agent_mode=json.dumps(agent_mode))
            )

        class MaskingFailureRuntime(_ToolRuntime):
            parameter_queries: int = 0

            @override
            def get_runtime_parameters(self) -> list[ToolParameter]:
                self.parameter_queries += 1
                if self.parameter_queries == 2:
                    raise RuntimeError("Tool metadata became unavailable during masking")
                return []

        parameter = ToolParameter.model_validate(
            {"name": "api_key", "label": {"en_US": "Key"}, "type": "secret-input", "form": "form"}
        )
        broken_runtime = MaskingFailureRuntime(
            SimpleNamespace(parameters=[parameter], identity=SimpleNamespace(name="broken"))
        )

        def tool_runtime(*, tenant_id: str, app_id: str, agent_tool: AgentToolEntity, user_id: str) -> Tool:
            if agent_tool.provider_id == "example":
                return harness.io.tool_runtime(
                    tenant_id=tenant_id, app_id=app_id, agent_tool=agent_tool, user_id=user_id
                )
            if failure == "runtime":
                raise RuntimeError("Tool provider is unavailable")
            return cast(Tool, broken_runtime)

        def decrypt(tenant_id: str, token: str) -> str:
            if token == "cipher-secret":
                assert tenant_id == harness.viewer_workspace.id
                return "plain-secret"
            return harness.io.decrypt(tenant_id, token)

        monkeypatch.setattr(ToolManager, "get_agent_tool_runtime", tool_runtime)
        monkeypatch.setattr(encrypter, "decrypt_token", decrypt)

        response = harness.get()

        assert response.status_code == 200, response.get_json()
        tools = response.get_json()["model_config"]["agent_mode"]["tools"]
        assert tools[0]["tool_parameters"] == {}
        assert tools[1]["tool_parameters"] == {"api_key": "to*******et"}
        assert b"cipher-secret" not in response.data
        assert b"plain-secret" not in response.data
        assert broken_runtime.parameter_queries == (2 if failure == "masking" else 0)
        with harness.factory() as session:
            assert session.scalar(
                select(AppModelConfig.agent_mode).where(AppModelConfig.id == harness.config.id)
            ) == json.dumps(agent_mode)

    @staticmethod
    def test_workflow_is_anonymous_and_masks_secrets_after_query_session_closes(
        harness: _TrialPreviewDetailsHarness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(login_module, "current_user", None)
        monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: False)
        response = harness.get("workflows", csrf_token="")
        assert response.status_code == 200, response.get_json()
        assert response.get_json() == {
            "id": harness.workflow.id,
            "graph": {"nodes": [], "edges": []},
            "features": {"suggested_questions_after_answer": {"enabled": False}},
            "hash": harness.workflow.unique_hash,
            "version": "draft",
            "marked_name": "",
            "marked_comment": "",
            "created_by": {"id": harness.author.id, "name": "Author", "email": "author@example.com"},
            "created_at": int(_TRIAL_PREVIEW_DETAILS_CREATED_AT.timestamp()),
            "updated_by": {"id": harness.updater.id, "name": "Updater", "email": "updater@example.com"},
            "updated_at": int(_UPDATED_AT.timestamp()),
            "tool_published": True,
            "environment_variables": [
                {
                    "value_type": "secret",
                    "value": encrypter.full_mask_token(),
                    "id": "secret",
                    "name": "api_key",
                    "description": "",
                    "selector": ["env", "api_key"],
                },
                {
                    "value_type": "llm",
                    "value": {"provider": "provider", "name": "model", "mode": "chat"},
                    "id": "llm",
                    "name": "shared_model",
                    "description": "",
                    "selector": ["env", "shared_model"],
                },
            ],
            "conversation_variables": [
                {"id": "topic", "name": "topic", "value_type": "string", "value": "sqlite", "description": ""}
            ],
            "rag_pipeline_variables": [],
        }
        assert harness.io.decryptions == [(harness.owner.id, "cipher-workflow")]
        assert b"workflow-secret" not in response.data
        assert b"cipher-workflow" not in response.data

    @staticmethod
    @pytest.mark.parametrize("endpoint", ["detail", "workflows"])
    def test_catalog_only_admission_keeps_preview_available(
        harness: _TrialPreviewDetailsHarness, endpoint: _TrialPreviewDetailsEndpoint
    ) -> None:
        with harness.factory.begin() as session:
            session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
        harness.catalog.ids.add(harness.target.id)
        response = harness.get(endpoint)
        assert response.status_code == 200, response.get_json()
        assert harness.catalog.calls == [harness.target.id]

    @staticmethod
    @pytest.mark.parametrize("endpoint", ["detail", "workflows"])
    @pytest.mark.parametrize("unavailable", ["unlisted", "disabled", "missing"])
    def test_unavailable_apps_fail_admission(
        harness: _TrialPreviewDetailsHarness, endpoint: _TrialPreviewDetailsEndpoint, unavailable: str
    ) -> None:
        with harness.factory.begin() as session:
            if unavailable == "unlisted":
                session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
            elif unavailable == "disabled":
                session.execute(
                    text("UPDATE apps SET status='disabled' WHERE id=:app_id"), {"app_id": harness.target.id}
                )
            else:
                session.execute(
                    delete(_trial_preview_details_App).where(_trial_preview_details_App.id == harness.target.id)
                )
        _trial_preview_details_assert_error(harness.get(endpoint), 404, "app_not_found")
        assert harness.io.decryptions == []

    @staticmethod
    def test_anonymous_app_detail_requires_account(
        harness: _TrialPreviewDetailsHarness, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(login_module, "current_user", None)
        response = harness.get()
        assert response.status_code == 401
        assert response.get_json() == {"code": "unauthorized", "message": "Unauthorized.", "status": 401}
        harness.assert_app_not_queried()

    @staticmethod
    @pytest.mark.parametrize(
        ("init_password", "error_code"), [("", "not_setup"), ("setup-password", "not_init_validated")]
    )
    def test_app_detail_requires_setup_before_account_or_app_queries(
        harness: _TrialPreviewDetailsHarness,
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        init_password: str,
        error_code: str,
    ) -> None:
        config_overrides(INIT_PASSWORD=init_password)
        monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: False)
        monkeypatch.setattr(login_module, "current_user", None)
        _trial_preview_details_assert_error(harness.get(csrf_token=""), 401, error_code)
        harness.assert_app_not_queried()

    @staticmethod
    @pytest.mark.parametrize("csrf_token", ["", "invalid-signed-token"], ids=["missing", "invalid"])
    def test_app_detail_rejects_invalid_csrf_before_app_queries(
        harness: _TrialPreviewDetailsHarness, csrf_token: str
    ) -> None:
        response = harness.get(csrf_token=csrf_token)
        _trial_preview_details_assert_error(response, 401, "unauthorized")
        assert response.get_json()["message"] == "CSRF token is missing or invalid."
        harness.assert_app_not_queried()

    @staticmethod
    def test_app_detail_rejects_csrf_token_for_another_account(harness: _TrialPreviewDetailsHarness) -> None:
        response = harness.get(csrf_token=generate_csrf_token(harness.author.id))
        _trial_preview_details_assert_error(response, 401, "unauthorized")
        assert response.get_json()["message"] == "CSRF token is missing or invalid."
        harness.assert_app_not_queried()

    @staticmethod
    def test_app_detail_rejects_uninitialized_account_before_app_queries(harness: _TrialPreviewDetailsHarness) -> None:
        harness.viewer.status = AccountStatus.UNINITIALIZED
        _trial_preview_details_assert_error(harness.get(), 400, "account_not_initialized")
        harness.assert_app_not_queried()

    @staticmethod
    def test_missing_active_workspace_uses_shared_console_error_and_monitoring(
        harness: _TrialPreviewDetailsHarness,
    ) -> None:
        harness.viewer._current_tenant = None
        errors: list[BaseException] = []

        def record_error(_sender: object, *, exception: BaseException) -> None:
            errors.append(exception)

        with got_request_exception.connected_to(record_error):
            response = harness.get()

        _trial_preview_details_assert_error(response, 500, "active_workspace_required")
        assert response.get_json()["message"] == "Internal Server Error"
        assert len(errors) == 1
        assert isinstance(errors[0], ActiveWorkspaceRequiredError)
        harness.assert_app_not_queried()

    @staticmethod
    def test_deleted_admitted_account_is_unauthorized(harness: _TrialPreviewDetailsHarness) -> None:
        with harness.factory.begin() as session:
            session.execute(delete(Account).where(Account.id == harness.viewer.id))
        _trial_preview_details_assert_error(harness.get(), 401, "unauthorized")

    @staticmethod
    def test_missing_site_is_specific_error(harness: _TrialPreviewDetailsHarness) -> None:
        with harness.factory.begin() as session:
            session.execute(delete(Site).where(Site.app_id == harness.target.id))
        _trial_preview_details_assert_error(harness.get(), 403, "app_site_unavailable")

    @staticmethod
    def test_missing_model_config_retains_nullable_detail(harness: _TrialPreviewDetailsHarness) -> None:
        with harness.factory.begin() as session:
            session.execute(delete(AppModelConfig).where(AppModelConfig.id == harness.config.id))
        response = harness.get()
        assert response.status_code == 200, response.get_json()
        assert response.get_json()["model_config"] is None

    @staticmethod
    def test_agent_detail_keeps_model_less_presentation_config(harness: _TrialPreviewDetailsHarness) -> None:
        with harness.factory.begin() as session:
            session.execute(
                update(_trial_preview_details_App)
                .where(_trial_preview_details_App.id == harness.target.id)
                .values(mode=_trial_preview_details_AppMode.AGENT)
            )
            session.execute(update(AppModelConfig).where(AppModelConfig.id == harness.config.id).values(model=None))
            agent_id, snapshot_id = str(uuid4()), str(uuid4())
            session.add_all(
                [
                    Agent(
                        id=agent_id,
                        tenant_id=harness.owner.id,
                        app_id=harness.target.id,
                        name="Preview agent",
                        scope=AgentScope.ROSTER,
                        source=AgentSource.AGENT_APP,
                        active_config_snapshot_id=snapshot_id,
                    ),
                    AgentConfigSnapshot(
                        id=snapshot_id,
                        tenant_id=harness.owner.id,
                        agent_id=agent_id,
                        version=1,
                        config_snapshot=AgentSoulConfig(),
                    ),
                    AgentConfigRevision(
                        tenant_id=harness.owner.id,
                        agent_id=agent_id,
                        current_snapshot_id=snapshot_id,
                        revision=1,
                        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
                    ),
                ]
            )

        response = harness.get()

        assert response.status_code == 200, response.get_json()
        body = response.get_json()
        assert body["mode"] == "agent"
        assert body["model_config"]["model"] is None
        assert body["model_config"]["opening_statement"] == ""

    @staticmethod
    @pytest.mark.parametrize("missing", ["reference", "workflow"])
    def test_missing_workflow_is_app_unavailable(harness: _TrialPreviewDetailsHarness, missing: str) -> None:
        with harness.factory.begin() as session:
            if missing == "reference":
                session.execute(
                    update(_trial_preview_details_App)
                    .where(_trial_preview_details_App.id == harness.target.id)
                    .values({_trial_preview_details_App.workflow_id: None})
                )
            else:
                session.execute(delete(Workflow).where(Workflow.id == harness.workflow.id))
        _trial_preview_details_assert_error(harness.get("workflows"), 400, "app_unavailable")

    @staticmethod
    @pytest.mark.parametrize("endpoint", ["detail", "workflows"])
    def test_head_keeps_get_status_and_headers_without_response_body(
        harness: _TrialPreviewDetailsHarness, endpoint: _TrialPreviewDetailsEndpoint
    ) -> None:
        response = harness.get(endpoint)
        head = harness.get(endpoint, method="HEAD")
        assert response.status_code == head.status_code == 200
        assert head.data == b""
        assert head.headers == response.headers

    @staticmethod
    @pytest.mark.parametrize(
        ("endpoint", "relation"), [("detail", "config"), ("detail", "workflow"), ("workflows", "workflow")]
    )
    def test_cross_owner_configuration_is_not_exposed(
        harness: _TrialPreviewDetailsHarness, endpoint: _TrialPreviewDetailsEndpoint, relation: str
    ) -> None:
        with harness.factory.begin() as session:
            if relation == "config":
                session.execute(
                    update(AppModelConfig).where(AppModelConfig.id == harness.config.id).values(app_id=str(uuid4()))
                )
            else:
                session.execute(
                    update(Workflow).where(Workflow.id == harness.workflow.id).values(tenant_id=str(uuid4()))
                )
        _trial_preview_details_assert_error(harness.get(endpoint), 400, "app_unavailable")
        assert harness.io.decryptions == []


"""Trial suggested questions through HTTP, real ownership queries, and SQLite."""


@dataclass
class _TrialSuggestedQuestionsFeatures:
    enabled: bool = True
    setup_completed: bool = True
    events: list[str] = field(default_factory=list)

    def is_trial_enabled(self) -> bool:
        self.events.append("feature")
        return self.enabled


@dataclass
class _Provider:
    read_sessions: list[Session]
    app_id: str
    model_sessions: list[Session] = field(default_factory=list)
    token_calls: int = 0
    tenant_ids: list[str] = field(default_factory=list)
    prompts: list[str] = field(default_factory=list)
    traces: list[TraceTask] = field(default_factory=list)
    questions: list[str] = field(default_factory=lambda: ["Next question?", "Another question?"])
    failure: Exception | None = None
    missing_model: bool = False
    app_type: str = "chatbot"

    def get_default_model_instance(self, *, tenant_id: str, model_type: ModelType) -> ModelInstance:
        assert model_type == ModelType.LLM
        self.tenant_ids.append(tenant_id)
        session = db.session()
        assert session.get(_trial_suggested_questions_App, self.app_id) is not None
        self.model_sessions.append(session)
        if self.missing_model:
            raise ProviderTokenNotInitError("No default model")
        return cast(ModelInstance, self)

    def assert_queries_closed(self) -> None:
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.read_sessions + self.model_sessions
        )

    def get_llm_num_tokens(self, prompt_messages: Sequence[PromptMessage]) -> int:
        self.assert_queries_closed()
        self.token_calls += 1
        if self.failure is not None:
            raise self.failure
        return len(prompt_messages)

    def get_model_schema(self) -> AIModelEntity:
        self.assert_queries_closed()
        return AIModelEntity.model_construct(parameter_rules=[])

    def invoke_llm(
        self,
        *,
        prompt_messages: list[PromptMessage],
        model_parameters: Mapping[str, object],
        stop: list[str],
        stream: bool,
    ) -> LLMResult:
        self.assert_queries_closed()
        assert self.tenant_ids == [self.tenant_ids[0]] * 2
        assert get_credit_usage_metadata() == {"app_type": self.app_type, "created_by": "suggested_questions"}
        assert model_parameters == {"max_tokens": 256, "temperature": 0.0}
        assert stop == []
        assert stream is False
        prompt = prompt_messages[0].get_text_content()
        assert "Suggest concise follow-ups" in prompt
        self.prompts.append(prompt)
        return LLMResult(
            model="question-model",
            message=AssistantPromptMessage(content=json.dumps(self.questions)),
            usage=LLMUsage.empty_usage(),
        )

    def add_trace_task(self, task: TraceTask) -> None:
        self.traces.append(task)


@dataclass(frozen=True)
class _TrialSuggestedQuestionsTrialappservices:
    access: TrialAppAccessService


@dataclass(frozen=True)
class _TrialSuggestedQuestionsApplicationservices:
    trial_apps: _TrialSuggestedQuestionsTrialappservices
    recommended_app_queries: _TrialSuggestedQuestionsFeatures
    message_suggested_questions: MessageSuggestedQuestionsRuntime


@dataclass(frozen=True)
class _TrialSuggestedQuestionsHarness:
    app: Flask
    account: Account
    target: _trial_suggested_questions_App
    trial: TrialApp
    conversation: Conversation
    message: Message
    config: AppModelConfig
    factory: sessionmaker[Session]
    features: _TrialSuggestedQuestionsFeatures
    provider: _Provider
    legacy_sessions: list[Session]

    def get(self, *, app_id: str | None = None, message_id: str | None = None) -> TestResponse:
        return self.app.test_client().get(
            f"/trial-apps/{app_id or self.target.id}/messages/{message_id or self.message.id}/suggested-questions"
        )

    def assert_closed(self) -> None:
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.provider.read_sessions + self.legacy_sessions
        )

    def usage(self) -> int | None:
        with self.factory() as session:
            return session.scalar(
                select(AccountTrialAppRecord.count).where(
                    AccountTrialAppRecord.app_id == self.target.id,
                    AccountTrialAppRecord.account_id == self.account.id,
                )
            )


def _trial_suggested_questions_assert_error(
    response: TestResponse, status: int, code: str, message: str | None = None
) -> None:
    assert response.status_code == status, response.get_json()
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert body["message"]
    if message is not None:
        assert body["message"] == message
    assert response.headers["Content-Type"] == "application/json"


class TestTrialSuggestedQuestionsCases:
    @staticmethod
    @pytest.fixture
    def harness(
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        sqlite_session_factory: sessionmaker[Session],
        sqlite_engine: Engine,
    ) -> Iterator[_TrialSuggestedQuestionsHarness]:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, INIT_PASSWORD="", LOGIN_DISABLED=False)
        features = _TrialSuggestedQuestionsFeatures()
        account = Account(name="Trial viewer", email="trial@example.com")
        account._current_tenant = Tenant(name="Viewer workspace")
        target = _trial_suggested_questions_App(
            tenant_id=str(uuid4()),
            name="Trial app",
            mode=_trial_suggested_questions_AppMode.CHAT,
            enable_site=True,
            enable_api=False,
        )
        target.id = str(uuid4())
        trial = TrialApp(app_id=target.id, tenant_id=str(uuid4()), trial_limit=3)
        config = AppModelConfig(
            app_id=target.id,
            suggested_questions_after_answer='{"enabled":true,"prompt":"Suggest concise follow-ups"}',
        )
        with sqlite_session_factory.begin() as session:
            session.add_all([account, target, trial, config])
            session.flush()
            target.app_model_config_id = config.id
            conversation = Conversation(
                app_id=target.id,
                app_model_config_id=config.id,
                mode=_trial_suggested_questions_AppMode.CHAT,
                name="Trial conversation",
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
                from_account_id=account.id,
            )
            session.add(conversation)
            session.flush()
            message = Message(
                app_id=target.id,
                conversation_id=conversation.id,
                inputs={},
                query="What is a trial?",
                message={},
                message_unit_price=Decimal(0),
                answer="A way to try an app.",
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
                from_account_id=account.id,
            )
            session.add(message)

        read_sessions: list[Session] = []
        read_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

        @event.listens_for(read_factory, "after_begin")
        def track_read(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            read_sessions.append(session)

        provider = _Provider(read_sessions, target.id)
        services = _TrialSuggestedQuestionsApplicationservices(
            trial_apps=_TrialSuggestedQuestionsTrialappservices(
                access=TrialAppAccessService(apps=TrialAppRepository(session_factory=read_factory))
            ),
            recommended_app_queries=features,
            message_suggested_questions=MessageSuggestedQuestionsRuntime(session_factory=read_factory),
        )

        def setup_completed() -> bool:
            features.events.append("setup")
            return features.setup_completed

        def csrf(_request: Request, account_id: str) -> None:
            assert account_id == account.id
            features.events.append("csrf")

        for module in (trial_module, _trial_suggested_questions_admission_module):
            monkeypatch.setattr(module, "application_services", lambda: services)
        monkeypatch.setattr(console_wraps, "_is_setup_completed", setup_completed)
        monkeypatch.setattr(login_module, "current_user", account)
        monkeypatch.setattr(login_module, "check_csrf_token", csrf)

        def model_manager(*, tenant_id: str) -> _Provider:
            assert tenant_id == target.tenant_id
            return provider

        def trace_manager(*, app_id: str) -> _Provider:
            assert app_id == target.id
            return provider

        monkeypatch.setattr(message_module.ModelManager, "for_tenant", model_manager)
        monkeypatch.setattr(message_module, "TraceQueueManager", trace_manager)

        app = Flask(__name__)
        app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
        db.init_app(app)
        legacy_sessions: list[Session] = []

        def track_legacy(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            legacy_sessions.append(session)

        event.listen(db.session.session_factory, "after_begin", track_legacy)
        login_manager = DifyLoginManager()
        login_manager.init_app(app)
        login_manager.unauthorized_handler(unauthorized_handler)
        api = ExternalApi(app)
        api.add_resource(
            trial_module.TrialMessageSuggestedQuestionApi,
            "/trial-apps/<uuid:app_id>/messages/<uuid:message_id>/suggested-questions",
        )
        yield _TrialSuggestedQuestionsHarness(
            app,
            account,
            target,
            trial,
            conversation,
            message,
            config,
            sqlite_session_factory,
            features,
            provider,
            legacy_sessions,
        )
        event.remove(db.session.session_factory, "after_begin", track_legacy)
        with app.app_context():
            db.session.remove()
            db.engine.dispose()

    @staticmethod
    @pytest.mark.parametrize(
        "mode",
        [
            _trial_suggested_questions_AppMode.CHAT,
            _trial_suggested_questions_AppMode.AGENT_CHAT,
            _trial_suggested_questions_AppMode.AGENT,
        ],
    )
    @pytest.mark.parametrize("questions", [["Next question?", "Another question?"], []])
    def test_questions_keep_response_history_owner_and_usage(
        harness: _TrialSuggestedQuestionsHarness, questions: list[str], mode: _trial_suggested_questions_AppMode
    ) -> None:
        harness.provider.questions = questions
        harness.provider.app_type = {
            _trial_suggested_questions_AppMode.CHAT: "chatbot",
            _trial_suggested_questions_AppMode.AGENT_CHAT: "agent",
            _trial_suggested_questions_AppMode.AGENT: "agent_v2",
        }[mode]
        with harness.factory.begin() as session:
            session.execute(
                update(_trial_suggested_questions_App)
                .where(_trial_suggested_questions_App.id == harness.target.id)
                .values(mode=mode)
            )
            session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values(mode=mode))
        with harness.factory.begin() as session:
            session.add_all(
                [
                    AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=1),
                    AccountTrialAppRecord(app_id=harness.target.id, account_id=str(uuid4()), count=3),
                ]
            )

        response = harness.get()

        assert response.status_code == 200, response.get_json()
        assert response.get_json() == {"data": questions}
        assert response.headers["Content-Type"] == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        assert len(harness.provider.prompts) == 1
        assert "Human: What is a trial?\nAssistant: A way to try an app." in harness.provider.prompts[0]
        assert harness.provider.tenant_ids == [harness.target.tenant_id] * 2
        assert harness.target.tenant_id not in {harness.trial.tenant_id, harness.account.current_tenant_id}
        assert len(harness.provider.traces) == 1
        assert harness.features.events == ["setup", "csrf", "feature"]
        assert harness.usage() == 1
        assert len(harness.provider.model_sessions) == 2
        harness.assert_closed()

    @staticmethod
    @pytest.mark.parametrize("entity", ["message", "conversation"])
    @pytest.mark.parametrize("mismatch", ["missing", "app", "account", "source", "end-user"])
    def test_message_and_conversation_require_complete_owner_chain(
        harness: _TrialSuggestedQuestionsHarness, entity: str, mismatch: str
    ) -> None:
        message_id = harness.message.id
        with harness.factory.begin() as session:
            record = (
                session.get(Message, harness.message.id)
                if entity == "message"
                else session.get(Conversation, harness.conversation.id)
            )
            assert record is not None
            match mismatch:
                case "missing":
                    if entity == "message":
                        message_id = str(uuid4())
                    else:
                        session.delete(record)
                case "app":
                    record.app_id = str(uuid4())
                case "account":
                    record.from_account_id = str(uuid4())
                case "source":
                    record.from_source = ConversationFromSource.API
                case "end-user":
                    record.from_end_user_id = str(uuid4())

        response = harness.get(message_id=message_id)

        _trial_suggested_questions_assert_error(
            response, 404, "not_found", "Message not found" if entity == "message" else "Conversation not found"
        )
        assert harness.provider.prompts == []
        assert harness.usage() is None
        harness.assert_closed()

    @staticmethod
    def test_deleted_conversation_is_not_visible(harness: _TrialSuggestedQuestionsHarness) -> None:
        with harness.factory.begin() as session:
            session.execute(
                update(Conversation).where(Conversation.id == harness.conversation.id).values(is_deleted=True)
            )
        _trial_suggested_questions_assert_error(harness.get(), 404, "not_found", "Conversation not found")
        assert harness.provider.prompts == []
        harness.assert_closed()

    @staticmethod
    @pytest.mark.parametrize("config", [None, '{"enabled":false}'])
    def test_disabled_or_unset_suggestions_have_specific_error(
        harness: _TrialSuggestedQuestionsHarness, config: str | None
    ) -> None:
        with harness.factory.begin() as session:
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == harness.config.id)
                .values(suggested_questions_after_answer=config)
            )
        _trial_suggested_questions_assert_error(harness.get(), 403, "app_suggested_questions_after_answer_disabled")
        assert harness.provider.prompts == []
        harness.assert_closed()

    @staticmethod
    def test_absent_default_model_keeps_empty_success(harness: _TrialSuggestedQuestionsHarness) -> None:
        harness.provider.missing_model = True
        response = harness.get()
        assert response.status_code == 200
        assert response.get_json() == {"data": []}
        assert harness.provider.prompts == []
        assert harness.provider.traces == []
        harness.assert_closed()

    @staticmethod
    @pytest.mark.parametrize(
        "mode", [_trial_suggested_questions_AppMode.COMPLETION, _trial_suggested_questions_AppMode.WORKFLOW]
    )
    def test_unsupported_app_modes_fail_before_runtime(
        harness: _TrialSuggestedQuestionsHarness, mode: _trial_suggested_questions_AppMode
    ) -> None:
        with harness.factory.begin() as session:
            session.execute(
                update(_trial_suggested_questions_App)
                .where(_trial_suggested_questions_App.id == harness.target.id)
                .values(mode=mode)
            )
        _trial_suggested_questions_assert_error(harness.get(), 400, "not_chat_app")
        assert len(harness.provider.read_sessions) == 1
        assert harness.legacy_sessions == []
        harness.assert_closed()

    @staticmethod
    @pytest.mark.parametrize(
        ("denial", "status", "code"),
        [
            ("setup", 401, "not_setup"),
            ("feature", 403, "trial_app_feature_disabled"),
            ("missing_trial", 403, "trial_app_not_allowed"),
            ("missing_app", 403, "trial_app_not_allowed"),
            ("quota", 403, "trial_app_limit_exceeded"),
            ("uninitialized", 400, "account_not_initialized"),
            ("unauthenticated", 401, "unauthorized"),
        ],
    )
    def test_admission_blocks_before_runtime(
        harness: _TrialSuggestedQuestionsHarness, monkeypatch: pytest.MonkeyPatch, denial: str, status: int, code: str
    ) -> None:
        if denial == "setup":
            harness.features.setup_completed = False
        elif denial == "feature":
            harness.features.enabled = False
        elif denial == "uninitialized":
            harness.account.status = AccountStatus.UNINITIALIZED
        elif denial == "unauthenticated":
            monkeypatch.setattr(login_module, "current_user", None)
        else:
            with harness.factory.begin() as session:
                if denial == "missing_trial":
                    session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
                elif denial == "missing_app":
                    session.execute(
                        delete(_trial_suggested_questions_App).where(
                            _trial_suggested_questions_App.id == harness.target.id
                        )
                    )
                else:
                    session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))
        response = harness.get()
        if denial == "unauthenticated":
            assert response.status_code == 401
            assert response.get_json() == {"code": "unauthorized", "message": "Unauthorized.", "status": 401}
        else:
            _trial_suggested_questions_assert_error(response, status, code)
        assert harness.legacy_sessions == []
        assert harness.provider.prompts == []
        harness.assert_closed()

    @staticmethod
    @pytest.mark.parametrize(
        ("failure", "code", "message"),
        [
            (
                ProviderTokenNotInitError("Missing tenant credentials"),
                "provider_not_initialize",
                "Missing tenant credentials",
            ),
            (QuotaExceededError(), "provider_quota_exceeded", None),
            (ModelCurrentlyNotSupportError(), "model_currently_not_support", None),
            (InvokeError("Provider unavailable"), "completion_request_error", "Provider unavailable"),
        ],
    )
    def test_token_count_failures_preserve_specific_errors_and_close_session(
        harness: _TrialSuggestedQuestionsHarness, failure: Exception, code: str, message: str | None
    ) -> None:
        harness.provider.failure = failure
        _trial_suggested_questions_assert_error(harness.get(), 400, code, message)
        assert harness.provider.token_calls == 1
        assert harness.provider.prompts == []
        assert harness.provider.traces == []
        assert harness.usage() is None
        harness.assert_closed()

    @staticmethod
    @pytest.mark.parametrize("failure", [None, InvokeError("Provider unavailable")])
    def test_runtime_preserves_outer_request_session(
        harness: _TrialSuggestedQuestionsHarness, failure: Exception | None
    ) -> None:
        harness.provider.failure = failure
        with harness.app.app_context():
            outer_session = db.session()
            app_model = outer_session.get(_trial_suggested_questions_App, harness.target.id)
            assert app_model is not None
            app_model.name = "Pending caller change"

            response = harness.get()

            assert response.status_code == (200 if failure is None else 400)
            assert db.session() is outer_session
            assert outer_session.in_transaction()
            assert app_model in outer_session.dirty
            assert app_model.name == "Pending caller change"
            assert harness.provider.model_sessions
            for inner_session in harness.provider.model_sessions:
                assert inner_session is not outer_session
                assert not inner_session.in_transaction()
                assert not inner_session.identity_map
        harness.assert_closed()
        with harness.factory() as session:
            saved_app = session.get(_trial_suggested_questions_App, harness.target.id)
            assert saved_app is not None
            assert saved_app.name == "Trial app"

    @staticmethod
    def test_advanced_chat_without_published_workflow_keeps_empty_success(
        harness: _TrialSuggestedQuestionsHarness,
    ) -> None:
        with harness.factory.begin() as session:
            session.execute(
                update(_trial_suggested_questions_App)
                .where(_trial_suggested_questions_App.id == harness.target.id)
                .values(mode=_trial_suggested_questions_AppMode.ADVANCED_CHAT)
            )
        response = harness.get()
        assert response.status_code == 200
        assert response.get_json() == {"data": []}
        assert len(harness.provider.read_sessions) == 2
        assert harness.provider.prompts == []
        assert harness.usage() is None
        harness.assert_closed()

    @staticmethod
    @pytest.mark.parametrize(
        ("failure", "status", "code", "message"),
        [
            (AppDefinitionUnavailableError("App changed after admission"), 400, "app_unavailable", None),
            (
                SuggestedQuestionsActorNotFoundError("Account disappeared"),
                401,
                "unauthorized",
                "Account no longer exists.",
            ),
        ],
    )
    def test_reload_errors_have_explicit_http_mapping(
        harness: _TrialSuggestedQuestionsHarness,
        monkeypatch: pytest.MonkeyPatch,
        failure: Exception,
        status: int,
        code: str,
        message: str | None,
    ) -> None:
        def reject_reload(
            _self: MessageSuggestedQuestionsRuntime,
            *,
            app_id: str,
            app_owner_tenant_id: str,
            expected_app_mode: str,
            actor: SuggestedQuestionsActor,
            message_id: str,
        ) -> list[str]:
            assert (app_id, app_owner_tenant_id, expected_app_mode, message_id) == (
                harness.target.id,
                harness.target.tenant_id,
                harness.target.mode,
                harness.message.id,
            )
            assert actor == SuggestedQuestionsAccount(account_id=harness.account.id, invoke_from="explore")
            raise failure

        monkeypatch.setattr(MessageSuggestedQuestionsRuntime, "get_suggested_questions", reject_reload)
        _trial_suggested_questions_assert_error(harness.get(), status, code, message)
        assert harness.provider.prompts == []
        assert harness.usage() is None
        harness.assert_closed()
