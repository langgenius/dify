"""Trial uploads through HTTP, real file services, and SQLite admission/persistence."""

import hashlib
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from io import BytesIO
from typing import Literal
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import httpx
import pytest
from flask import Flask, Request
from sqlalchemy import Connection, delete, event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

import controllers.console.explore.trial as trial_module
import controllers.console.explore.trial_app_admission as admission_module
import controllers.console.files as files_module
import controllers.console.remote_files as remote_module
import controllers.console.wraps as console_wraps
import libs.login as login_module
import services.file_service as file_module
from core.file import remote_fetcher
from core.tools.errors import ToolSSRFError
from enums import DeploymentEdition
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from libs.external_api import ExternalApi
from models import Account, AccountTrialAppRecord, App, AppMode, Tenant, TrialApp, UploadFile
from models.account import TenantAccountRole
from models.enums import CreatorUserRole
from repositories.trial_app_repository import TrialAppRepository
from services.entities.feature_entities import FeatureModel
from services.feature_service import FeatureService
from services.file_service import FileService
from services.remote_file_service import RemoteFileService
from services.trial_app_access_service import TrialAppAccessService

_Endpoint = Literal["files/upload", "remote-files/upload"]
_CREATED_AT = datetime(2024, 1, 1)
_REMOTE_URL = "https://example.com/trial.txt"
_CONTENT = b"trial upload"


@dataclass
class _Features:
    enabled: bool = True
    events: list[str] = field(default_factory=list)

    def is_trial_enabled(self) -> bool:
        self.events.append("feature")
        return self.enabled


@dataclass
class _ExternalIO:
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
class _ApplicationServices:
    trial_app_access: TrialAppAccessService
    recommended_app_queries: _Features
    files: FileService
    remote_files: RemoteFileService


@dataclass(frozen=True)
class _Harness:
    app: Flask
    account: Account
    target: App
    trial: TrialApp
    factory: sessionmaker[Session]
    features: _Features
    io: _ExternalIO

    def url(self, endpoint: _Endpoint) -> str:
        return f"/trial-apps/{self.target.id}/{endpoint}"

    def post(self, endpoint: _Endpoint, *, query: str = "") -> TestResponse:
        if endpoint == "remote-files/upload":
            return self.app.test_client().post(self.url(endpoint) + query, json={"url": _REMOTE_URL})
        return self.app.test_client().post(
            self.url(endpoint) + query,
            data={"file": (BytesIO(_CONTENT), "trial.txt", "text/plain")},
        )

    def uploaded(self) -> list[UploadFile]:
        with self.factory() as session:
            return list(session.scalars(select(UploadFile)))

    def usage(self) -> int | None:
        with self.factory() as session:
            return session.scalar(
                select(AccountTrialAppRecord.count).where(
                    AccountTrialAppRecord.app_id == self.target.id,
                    AccountTrialAppRecord.account_id == self.account.id,
                )
            )


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
) -> _Harness:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        INIT_PASSWORD="",
        LOGIN_DISABLED=False,
        RBAC_ENABLED=False,
        UPLOAD_FILE_SIZE_LIMIT=1,
        inner_UPLOAD_FILE_EXTENSION_BLACKLIST="exe",
    )
    features = _Features()
    account = Account(name="Trial viewer", email="trial@example.com")
    account._current_tenant = Tenant(name="Viewer workspace")
    account.role = TenantAccountRole.OWNER
    target = App(tenant_id=str(uuid4()), name="Trial app", mode=AppMode.CHAT, enable_site=True, enable_api=False)
    target.id = str(uuid4())
    trial = TrialApp(app_id=target.id, tenant_id=str(uuid4()), trial_limit=3)
    with sqlite_session_factory.begin() as session:
        session.add_all([target, trial])

    sessions: list[Session] = []
    repository_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

    @event.listens_for(repository_factory, "after_begin")
    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    io = _ExternalIO(sessions)
    files = FileService(session_factory=sqlite_session_factory)
    services = _ApplicationServices(
        trial_app_access=TrialAppAccessService(apps=TrialAppRepository(session_factory=repository_factory)),
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

    for module in (trial_module, admission_module, files_module, remote_module):
        monkeypatch.setattr(module, "application_services", lambda: services)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", setup_completed)
    monkeypatch.setattr(login_module, "current_user", account)
    monkeypatch.setattr(login_module, "check_csrf_token", csrf)
    monkeypatch.setattr(file_module.storage, "save", io.save)
    monkeypatch.setattr(file_module, "naive_utc_now", lambda: _CREATED_AT)
    monkeypatch.setattr(remote_fetcher, "make_request", io.request)

    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    login_manager = DifyLoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized_handler(unauthorized_handler)
    api = ExternalApi(app)
    api.add_resource(trial_module.TrialAppFileUploadApi, "/trial-apps/<uuid:app_id>/files/upload")
    api.add_resource(trial_module.TrialAppRemoteFileUploadApi, "/trial-apps/<uuid:app_id>/remote-files/upload")
    return _Harness(app, account, target, trial, sqlite_session_factory, features, io)


def _assert_error(response: TestResponse, status: int, code: str) -> None:
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


@pytest.mark.parametrize("content", [_CONTENT, b""])
def test_local_upload_preserves_complete_response_and_owner_tenant(harness: _Harness, content: bytes) -> None:
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
        "created_at": int(_CREATED_AT.timestamp()),
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


@pytest.mark.parametrize("head_status", [200, 405])
def test_remote_upload_fetches_once_and_preserves_response_and_actor(harness: _Harness, head_status: int) -> None:
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
        "created_at": int(_CREATED_AT.timestamp()),
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
    harness: _Harness, endpoint: _Endpoint, denial: str, code: str
) -> None:
    if denial == "feature":
        harness.features.enabled = False
    else:
        with harness.factory.begin() as session:
            if denial == "missing_trial":
                session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
            elif denial == "missing_app":
                session.execute(delete(App).where(App.id == harness.target.id))
            else:
                session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))

    response = harness.app.test_client().post(harness.url(endpoint), json={})

    _assert_error(response, 403, code)
    assert harness.io.saved == {}
    assert harness.io.requests == []
    assert harness.uploaded() == []
    assert harness.usage() == (3 if denial == "quota" else None)
    if denial == "feature":
        assert harness.io.admission_sessions == []
    else:
        harness.io.assert_admission_closed()


@pytest.mark.parametrize("endpoint", ["files/upload", "remote-files/upload"])
def test_upload_does_not_charge_usage_or_inherit_another_accounts_exhausted_quota(
    harness: _Harness, endpoint: _Endpoint
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


@pytest.mark.parametrize(
    ("shape", "code"),
    [("missing", "no_file_uploaded"), ("multiple", "too_many_files"), ("empty_name", "filename_not_exists_error")],
)
def test_multipart_shape_errors_precede_dataset_permissions(harness: _Harness, shape: str, code: str) -> None:
    harness.account.role = TenantAccountRole.NORMAL
    data = {}
    if shape != "missing":
        data["file"] = (BytesIO(_CONTENT), "" if shape == "empty_name" else "trial.txt", "text/plain")
    if shape == "multiple":
        data["second_file"] = (BytesIO(_CONTENT), "second.txt", "text/plain")

    response = harness.app.test_client().post(harness.url("files/upload") + "?source=datasets", data=data)

    _assert_error(response, 400, code)
    assert harness.io.saved == {}
    assert harness.uploaded() == []


@pytest.mark.parametrize(
    ("query_source", "form_source", "status"),
    [("datasets", "unknown", 403), ("unknown", "datasets", 201), ("", "datasets", 403)],
)
def test_query_source_takes_precedence_over_form_before_active_workspace_permission(
    harness: _Harness, query_source: str, form_source: str, status: int
) -> None:
    harness.account.role = TenantAccountRole.NORMAL
    response = harness.app.test_client().post(
        harness.url("files/upload") + f"?source={query_source}",
        data={"file": (BytesIO(_CONTENT), "trial.txt", "text/plain"), "source": form_source},
    )

    assert response.status_code == status
    if status == 403:
        _assert_error(response, status, "forbidden")
        assert harness.io.saved == {}
    else:
        assert len(harness.uploaded()) == 1


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
    harness: _Harness, config_overrides: Callable[..., None], role: TenantAccountRole, rbac: bool, status: int
) -> None:
    harness.account.role = role
    config_overrides(RBAC_ENABLED=rbac)

    response = harness.post("files/upload", query="?source=datasets")

    assert response.status_code == status
    assert len(harness.uploaded()) == (1 if status == 201 else 0)


@pytest.mark.parametrize("endpoint", ["files/upload", "remote-files/upload"])
def test_cloud_document_quota_uses_active_workspace_before_upload(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], endpoint: _Endpoint
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

    _assert_error(response, 403, "forbidden")
    assert checked_tenants == [harness.account.current_tenant_id]
    assert harness.io.saved == {}
    assert harness.io.requests == []
    assert harness.usage() is None


def test_dataset_file_size_limit_comes_from_app_owner_tenant(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
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

    _assert_error(response, 413, "file_too_large")
    assert response.get_json()["message"] == "File size exceeded."
    assert quota_tenants == [harness.account.current_tenant_id]
    assert size_limit_tenants == [harness.target.tenant_id]
    assert harness.io.saved == {}
    assert harness.uploaded() == []


@pytest.mark.parametrize(
    ("filename", "query", "status", "code"),
    [("trial.exe", "", 400, "file_extension_blocked"), ("trial.png", "?source=datasets", 415, "unsupported_file_type")],
)
def test_local_file_policy_errors_keep_specific_codes(
    harness: _Harness, filename: str, query: str, status: int, code: str
) -> None:
    response = harness.app.test_client().post(
        harness.url("files/upload") + query, data={"file": (BytesIO(_CONTENT), filename, "application/octet-stream")}
    )

    _assert_error(response, status, code)
    assert harness.io.saved == {}
    assert harness.uploaded() == []


@pytest.mark.parametrize(
    ("get_status", "status", "code"),
    [
        (404, 404, "remote_file_not_found"),
        (403, 400, "remote_file_access_denied"),
        (503, 502, "remote_file_unavailable"),
    ],
)
def test_remote_http_failures_keep_precise_error_codes(
    harness: _Harness, get_status: int, status: int, code: str
) -> None:
    harness.io.head_status = 405
    harness.io.get_status = get_status

    response = harness.post("remote-files/upload")

    _assert_error(response, status, code)
    assert [method for method, _url, _kwargs in harness.io.requests] == ["HEAD", "GET"]
    assert harness.io.saved == {}
    assert harness.uploaded() == []
    assert harness.usage() is None


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
    harness: _Harness, failure: str, status: int, code: str
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

    _assert_error(response, status, code)
    assert len(harness.io.requests) == 1
    assert harness.io.saved == {}
    assert harness.uploaded() == []
    assert harness.usage() is None


def test_remote_invalid_url_fails_before_network(harness: _Harness) -> None:
    response = harness.app.test_client().post(harness.url("remote-files/upload"), json={"url": "file:///etc/passwd"})

    _assert_error(response, 400, "remote_file_invalid_url")
    assert harness.io.requests == []
    assert harness.io.saved == {}


def test_remote_payload_validation_stays_on_http_boundary(harness: _Harness) -> None:
    response = harness.app.test_client().post(harness.url("remote-files/upload"), json={})

    assert response.status_code == 422
    assert "url" in response.get_json()["message"]
    assert harness.io.requests == []
    assert harness.io.saved == {}
