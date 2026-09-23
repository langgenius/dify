"""API key admission, delegation, error and response contracts."""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import cast
from unittest.mock import Mock
from uuid import UUID

import pytest
from flask import Flask
from flask_restx import Api
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import apikey, flask_admission, wraps
from controllers.console.agent import roster
from controllers.console.datasets import datasets
from core.rbac import RBACPermission
from enums import DeploymentEdition
from extensions.application_services.knowledge import build_dataset_api_key_service
from extensions.ext_application_services import ApplicationServices
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset
from models.model import ApiToken
from services.app.api_key_service import AppApiKeyNotReadyError
from services.auth.api_key_contracts import (
    ApiKeyLimitExceededError,
    ApiKeyNotFoundError,
    ApiKeyRecord,
    ApiKeyResourceNotFoundError,
)

RESOURCE_ID = UUID("00000000-0000-0000-0000-000000000001")
KEY_ID = UUID("00000000-0000-0000-0000-000000000002")


@dataclass
class RecordingKeys:
    calls: list[tuple[str, RequestContext, str, str, str | None]] = field(default_factory=list)
    error: Exception | None = None

    def _record(
        self,
        operation: str,
        context: RequestContext,
        kind: str,
        resource_id: str,
        key_id: str | None = None,
    ) -> ApiKeyRecord:
        self.calls.append((operation, context, kind, resource_id, key_id))
        if self.error:
            raise self.error
        return ApiKeyRecord(
            id=str(KEY_ID),
            type="dataset" if kind == "dataset" else "app",
            token="app-secret-token",
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            dataset_ids=(resource_id,) if kind == "dataset" else (),
        )

    def list_keys(self, context: RequestContext, app_id: str) -> tuple[ApiKeyRecord, ...]:
        return (self._record("list", context, "app", app_id),)

    def create_key(self, context: RequestContext, app_id: str) -> ApiKeyRecord:
        return self._record("create", context, "app", app_id)

    def delete_key(self, context: RequestContext, app_id: str, key_id: str) -> None:
        self._record("delete", context, "app", app_id, key_id)

    def list_agent_keys(self, context: RequestContext, agent_id: str) -> tuple[ApiKeyRecord, ...]:
        return (self._record("list", context, "agent", agent_id),)

    def create_agent_key(self, context: RequestContext, agent_id: str) -> ApiKeyRecord:
        return self._record("create", context, "agent", agent_id)

    def delete_agent_key(self, context: RequestContext, agent_id: str, key_id: str) -> None:
        self._record("delete", context, "agent", agent_id, key_id)


@dataclass
class RecordingDatasetKeys:
    recorder: RecordingKeys

    def list_keys(self, context: RequestContext, dataset_id: str) -> tuple[ApiKeyRecord, ...]:
        return (self.recorder._record("list", context, "dataset", dataset_id),)

    def create_key(self, context: RequestContext, dataset_id: str) -> ApiKeyRecord:
        return self.recorder._record("create", context, "dataset", dataset_id)

    def delete_key(self, context: RequestContext, dataset_id: str, key_id: str) -> None:
        self.recorder._record("delete", context, "dataset", dataset_id, key_id)

    def list_workspace_keys(self, context: RequestContext) -> tuple[ApiKeyRecord, ...]:
        return (self.recorder._record("list", context, "dataset", "workspace"),)

    def create_workspace_key(self, context: RequestContext, _dataset_ids: tuple[str, ...]) -> ApiKeyRecord:
        return self.recorder._record("create", context, "dataset", "workspace")

    def delete_workspace_key(self, context: RequestContext, key_id: str) -> None:
        self.recorder._record("delete", context, "dataset", "workspace", key_id)


@dataclass
class ApiKeyTestServices:
    app_api_keys: RecordingKeys
    dataset_api_keys: RecordingDatasetKeys


type KeysApp = tuple[Flask, RecordingKeys, Account]


@pytest.fixture
def keys_app(monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]) -> KeysApp:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=True, RBAC_ENABLED=False)
    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.id = "actor"
    account.role = TenantAccountRole.OWNER

    def current_account() -> AccountWithTenant:
        return AccountWithTenant(account, "workspace")

    monkeypatch.setattr(flask_admission, "current_account_with_tenant", current_account)
    monkeypatch.setattr(wraps, "current_account_with_tenant", current_account)
    monkeypatch.setattr(flask_admission, "get_request_id", lambda: "request-id")
    monkeypatch.setattr(flask_admission, "get_trace_id", lambda: None)
    keys = RecordingKeys()
    services = cast(ApplicationServices, ApiKeyTestServices(keys, RecordingDatasetKeys(keys)))
    monkeypatch.setattr(apikey, "application_services", lambda: services)
    monkeypatch.setattr(roster, "application_services", lambda: services)
    monkeypatch.setattr(datasets, "application_services", lambda: services)
    app = Flask(__name__)
    api = Api(app)
    api.add_resource(apikey.AppApiKeyListResource, "/app/<uuid:resource_id>")
    api.add_resource(apikey.AppApiKeyResource, "/app/<uuid:resource_id>/<uuid:api_key_id>")
    api.add_resource(apikey.DatasetApiKeyListResource, "/dataset/<uuid:resource_id>")
    api.add_resource(apikey.DatasetApiKeyResource, "/dataset/<uuid:resource_id>/<uuid:api_key_id>")
    api.add_resource(roster.AgentApiKeyListApi, "/agent/<uuid:agent_id>")
    api.add_resource(roster.AgentApiKeyApi, "/agent/<uuid:agent_id>/<uuid:api_key_id>")
    api.add_resource(datasets.DatasetApiKeyApi, "/workspace-keys")
    api.add_resource(datasets.DatasetApiDeleteApi, "/workspace-keys/<uuid:api_key_id>")
    return app, keys, account


@pytest.mark.parametrize("kind", ["app", "dataset", "agent"])
def test_key_routes_forward_stable_context_and_serialize(keys_app: KeysApp, kind: str) -> None:
    app, keys, _ = keys_app
    client = app.test_client()
    path = f"/{kind}/{RESOURCE_ID}"
    headers = {"X-Trace-Id": "trace-id"}

    listed = client.get(path, headers=headers)
    created = client.post(path, headers=headers)
    deleted = client.delete(f"{path}/{KEY_ID}", headers=headers)

    assert listed.status_code == 200
    assert listed.json is not None
    assert listed.json["data"][0]["token"] == ("app-s...oken" if kind == "dataset" else "app-secret-token")
    assert listed.json["data"][0]["dataset_ids"] == ([str(RESOURCE_ID)] if kind == "dataset" else [])
    assert created.status_code == 201
    assert created.json is not None
    assert created.json["token"] == "app-secret-token"
    assert created.json["created_at"] == 1767225600
    assert deleted.status_code == 204
    assert deleted.data == b""
    context = RequestContext("request-id", "trace-id", "actor", "workspace")
    assert keys.calls == [
        ("list", context, kind, str(RESOURCE_ID), None),
        ("create", context, kind, str(RESOURCE_ID), None),
        ("delete", context, kind, str(RESOURCE_ID), str(KEY_ID)),
    ]


@pytest.mark.parametrize("kind", ["app", "dataset", "agent"])
@pytest.mark.parametrize("role", list(TenantAccountRole))
@pytest.mark.parametrize("method", ["GET", "POST", "DELETE"])
def test_admission_preserves_role_policy(keys_app: KeysApp, kind: str, role: TenantAccountRole, method: str) -> None:
    app, keys, account = keys_app
    account.role = role
    path = f"/{kind}/{RESOURCE_ID}" + (f"/{KEY_ID}" if method == "DELETE" else "")
    response = app.test_client().open(path, method=method)
    allowed = role in (apikey.API_KEY_DELETE_ROLES if method == "DELETE" else apikey.API_KEY_EDIT_ROLES)
    assert response.status_code == ({"GET": 200, "POST": 201, "DELETE": 204}[method] if allowed else 403)
    assert bool(keys.calls) is allowed


@pytest.mark.parametrize(
    ("error", "status", "message"),
    [
        (ApiKeyResourceNotFoundError("App not found."), 404, "App not found."),
        (ApiKeyNotFoundError(), 404, "API key not found"),
        (ApiKeyLimitExceededError(10), 400, "Cannot create more than 10 API keys for this resource type."),
        (AppApiKeyNotReadyError(), 409, "Publish the Agent before enabling Web App or API access."),
    ],
)
def test_errors_keep_http_contract(keys_app: KeysApp, error: Exception, status: int, message: str) -> None:
    app, keys, _ = keys_app
    keys.error = error
    response = app.test_client().post(f"/app/{RESOURCE_ID}")
    assert response.status_code == status
    assert response.json is not None
    assert response.json["message"].startswith(message)
    if isinstance(error, ApiKeyLimitExceededError):
        assert response.json["custom"] == "max_keys_exceeded"


@pytest.mark.parametrize(
    ("kind", "permission"),
    [
        ("app", RBACPermission.APP_RELEASE_AND_VERSION),
        ("dataset", RBACPermission.DATASET_API_KEY_MANAGE),
        ("agent", RBACPermission.AGENT_ACCESS_POINT_VIEW),
    ],
)
@pytest.mark.parametrize("allowed", [False, True])
def test_rbac_admission_controls_service_access(
    keys_app: KeysApp,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    permission: RBACPermission,
    allowed: bool,
) -> None:
    from controllers.common.rbac import checks, locators

    app, keys, account = keys_app
    account.role = TenantAccountRole.NORMAL
    config_overrides(RBAC_ENABLED=True)
    monkeypatch.setattr(locators, "agent_binding", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(locators.PlainApp, "owner_id", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(locators.DatasetId, "owner_id", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(locators.AgentId, "owner_id", lambda *_args, **_kwargs: None)
    check = Mock(return_value=allowed)
    monkeypatch.setattr(checks.RBACService.CheckAccess, "check", check)

    response = app.test_client().get(f"/{kind}/{RESOURCE_ID}")

    assert response.status_code == (200 if allowed else 403)
    assert check.call_args.kwargs["scene"] == permission
    assert bool(keys.calls) is allowed


def test_uninitialized_account_is_rejected(keys_app: KeysApp) -> None:
    app, keys, account = keys_app
    account.status = AccountStatus.UNINITIALIZED
    assert app.test_client().post(f"/app/{RESOURCE_ID}").status_code == 400
    assert keys.calls == []


@pytest.mark.parametrize("role", list(TenantAccountRole))
@pytest.mark.parametrize("method", ["GET", "POST", "DELETE"])
def test_workspace_key_admission_preserves_admin_role_policy(
    keys_app: KeysApp, role: TenantAccountRole, method: str
) -> None:
    app, keys, account = keys_app
    account.role = role
    path = "/workspace-keys" + (f"/{KEY_ID}" if method == "DELETE" else "")
    response = app.test_client().open(path, method=method)
    allowed = role in apikey.API_KEY_DELETE_ROLES
    assert response.status_code == ({"GET": 200, "POST": 200, "DELETE": 204}[method] if allowed else 403)
    assert bool(keys.calls) is allowed


@pytest.fixture
def persisted_keys_app(
    keys_app: KeysApp,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> KeysApp:
    app, keys, account = keys_app
    assert account.role is not None
    tenant = Tenant(name="Workspace")
    tenant.id = "workspace"
    sqlite_session.add_all(
        [
            tenant,
            TenantAccountJoin(tenant_id="workspace", account_id=account.id, role=account.role),
            Dataset(id=str(RESOURCE_ID), tenant_id="workspace", name="Private", created_by="other", maintainer="other"),
        ]
    )
    sqlite_session.commit()
    service = build_dataset_api_key_service(database_client=sqlite_session_factory)
    services = Mock(dataset_api_keys=service)
    monkeypatch.setattr(apikey, "application_services", lambda: services)
    monkeypatch.setattr(datasets, "application_services", lambda: services)
    return app, keys, account


def test_private_dataset_rejects_editor_without_creating_token(
    persisted_keys_app: KeysApp, sqlite_session: Session
) -> None:
    app, _, account = persisted_keys_app
    account.role = TenantAccountRole.EDITOR
    member = sqlite_session.scalar(select(TenantAccountJoin))
    assert member is not None
    member.role = account.role
    sqlite_session.commit()
    response = app.test_client().post(f"/dataset/{RESOURCE_ID}")
    assert response.status_code == 403
    assert sqlite_session.scalar(select(ApiToken)) is None


def test_both_http_routes_enforce_the_same_key_limit(persisted_keys_app: KeysApp, sqlite_session: Session) -> None:
    app, _, _ = persisted_keys_app
    client = app.test_client()
    for _ in range(5):
        assert client.post("/workspace-keys").status_code == 200
        assert client.post(f"/dataset/{RESOURCE_ID}").status_code == 201
    for path in ("/workspace-keys", f"/dataset/{RESOURCE_ID}"):
        response = client.post(path)
        assert response.status_code == 400
        assert response.json is not None
        assert response.json["custom"] == "max_keys_exceeded"
    assert len(sqlite_session.scalars(select(ApiToken)).all()) == 10
