"""PAT behavior through HTTP, with real services and SQLite persistence."""

from collections.abc import Iterator, Mapping
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask.testing import FlaskClient
from pydantic import JsonValue
from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from controllers.console import bp
from controllers.openapi import bp as openapi_bp
from controllers.openapi._catalog import CATALOG_HEADER
from dify_app import DifyApp
from enums import DeploymentEdition
from extensions.ext_application_services import ApplicationServices
from extensions.ext_login import bind_account_loader, bind_account_only_loader, login_manager
from extensions.ext_redis import RedisClientWrapper
from libs import rate_limit
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import App, AppMode
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account, make_app, make_tenant

type RunnerCatalog = tuple[Tenant, list[App], str, list[str], dict[str, dict[str, JsonValue] | Exception], list[str]]

BASE = "/console/api/account/personal-access-tokens"


@pytest.fixture
def rbac_enabled(request: pytest.FixtureRequest) -> bool:
    try:
        return request.param
    except AttributeError:
        return False


@pytest.fixture
def client(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    account_application_services: ApplicationServices,
    rbac_enabled: bool,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> Iterator[FlaskClient]:
    from redis.client import Pipeline

    from extensions.ext_application_services import build_application_services

    # Keep Redis command construction real; only its network dispatch is replaced.
    monkeypatch.setattr(Pipeline, "execute", lambda *_args, **_kwargs: [])

    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        LOGIN_DISABLED=False,
        SECRET_KEY="test-only-browser-signing-key-32-bytes",
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
        ENABLE_OAUTH_BEARER=True,
        RBAC_ENABLED=rbac_enabled,
    )
    monkeypatch.setattr(rate_limit, "LIMIT_BEARER_PER_TOKEN", replace(rate_limit.LIMIT_BEARER_PER_TOKEN, limit=0))
    account = make_account(account_id=str(uuid4()), tenant=None)
    with sqlite_session_factory.begin() as session:
        session.add(account)
    app = DifyApp(__name__)
    app.config["TESTING"] = True
    app.config["TEST_BROWSER_ACCOUNT"] = account
    login_manager.init_app(app)
    bind_account_loader(app, account_application_services.accounts.identity.load_user)
    bind_account_only_loader(app, account_application_services.accounts.identity.get_account_by_id)
    services = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis_transport[0],
    )
    app.extensions["application_services"] = replace(
        services,
        accounts=account_application_services.accounts,
        workspaces=account_application_services.workspaces,
    )
    app.register_blueprint(bp)
    app.register_blueprint(openapi_bp)

    with app.test_client() as browser:
        browser.set_cookie("access_token", PassportService().issue({"user_id": account.id}))
        csrf = generate_csrf_token(account.id)
        browser.set_cookie("csrf_token", csrf)
        browser.environ_base["HTTP_X_CSRF_TOKEN"] = csrf
        yield browser


def test_created_pat_is_listed_without_exposing_its_secret(client: FlaskClient) -> None:
    created = client.post(BASE, json={"name": "  release-pipeline  "})
    assert created.status_code == 201, created.get_json()
    token = created.get_json()
    listed = client.get(BASE)
    assert listed.status_code == 200, listed.get_json()
    row = listed.get_json()["data"][0]
    assert row["id"] == token["id"]
    assert row["name"] == "release-pipeline"
    assert row["resource_scope_mode"] == row["workspace_scope_mode"] == "all"
    assert row["expires_at"] is not None
    assert row["created_at"].endswith("Z")
    assert row["expires_at"].endswith("Z")
    assert "secret" not in row
    assert "secret_ciphertext" not in row
    assert "secret_digest" not in row


def test_secret_is_returned_only_at_creation(client: FlaskClient) -> None:
    response = client.post(BASE, json={"name": "release-pipeline"})
    assert response.status_code == 201
    created = response.get_json()
    secret = created["secret"]
    assert secret.startswith("dpat_")
    assert secret.endswith(created["secret_last_four"])
    assert response.headers["Cache-Control"] == "no-store"
    assert "secret" not in client.get(BASE).get_json()["data"][0]
    assert "secret" not in client.get(f"{BASE}/{created['id']}").get_json()["token"]
    assert client.post(f"{BASE}/{created['id']}/secret").status_code == 404


def test_last_used_records_bearer_authentication_not_creation(client: FlaskClient) -> None:
    created = client.post(BASE, json={"name": "usage"}).get_json()
    secret = created["secret"]
    assert client.get(BASE).get_json()["data"][0]["last_used_at"] is None
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == 200
    used = client.get(BASE).get_json()["data"][0]["last_used_at"]
    assert used.endswith("Z")
    assert datetime.fromisoformat(used) >= datetime.fromisoformat(created["created_at"])
    assert (
        client.get(
            "/openapi/v1/workspaces", headers={**headers, "Authorization": f"Bearer {secret}invalid"}
        ).status_code
        == 401
    )
    assert client.get(BASE).get_json()["data"][0]["last_used_at"] == used


def test_workspace_scope_displays_current_role_and_hides_it_after_membership_loss(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()), name="Release")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
    candidates = client.get("/console/api/account/personal-access-token-workspaces").get_json()
    assert candidates["data"][0]["role"] == "owner"
    created = client.post(
        BASE,
        json={
            "name": "workspace",
            "resource_scope": {"mode": "none"},
            "workspace_scope": {"mode": "selected", "workspace_ids": [workspace.id]},
        },
    ).get_json()
    detail_url = f"{BASE}/{created['id']}"
    assert client.get(detail_url).get_json()["workspaces"][0]["role"] == "owner"
    with sqlite_session_factory.begin() as session:
        session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == account.id))
    detail = client.get(detail_url).get_json()
    assert detail["workspaces"][0]["role"] is None
    assert detail["token"]["workspace_count"] == 1
    assert detail["token"]["unavailable_count"] == 1


def test_revoked_pat_disappears_and_its_secret_cannot_be_copied(client: FlaskClient) -> None:
    token_id = client.post(BASE, json={"name": "retired"}).get_json()["id"]
    revoked = client.delete(f"{BASE}/{token_id}")
    assert revoked.status_code == 204, revoked.get_data(as_text=True)
    assert revoked.get_data() == b""
    assert client.get(BASE).get_json()["data"] == []
    assert client.post(f"{BASE}/{token_id}/secret").status_code == 404


def test_another_account_cannot_list_copy_or_revoke_the_holders_pat(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    token_id = client.post(BASE, json={"name": "private"}).get_json()["id"]
    other = make_account(account_id=str(uuid4()), tenant=None)
    with sqlite_session_factory.begin() as session:
        session.add(other)
    client.application.config["TEST_BROWSER_ACCOUNT"] = other
    client.set_cookie("access_token", PassportService().issue({"user_id": other.id}))
    csrf = generate_csrf_token(other.id)
    client.set_cookie("csrf_token", csrf)
    client.environ_base["HTTP_X_CSRF_TOKEN"] = csrf
    assert client.get(BASE).get_json()["data"] == []
    assert client.post(f"{BASE}/{token_id}/secret").status_code == 404
    assert client.delete(f"{BASE}/{token_id}").status_code == 404
    assert client.get(f"{BASE}/{token_id}").status_code == 404
    assert client.patch(f"{BASE}/{token_id}", json={"name": "stolen", "version": 1}).status_code == 404


def test_csrf_is_required_to_create_a_pat(client: FlaskClient) -> None:
    del client.environ_base["HTTP_X_CSRF_TOKEN"]
    assert client.post(BASE, json={"name": "unauthorized"}).status_code == 401


def test_a_pat_cannot_manage_personal_tokens_without_a_browser_session(client: FlaskClient) -> None:
    token = client.post(BASE, json={"name": "business-only"}).get_json()
    secret = token["secret"]
    with client.application.test_client() as automation:
        headers = {"Authorization": f"Bearer {secret}"}
        assert automation.get(BASE, headers=headers).status_code == 401
        assert automation.get(f"{BASE}/{token['id']}", headers=headers).status_code == 401
        assert automation.delete(f"{BASE}/{token['id']}", headers=headers).status_code == 401


def test_created_pat_persists_only_the_secret_digest(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    import hashlib

    from models.personal_access_token import PersonalAccessToken

    response = client.post(BASE, json={"name": "digest-only"})
    assert response.status_code == 201
    token = response.get_json()
    with sqlite_session_factory() as session:
        stored = session.get(PersonalAccessToken, token["id"])
        assert stored is not None
        assert len(stored.secret_digest) == 64
        assert stored.secret_digest != hashlib.sha256(token["secret"].encode()).hexdigest()


def test_expired_pat_remains_visible_but_cannot_authenticate(
    client: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services import personal_access_token_service

    monkeypatch.setattr(personal_access_token_service, "naive_utc_now", lambda: datetime(2026, 1, 1))
    token = client.post(BASE, json={"name": "short-lived", "expiration": "30_days"}).get_json()
    assert datetime.fromisoformat(token["expires_at"]) == datetime(2026, 1, 31, tzinfo=UTC)
    monkeypatch.setattr(personal_access_token_service, "naive_utc_now", lambda: datetime(2026, 1, 31))
    headers = {
        "Authorization": f"Bearer {token['secret']}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == 401
    listed = client.get(BASE).get_json()["data"]
    assert listed[0]["id"] == token["id"]
    assert listed[0]["status"] == "expired"


def test_create_pat_with_365_day_expiration(client: FlaskClient) -> None:
    response = client.post(BASE, json={"name": "year-long", "expiration": "365_days"})
    assert response.status_code == 201, response.get_json()
    created = response.get_json()
    assert datetime.fromisoformat(created["expires_at"]) - datetime.fromisoformat(created["created_at"]) == timedelta(
        days=365
    )


def test_retrying_create_with_the_same_key_returns_the_original_pat(client: FlaskClient) -> None:
    headers = {"Idempotency-Key": str(uuid4())}
    first = client.post(BASE, json={"name": "retry-safe"}, headers=headers)
    retried = client.post(BASE, json={"name": "retry-safe"}, headers=headers)
    assert first.status_code == retried.status_code == 201
    assert first.get_json()["id"] == retried.get_json()["id"]
    assert client.get(BASE).get_json()["total"] == 1
    changed = client.post(BASE, json={"name": "different"}, headers=headers)
    assert changed.status_code == 409


def test_admin_api_key_cannot_bypass_personal_pat_browser_admission(
    client: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, ADMIN_API_KEY_ENABLE=True, ADMIN_API_KEY="test-admin-key")
    del client.environ_base["HTTP_X_CSRF_TOKEN"]
    response = client.post(BASE, json={"name": "admin-key-attempt"}, headers={"Authorization": "Bearer test-admin-key"})
    assert response.status_code == 401


def test_pat_can_be_limited_to_one_owned_app(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    tenant = make_tenant(tenant_id=str(uuid4()), name="Personal workspace")
    app = make_app(app_id=str(uuid4()), tenant_id=tenant.id, name="Support assistant")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                account,
                tenant,
                app,
                TenantAccountJoin(
                    current=True,
                    tenant_id=tenant.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
    payload: dict[str, JsonValue] = {
        "name": "one-app",
        "resource_scope": {
            "mode": "selected",
            "resources": [{"resource_type": "app", "resource_id": app.id}],
        },
        "workspace_scope": {"mode": "none", "workspace_ids": []},
    }
    created = client.post(BASE, json=payload)
    assert created.status_code == 201, created.get_json()
    token = created.get_json()
    assert token["resource_scope_mode"] == "selected"
    assert token["workspace_scope_mode"] == "none"
    listed = client.get(BASE).get_json()["data"][0]
    assert listed["resource_count"] == 1
    assert listed["workspace_count"] == 0
    assert listed["unavailable_count"] == 0
    detail = client.get(f"{BASE}/{token['id']}")
    assert detail.status_code == 200, detail.get_json()
    assert detail.get_json()["resources"][0]["resource_id"] == app.id
    assert detail.get_json()["resources"][0]["available"] is True


def test_edit_preserves_secret_expiry_and_rejects_a_stale_version(client: FlaskClient) -> None:
    created = client.post(BASE, json={"name": "before"}).get_json()
    secret = created["secret"]
    updated = client.patch(f"{BASE}/{created['id']}", json={"name": "after", "version": created["version"]})
    assert updated.status_code == 200, updated.get_json()
    token = updated.get_json()["token"]
    assert token["name"] == "after"
    assert token["expires_at"] == created["expires_at"]
    assert token["resource_scope_mode"] == token["workspace_scope_mode"] == "all"
    assert "secret" not in token
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == 200
    stale = client.patch(f"{BASE}/{created['id']}", json={"name": "stale", "version": created["version"]})
    assert stale.status_code == 409
    assert client.get(f"{BASE}/{created['id']}").get_json()["token"]["name"] == "after"


@pytest.mark.parametrize("kind", ["app", "dataset"])
def test_resource_selection_spans_workspaces_independently_of_workspace_management(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], kind: str
) -> None:
    from sqlalchemy import update

    from tests.helpers.unit.model_factories import make_dataset

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    current = make_tenant(tenant_id=str(uuid4()), name="Current space")
    other = make_tenant(tenant_id=str(uuid4()), name="Other space")
    resources = [
        make_app(app_id=str(uuid4()), tenant_id=w.id, name=w.name, maintainer=account.id)
        if kind == "app"
        else make_dataset(dataset_id=str(uuid4()), tenant_id=w.id, name=w.name, maintainer=account.id)
        for w in (current, other)
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                current,
                other,
                *resources,
                *[
                    TenantAccountJoin(
                        tenant_id=w.id, account_id=account.id, role=TenantAccountRole.OWNER, current=w is current
                    )
                    for w in (current, other)
                ],
            ]
        )
    endpoint = "/console/api/account/personal-access-token-resources"
    response = client.get(endpoint, query_string={"keyword": "space"})
    assert response.status_code == 200, response.get_json()
    assert {row["resource_id"] for row in response.get_json()["data"]} == {resource.id for resource in resources}
    matching = client.get(endpoint, query_string={"keyword": resources[1].id}).get_json()["data"]
    assert [row["workspace_id"] for row in matching] == [other.id]
    workspaces = client.get("/console/api/account/personal-access-token-workspaces").get_json()["data"]
    assert {w["workspace_id"] for w in workspaces} == {current.id, other.id}
    payload = {
        "name": "Cross-workspace resource selection",
        "resource_scope": {"mode": "selected", "resources": [{"resource_type": kind, "resource_id": resources[1].id}]},
        "workspace_scope": {"mode": "selected", "workspace_ids": [current.id]},
    }
    created = client.post(BASE, json=payload)
    assert created.status_code == 201, created.get_json()
    token = created.get_json()
    with sqlite_session_factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == account.id).values(current=False)
        )
        session.execute(
            update(TenantAccountJoin)
            .where(
                TenantAccountJoin.account_id == account.id,
                TenantAccountJoin.tenant_id == other.id,
            )
            .values(current=True)
        )
    candidates = client.get(endpoint).get_json()["data"]
    assert {row["resource_id"] for row in candidates} == {resource.id for resource in resources}
    # PAT resource candidates and saved grants do not depend on the active workspace.
    detail = client.get(f"{BASE}/{token['id']}").get_json()
    assert detail["token"]["status"] == "active"
    assert detail["resources"][0]["resource_id"] == resources[1].id
    assert detail["resources"][0]["workspace_id"] == other.id
    payload["resource_scope"]["resources"].append({"resource_type": kind, "resource_id": resources[0].id})
    payload.pop("name")
    edited = client.patch(
        f"{BASE}/{token['id']}", json={"name": "Retained and new", "version": token["version"], **payload}
    )
    assert edited.status_code == 200, edited.get_json()
    assert len(edited.get_json()["resources"]) == 2


def test_resource_candidates_do_not_require_a_current_workspace(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                    current=False,
                ),
            ]
        )
    response = client.get("/console/api/account/personal-access-token-resources")
    assert response.status_code == 200, response.get_json()
    assert [row["resource_id"] for row in response.get_json()["data"]] == [app.id]
    assert client.get("/console/api/account/personal-access-token-workspaces").get_json()["data"]


def test_pat_authenticates_workspace_business_requests_and_revocation_rejects_new_requests(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()), name="Automation")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
    created = client.post(BASE, json={"name": "automation", "resource_scope": {"mode": "none"}}).get_json()
    secret = created["secret"]
    fingerprint = client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER]
    headers = {"Authorization": f"Bearer {secret}", CATALOG_HEADER: fingerprint}
    response = client.get("/openapi/v1/workspaces", headers=headers)
    assert response.status_code == 200, response.get_json()
    assert [item["id"] for item in response.get_json()["data"]] == [workspace.id]
    assert client.delete(f"{BASE}/{created['id']}").status_code == 204
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == 401


def test_app_scope_filters_discovery_and_workspace_scope_cannot_bypass_it(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()), name="Apps")
    allowed = make_app(app_id=str(uuid4()), tenant_id=workspace.id, name="Allowed")
    denied = make_app(app_id=str(uuid4()), tenant_id=workspace.id, name="Denied")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                allowed,
                denied,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
    token = client.post(
        BASE,
        json={
            "name": "one-app",
            "resource_scope": {
                "mode": "selected",
                "resources": [{"resource_type": "app", "resource_id": allowed.id}],
            },
        },
    ).get_json()
    secret = token["secret"]
    fingerprint = client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER]
    headers = {"Authorization": f"Bearer {secret}", CATALOG_HEADER: fingerprint}
    described = client.get(f"/openapi/v1/apps/{allowed.id}?fields=info", headers=headers)
    assert described.status_code == 200, described.get_json()
    assert client.get(f"/openapi/v1/apps/{denied.id}?fields=info", headers=headers).status_code == 403
    listed = client.get("/openapi/v1/apps", query_string={"workspace_id": workspace.id}, headers=headers)
    assert listed.status_code == 200, listed.get_json()
    assert [app["id"] for app in listed.get_json()["data"]] == [allowed.id]
    assert listed.get_json()["total"] == 1


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/workspaces/{id}"),
        ("POST", "/workspaces/{id}:switch"),
        ("GET", "/workspaces/{id}/members"),
        ("POST", "/workspaces/{id}/members"),
        ("PATCH", "/workspaces/{id}/members/{id}"),
        ("DELETE", "/workspaces/{id}/members/{id}"),
        ("POST", "/workspaces/{id}/apps/workflow"),
        ("POST", "/workspaces/{id}/apps/imports"),
        ("GET", "/workspaces/{id}/knowledge-bases"),
        ("PATCH", "/apps/{id}/app-info/workflow"),
        ("POST", "/apps/{id}:publish"),
        ("GET", "/apps/{id}/dsl"),
        ("GET", "/apps/{id}/versions"),
    ],
)
def test_pat_rejects_management_outside_phase_one(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], method: str, path: str
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    target_id = str(uuid4())
    workspace = make_tenant(tenant_id=target_id)
    app = make_app(app_id=target_id, tenant_id=target_id, mode=AppMode.WORKFLOW)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    current=True, tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.OWNER
                ),
            ]
        )
    token = client.post(BASE, json={"name": "all scopes"}).get_json()
    headers = {
        "Authorization": f"Bearer {token['secret']}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    response = client.open("/openapi/v1" + path.format(id=target_id), method=method, json={}, headers=headers)
    assert response.status_code == 403, response.get_json()
    assert response.get_json()["message"] == "personal_access_token_not_supported"


@pytest.mark.parametrize("rbac_enabled", [True], indirect=True)
@pytest.mark.parametrize("allowed", [True, False])
@pytest.mark.parametrize(
    ("method", "suffix"),
    [
        ("POST", "model-providers/openai/credentials"),
        ("PATCH", "model-providers/openai/credentials/credential"),
        ("POST", "model-providers/openai/models/credentials"),
        ("PATCH", "model-providers/openai/models/credentials/credential"),
        ("POST", "tool-providers/custom/credentials"),
        ("PATCH", "tool-providers/custom/credentials/credential"),
    ],
)
def test_pat_credential_management_still_requires_rbac(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    method: str,
    suffix: str,
    allowed: bool,
) -> None:
    from tests.helpers.unit.rbac_fakes import build_rbac_domain

    domain = build_rbac_domain(sqlite_session_factory, monkeypatch)
    domain.transport.response = {"allowed": allowed}
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                TenantAccountJoin(
                    current=True, tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.NORMAL
                ),
            ]
        )
    token = client.post(BASE, json={"name": "credentials", "resource_scope": {"mode": "none"}}).get_json()
    headers = {
        "Authorization": f"Bearer {token['secret']}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    response = client.open(f"/openapi/v1/workspaces/{workspace.id}/{suffix}", method=method, json={}, headers=headers)
    assert response.status_code == (422 if allowed else 403), response.get_json()
    assert [request.endpoint for request in domain.transport.requests] == ["/rbac/check-access"]


def test_selected_workspace_permits_model_requests_only_in_that_workspace(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    first = make_tenant(tenant_id=str(uuid4()), name="Selected")
    second = make_tenant(tenant_id=str(uuid4()), name="Excluded")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                first,
                second,
                *[
                    TenantAccountJoin(
                        tenant_id=workspace.id,
                        account_id=account.id,
                        role=TenantAccountRole.OWNER,
                    )
                    for workspace in (first, second)
                ],
            ]
        )
    token = client.post(
        BASE,
        json={
            "name": "management",
            "resource_scope": {"mode": "none"},
            "workspace_scope": {"mode": "selected", "workspace_ids": [first.id]},
        },
    ).get_json()
    secret = token["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    models = client.get(f"/openapi/v1/workspaces/{first.id}/models?limit=0", headers=headers)
    assert models.status_code == 422, models.get_json()
    assert client.get(f"/openapi/v1/workspaces/{second.id}/models?limit=0", headers=headers).status_code == 403
    listed = client.get("/openapi/v1/workspaces", headers=headers)
    assert [row["id"] for row in listed.get_json()["data"]] == [first.id]


@pytest.mark.parametrize("operation", ["workflow:run", "chat:run", "advanced-chat:run", "completion:run", "files"])
def test_authorized_pat_reaches_existing_business_request_validation(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    operation: str,
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
    token = client.post(BASE, json={"name": "business"}).get_json()
    secret = token["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    url = f"/openapi/v1/apps/{app.id}/{operation}"
    # Invalid input must be rejected by the existing contract after PAT admission,
    # without executing workflows, invoking models or performing an upload/import.
    response = client.post(url, json={}, headers=headers)
    assert response.status_code == 422, response.get_json()


def test_create_retry_after_membership_loss_returns_the_existing_pat_and_issue_status(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
    payload = {
        "name": "retry",
        "resource_scope": {
            "mode": "selected",
            "resources": [
                {"resource_type": "app", "resource_id": app.id},
            ],
        },
    }
    headers = {"Idempotency-Key": str(uuid4())}
    first = client.post(BASE, json=payload, headers=headers).get_json()
    with sqlite_session_factory.begin() as session:
        session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == workspace.id))
    retried = client.post(BASE, json=payload, headers=headers)
    assert retried.status_code == 201, retried.get_json()
    assert retried.get_json()["id"] == first["id"]
    assert retried.get_json()["status"] == "access_issue"
    edited = client.patch(f"{BASE}/{first['id']}", json={"name": "renamed", "version": first["version"]})
    assert edited.status_code == 200, edited.get_json()
    assert edited.get_json()["resources"][0]["display_name"] == app.name
    assert edited.get_json()["resources"][0]["available"] is False


@pytest.mark.parametrize("mode", ["chat", "agent-chat", "completion"])
def test_pat_with_app_access_can_stop_message_tasks_but_still_requires_app_access(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    mode: str,
) -> None:
    from models.model import AppMode

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id, mode=AppMode.value_of(mode))
    other_app = make_app(app_id=str(uuid4()), tenant_id=workspace.id, mode=AppMode.value_of(mode))
    redis_transport[1].side_effect = lambda *_args, **_kwargs: None
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                other_app,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
    token = client.post(
        BASE,
        json={
            "name": "runner",
            "resource_scope": {"mode": "selected", "resources": [{"resource_type": "app", "resource_id": app.id}]},
            "workspace_scope": {"mode": "none", "workspace_ids": []},
        },
    ).get_json()
    secret = token["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    stopped = client.post(f"/openapi/v1/apps/{app.id}/tasks/{uuid4()}:stop", headers=headers)
    assert stopped.status_code == 200, stopped.get_json()
    assert client.post(f"/openapi/v1/apps/{app.id}/tasks/{uuid4()}:stop", headers=headers).status_code == 200
    assert client.post(f"/openapi/v1/apps/{other_app.id}/tasks/{uuid4()}:stop", headers=headers).status_code == 403
    edited = client.patch(
        f"{BASE}/{token['id']}",
        json={
            "name": "runner",
            "version": token["version"],
            "resource_scope": {"mode": "none"},
            "workspace_scope": {"mode": "all"},
        },
    )
    assert edited.status_code == 200, edited.get_json()
    assert client.post(f"/openapi/v1/apps/{app.id}/tasks/{uuid4()}:stop", headers=headers).status_code == 403
    assert client.delete(f"{BASE}/{token['id']}").status_code == 204
    assert client.post(f"/openapi/v1/apps/{app.id}/tasks/{uuid4()}:stop", headers=headers).status_code == 401


def test_pat_can_read_and_submit_a_valid_form_started_by_another_account(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Given two forms and a PAT, submit the shared form and deny access to its run history."""
    import json

    from graphon.enums import WorkflowExecutionStatus
    from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
    from models.human_input import HumanInputForm, HumanInputFormRecipient, RecipientType
    from models.model import AppMode
    from models.workflow import WorkflowRun, WorkflowType
    from services.human_input_service import resume_app_execution

    resumed: list[dict[str, object]] = []
    monkeypatch.setattr(resume_app_execution, "apply_async", lambda **kwargs: resumed.append(kwargs))
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id, mode=AppMode.WORKFLOW)
    form_tokens = [str(uuid4()).replace("-", "") for _ in range(2)]
    own_run_id, other_run_id = str(uuid4()), str(uuid4())
    own_form_id, other_form_id = str(uuid4()), str(uuid4())
    forms = [
        (form_tokens[0], account.id, own_run_id, own_form_id),
        (form_tokens[1], str(uuid4()), other_run_id, other_form_id),
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
        for form_token, owner, run_id, form_id in forms:
            session.add(
                WorkflowRun(
                    id=run_id,
                    tenant_id=workspace.id,
                    app_id=app.id,
                    workflow_id=str(uuid4()),
                    type=WorkflowType.WORKFLOW,
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                    version="1",
                    graph="{}",
                    inputs="{}",
                    status=WorkflowExecutionStatus.RUNNING,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=owner,
                )
            )
            session.add(
                HumanInputForm(
                    id=form_id,
                    tenant_id=workspace.id,
                    app_id=app.id,
                    workflow_run_id=run_id,
                    node_id="approval",
                    form_definition=json.dumps(
                        {
                            "form_content": "Approve?",
                            "rendered_content": "Approve?",
                            "user_actions": [{"id": "approve", "title": "Approve"}],
                        }
                    ),
                    rendered_content="Approve?",
                    expiration_time=datetime(2099, 1, 1),
                )
            )
            session.add(
                HumanInputFormRecipient(
                    form_id=form_id,
                    delivery_id=str(uuid4()),
                    recipient_type=RecipientType.STANDALONE_WEB_APP,
                    recipient_payload="{}",
                    access_token=form_token,
                )
            )
    token = client.post(BASE, json={"name": "forms"}).get_json()
    secret = token["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    base = f"/openapi/v1/apps/{app.id}/human-input-forms"
    own = client.get(f"{base}/{form_tokens[0]}", headers=headers)
    assert own.status_code == 200, own.get_json()
    assert own.get_json()["form_content"] == "Approve?"
    assert client.get(f"{base}/{form_tokens[1]}", headers=headers).status_code == 200
    assert (
        client.post(
            f"{base}/{form_tokens[1]}:submit", json={"action": "approve", "inputs": {}}, headers=headers
        ).status_code
        == 200
    )
    assert len(resumed) == 1
    with sqlite_session_factory() as session:
        submitted = session.get(HumanInputForm, other_form_id)
        assert submitted is not None
        assert submitted.submission_user_id == account.id
        assert submitted.selected_action_id == "approve"
    # Possession of a form token does not grant access to its run history.
    assert client.get(f"/openapi/v1/apps/{app.id}/runs/{other_run_id}/events", headers=headers).status_code == 404
    edited = client.patch(
        f"{BASE}/{token['id']}",
        json={
            "name": "forms",
            "version": token["version"],
            "resource_scope": {"mode": "none"},
            "workspace_scope": {"mode": "all"},
        },
    )
    assert edited.status_code == 200, edited.get_json()
    assert client.get(f"{base}/{form_tokens[0]}", headers=headers).status_code == 403


@pytest.mark.parametrize("kind", ["app", "dataset"])
def test_resource_candidate_cursor_visits_each_matching_type_once(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    kind: str,
) -> None:
    from tests.helpers.unit.model_factories import make_dataset

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    apps = [make_app(app_id=str(uuid4()), tenant_id=workspace.id, name=name) for name in ("A", "C", "E")]
    datasets = [
        make_dataset(dataset_id=str(uuid4()), tenant_id=workspace.id, name=name, maintainer=account.id)
        for name in ("B", "D", "F")
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                *apps,
                *datasets,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
    url = "/console/api/account/personal-access-token-resources"
    query = {"limit": 2, "resource_type": kind}
    expected = apps if kind == "app" else datasets
    first = client.get(url, query_string=query).get_json()
    assert [(row["resource_type"], row["resource_id"]) for row in first["data"]] == [
        (kind, resource.id) for resource in expected[:2]
    ]
    assert first["has_more"] is True
    second = client.get(url, query_string={**query, "cursor": first["next_cursor"]}).get_json()
    assert [(row["resource_type"], row["resource_id"]) for row in second["data"]] == [(kind, expected[2].id)]
    assert second["has_more"] is False
    assert second["next_cursor"] is None


@pytest.mark.parametrize("rbac_enabled", [True], indirect=True)
def test_studio_rbac_controls_visibility_without_blocking_published_pat_runs(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.helpers.unit.rbac_fakes import build_rbac_domain

    domain = build_rbac_domain(sqlite_session_factory, monkeypatch)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    domain.transport.response = {"allowed": True}
    domain.transport.responses["/rbac/my-permissions"] = {"app": {"default_permission_keys": ["app.acl.preview"]}}
    domain.transport.responses["/rbac/apps/whitelist/resources"] = {
        "unrestricted": True,
        "resource_ids": list[JsonValue](),
    }
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.NORMAL,
                ),
            ]
        )
    created = client.post(
        BASE,
        json={
            "name": "rbac",
            "resource_scope": {
                "mode": "selected",
                "resources": [
                    {"resource_type": "app", "resource_id": app.id},
                ],
            },
        },
    )
    assert created.status_code == 201, created.get_json()
    token = created.get_json()
    secret = token["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    url = f"/openapi/v1/apps/{app.id}/chat:run"
    domain.transport.requests.clear()
    assert client.post(url, json={}, headers=headers).status_code == 422
    assert domain.transport.requests == []
    domain.transport.response = {"allowed": False}
    assert client.post(url, json={}, headers=headers).status_code == 422
    assert domain.transport.requests == []
    # Existing account read visibility still controls discovery independently of run rights.
    listing = client.get("/openapi/v1/apps", query_string={"workspace_id": workspace.id}, headers=headers)
    assert [item["id"] for item in listing.get_json()["data"]] == [app.id]
    # Upload preserves the existing no-RBAC contract and reaches file payload validation.
    domain.transport.requests.clear()
    assert client.post(f"/openapi/v1/apps/{app.id}/files", headers=headers).status_code == 422
    assert domain.transport.requests == []
    # Losing Studio test permission does not revoke a visible configuration selection.
    assert (
        client.get("/console/api/account/personal-access-token-resources").get_json()["data"][0]["resource_id"]
        == app.id
    )
    assert client.get(BASE).get_json()["data"][0]["status"] == "active"
    # List visibility, independently, controls candidate selection and saved status.
    domain.transport.responses["/rbac/apps/whitelist/resources"] = {
        "unrestricted": False,
        "resource_ids": list[JsonValue](),
    }
    assert client.get("/console/api/account/personal-access-token-resources").get_json()["data"] == []
    listing = client.get("/openapi/v1/apps", query_string={"workspace_id": workspace.id}, headers=headers)
    assert listing.get_json()["data"] == []
    assert listing.get_json()["total"] == 0
    assert client.get(BASE).get_json()["data"][0]["status"] == "access_issue"
    assert client.get(BASE).get_json()["data"][0]["unavailable_count"] == 1
    detail = client.get(f"{BASE}/{token['id']}").get_json()
    assert detail["resources"][0]["available"] is False
    domain.transport.response = {"allowed": True}
    domain.transport.responses["/rbac/apps/whitelist/resources"] = {
        "unrestricted": True,
        "resource_ids": list[JsonValue](),
    }
    assert client.post(url, json={}, headers=headers).status_code == 422
    assert client.get(BASE).get_json()["data"][0]["status"] == "active"


def test_creation_retry_does_not_reveal_secret_or_break_original_authentication(client: FlaskClient) -> None:
    creation_headers = {"Idempotency-Key": str(uuid4())}
    token = client.post(BASE, json={"name": "durable-auth"}, headers=creation_headers).get_json()
    retried = client.post(BASE, json={"name": "durable-auth"}, headers=creation_headers)
    assert retried.status_code == 201
    assert retried.get_json()["id"] == token["id"]
    assert retried.get_json()["secret"] is None
    headers = {
        "Authorization": f"Bearer {token['secret']}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == 200


def test_disabling_the_holder_rejects_bearer_requests_and_browser_token_access(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from models.account import Account, AccountStatus

    token = client.post(BASE, json={"name": "holder"}).get_json()
    secret = token["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    with sqlite_session_factory.begin() as session:
        account = session.get(Account, client.application.config["TEST_BROWSER_ACCOUNT"].id)
        assert account is not None
        account.status = AccountStatus.BANNED
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == 401
    assert client.get(f"{BASE}/{token['id']}").status_code == 401


@pytest.mark.parametrize(
    "scope",
    [
        {"resource_scope": {"mode": "selected", "resources": []}},
        {"workspace_scope": {"mode": "selected", "workspace_ids": []}},
        {
            "resource_scope": {
                "mode": "all",
                "resources": [
                    {"resource_type": "dataset", "resource_id": "00000000-0000-0000-0000-000000000001"},
                ],
            }
        },
    ],
)
def test_invalid_scopes_never_create_a_token(client: FlaskClient, scope: dict[str, object]) -> None:
    response = client.post(BASE, json={"name": "invalid", **scope})
    assert response.status_code == 400, response.get_json()
    assert client.get(BASE).get_json()["total"] == 0


def test_legacy_app_runner_resource_type_is_rejected(client: FlaskClient) -> None:
    response = client.post(
        BASE,
        json={
            "name": "legacy-resource-type",
            "resource_scope": {
                "mode": "selected",
                "resources": [
                    {"resource_type": "app_runner", "resource_id": "00000000-0000-0000-0000-000000000001"},
                ],
            },
        },
    )
    assert response.status_code == 422, response.get_json()
    assert client.get(BASE).get_json()["total"] == 0


@pytest.mark.parametrize(
    ("resource_mode", "workspace_mode", "expected_status"),
    [("none", "none", 400), ("all", "none", 201), ("none", "all", 201)],
)
@pytest.mark.parametrize("edition", list(DeploymentEdition))
def test_creation_requires_at_least_one_scope_domain(
    client: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
    resource_mode: str,
    workspace_mode: str,
    expected_status: int,
    edition: DeploymentEdition,
) -> None:
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=edition)
    monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
    response = client.post(
        BASE,
        headers={"Idempotency-Key": "scope-validation"},
        json={
            "name": "scope validation",
            "expiration": "90_days",
            "resource_scope": {"mode": resource_mode, "resources": []},
            "workspace_scope": {"mode": workspace_mode, "workspace_ids": []},
        },
    )
    assert response.status_code == expected_status, response.get_json()
    assert client.get(BASE).get_json()["total"] == (1 if expected_status == 201 else 0)


@pytest.mark.parametrize("edition", list(DeploymentEdition))
def test_rejects_disabling_both_scopes_without_changing_the_token(
    client: FlaskClient, monkeypatch: pytest.MonkeyPatch, edition: DeploymentEdition
) -> None:
    token = client.post(BASE, json={"name": "unchanged"}).get_json()
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=edition)
    monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
    original = client.get(f"{BASE}/{token['id']}").get_json()
    response = client.patch(
        f"{BASE}/{token['id']}",
        json={
            "name": "must-not-save",
            "version": token["version"],
            "resource_scope": {"mode": "none", "resources": []},
            "workspace_scope": {"mode": "none", "workspace_ids": []},
        },
    )
    assert response.status_code == 400, response.get_json()
    assert client.get(f"{BASE}/{token['id']}").get_json() == original


def test_rejected_scope_update_preserves_name_and_grants(client: FlaskClient) -> None:
    token = client.post(BASE, json={"name": "unchanged"}).get_json()
    rejected = client.patch(
        f"{BASE}/{token['id']}",
        json={
            "name": "must-not-save",
            "version": token["version"],
            "resource_scope": {"mode": "all"},
            "workspace_scope": {"mode": "selected", "workspace_ids": [str(uuid4())]},
        },
    )
    assert rejected.status_code == 403, rejected.get_json()
    saved = client.get(f"{BASE}/{token['id']}").get_json()["token"]
    assert saved["name"] == "unchanged"
    assert saved["version"] == token["version"]
    assert saved["resource_scope_mode"] == saved["workspace_scope_mode"] == "all"


def test_expiration_rejects_new_business_requests_at_the_exact_boundary(
    client: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services import personal_access_token_service

    monkeypatch.setattr(personal_access_token_service, "naive_utc_now", lambda: datetime(2026, 1, 1))
    token = client.post(BASE, json={"name": "expires", "expiration": "30_days"}).get_json()
    secret = token["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    monkeypatch.setattr(personal_access_token_service, "naive_utc_now", lambda: datetime(2026, 1, 30, 23, 59, 59))
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == 200
    monkeypatch.setattr(personal_access_token_service, "naive_utc_now", lambda: datetime(2026, 1, 31))
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == 401
    assert client.patch(f"{BASE}/{token['id']}", json={"name": "late", "version": token["version"]}).status_code == 403


@pytest.mark.parametrize("rbac_enabled", [True], indirect=True)
@pytest.mark.parametrize("operation", ["workflow:run", "chat:run", "advanced-chat:run", "completion:run"])
def test_enterprise_private_app_permission_is_rechecked_on_each_business_request(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    from services.enterprise.base import EnterpriseRequest
    from tests.helpers.unit.rbac_fakes import build_rbac_domain

    domain = build_rbac_domain(sqlite_session_factory, monkeypatch)
    domain.transport.response = {"allowed": False}

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.NORMAL,
                ),
            ]
        )
    token = client.post(BASE, json={"name": "private-app"}).get_json()
    secret = token["secret"]
    permission: dict[str, object] = {"allowed": True, "mode": "private"}

    def send(_method: str, endpoint: str, **_kwargs: object) -> dict[str, object]:
        if endpoint == "/info":
            return {}
        if endpoint == "/webapp/access-mode/id":
            return {"accessMode": permission["mode"]}
        if endpoint == "/webapp/permission":
            return {"result": permission["allowed"]}
        raise AssertionError(f"Unexpected Enterprise request: {endpoint}")

    monkeypatch.setattr(EnterpriseRequest, "send_request", send)
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    url = f"/openapi/v1/apps/{app.id}/{operation}"
    assert client.post(url, json={"inputs": "invalid"}, headers=headers).status_code == 422
    permission["allowed"] = False
    assert client.post(url, json={"inputs": "invalid"}, headers=headers).status_code == 403
    permission["allowed"] = True
    assert client.post(url, json={"inputs": "invalid"}, headers=headers).status_code == 422
    permission["mode"] = "public"
    permission["allowed"] = False
    assert client.post(url, json={"inputs": "invalid"}, headers=headers).status_code == 422
    permission["mode"] = "unknown-mode"
    assert client.post(url, json={"inputs": "invalid"}, headers=headers).status_code == 403

    assert domain.transport.requests == []


def test_workspace_candidates_are_searchable_and_paginated_across_current_memberships(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspaces = [make_tenant(tenant_id=str(uuid4()), name=name) for name in ("A", "B")]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                *workspaces,
                make_tenant(tenant_id=str(uuid4()), name="Hidden"),
                *[
                    TenantAccountJoin(tenant_id=w.id, account_id=account.id, role=TenantAccountRole.NORMAL)
                    for w in workspaces
                ],
            ]
        )
    url = "/console/api/account/personal-access-token-workspaces"
    first = client.get(url, query_string={"limit": 1})
    assert first.status_code == 200, first.get_json()
    assert [item["workspace_id"] for item in first.get_json()["data"]] == [workspaces[0].id]
    next_page = client.get(url, query_string={"cursor": first.get_json()["next_cursor"], "limit": 1}).get_json()
    assert [item["workspace_id"] for item in next_page["data"]] == [workspaces[1].id]
    assert next_page["has_more"] is False
    searched = client.get(url, query_string={"keyword": workspaces[1].id}).get_json()
    assert [item["workspace_id"] for item in searched["data"]] == [workspaces[1].id]


def test_switching_out_of_selected_removes_bindings_and_unavailable_apps_cannot_be_added_back(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
    token = client.post(
        BASE,
        json={
            "name": "selected",
            "resource_scope": {
                "mode": "selected",
                "resources": [
                    {"resource_type": "app", "resource_id": app.id},
                ],
            },
            "workspace_scope": {"mode": "none", "workspace_ids": []},
        },
    ).get_json()
    edited = client.patch(
        f"{BASE}/{token['id']}",
        json={
            "name": "all",
            "version": token["version"],
            "resource_scope": {"mode": "all"},
            "workspace_scope": {"mode": "none"},
        },
    )
    assert edited.status_code == 200, edited.get_json()
    assert edited.get_json()["resources"] == edited.get_json()["workspaces"] == []
    with sqlite_session_factory.begin() as session:
        session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == workspace.id))
    retry = client.patch(
        f"{BASE}/{token['id']}",
        json={
            "name": "reselect",
            "version": edited.get_json()["token"]["version"],
            "resource_scope": {"mode": "selected", "resources": [{"resource_type": "app", "resource_id": app.id}]},
            "workspace_scope": {"mode": "none"},
        },
    )
    assert retry.status_code == 403, retry.get_json()
    stored = client.get(f"{BASE}/{token['id']}").get_json()
    assert stored["token"]["name"] == "all"
    assert stored["token"]["status"] == "active"
    assert stored["resources"] == []


def test_multiple_pats_share_account_run_results_and_never_read_another_identitys_results(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    import json

    from graphon.enums import WorkflowExecutionStatus
    from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
    from models.model import AppMode
    from models.workflow import WorkflowRun, WorkflowType

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id, mode=AppMode.WORKFLOW)
    run_ids = [str(uuid4()) for _ in range(3)]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
        for run_id, role, owner in (
            (run_ids[0], CreatorUserRole.ACCOUNT, account.id),
            (run_ids[1], CreatorUserRole.ACCOUNT, str(uuid4())),
            (run_ids[2], CreatorUserRole.END_USER, account.id),
        ):
            session.add(
                WorkflowRun(
                    id=run_id,
                    tenant_id=workspace.id,
                    app_id=app.id,
                    workflow_id=str(uuid4()),
                    type=WorkflowType.WORKFLOW,
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                    version="1",
                    graph="{}",
                    inputs="{}",
                    status=WorkflowExecutionStatus.SUCCEEDED,
                    outputs=json.dumps({"result": "private result"}),
                    created_by_role=role,
                    created_by=owner,
                    finished_at=datetime(2026, 1, 1),
                    elapsed_time=1,
                    total_tokens=0,
                    total_steps=1,
                    exceptions_count=0,
                )
            )
    headers_by_token = []
    tokens = []
    fingerprint = client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER]
    for name in ("first", "second"):
        token = client.post(BASE, json={"name": name}).get_json()
        tokens.append(token)
        secret = token["secret"]
        headers = {"Authorization": f"Bearer {secret}", CATALOG_HEADER: fingerprint}
        headers_by_token.append(headers)
        own = client.get(f"/openapi/v1/apps/{app.id}/runs/{run_ids[0]}/events", headers=headers)
        assert own.status_code == 200, own.get_data(as_text=True)
        assert "private result" in own.get_data(as_text=True)
        for hidden in run_ids[1:]:
            assert client.get(f"/openapi/v1/apps/{app.id}/runs/{hidden}/events", headers=headers).status_code == 404
    edited = client.patch(
        f"{BASE}/{tokens[0]['id']}",
        json={
            "name": "first",
            "version": tokens[0]["version"],
            "resource_scope": {"mode": "none"},
            "workspace_scope": {"mode": "all"},
        },
    )
    assert edited.status_code == 200, edited.get_json()
    url = f"/openapi/v1/apps/{app.id}/runs/{run_ids[0]}/events"
    assert client.get(url, headers=headers_by_token[0]).status_code == 403
    assert client.get(url, headers=headers_by_token[1]).status_code == 200


def test_reconnect_and_stop_use_the_persisted_workflow_run(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import json
    from queue import Empty, Queue
    from unittest.mock import create_autospec

    from redis import Redis
    from redis.client import PubSub

    from extensions import ext_redis
    from extensions.ext_database import db
    from graphon.enums import WorkflowExecutionStatus
    from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
    from models.model import AppMode
    from models.workflow import WorkflowRun, WorkflowType

    with sqlite_session_factory() as session:
        engine = session.get_bind()
    monkeypatch.setattr(type(db), "engine", property(lambda _: engine))

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id, mode=AppMode.WORKFLOW)
    run_id, task_id = str(uuid4()), str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    current=True,
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                ),
                WorkflowRun(
                    id=run_id,
                    task_id=task_id,
                    tenant_id=workspace.id,
                    app_id=app.id,
                    workflow_id=str(uuid4()),
                    type=WorkflowType.WORKFLOW,
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                    version="1",
                    graph="{}",
                    inputs="{}",
                    status=WorkflowExecutionStatus.RUNNING,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=account.id,
                ),
            ]
        )
    messages: Queue[dict[str, object]] = Queue()
    messages.put(
        {
            "type": "message",
            "channel": f"channel:workflow:{run_id}".encode(),
            "data": json.dumps({"event": "workflow_finished", "task_id": task_id, "workflow_run_id": run_id}).encode(),
        }
    )

    def receive(**_kwargs: object) -> dict[str, object] | None:
        try:
            return messages.get(timeout=0.01)
        except Empty:
            return None

    pubsub = create_autospec(PubSub, instance=True)
    pubsub.get_message.side_effect = receive
    network_client = create_autospec(Redis, instance=True)
    network_client.pubsub.return_value = pubsub
    monkeypatch.setattr(ext_redis, "_pubsub_redis_client", network_client)
    apply_config_overrides(monkeypatch, PUBSUB_REDIS_CHANNEL_TYPE="pubsub")
    values: dict[str, bytes] = {}

    def command(name: str, *args: object, **_kwargs: object) -> bytes | None:
        if name == "SETEX":
            values[str(args[0])] = str(args[2]).encode()
        return values.get(str(args[0])) if name == "GET" else None

    redis_transport[1].side_effect = command
    token = client.post(BASE, json={"name": "reconnect"}).get_json()
    secret = token["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    before = client.post(f"/openapi/v1/apps/{app.id}/runs/{task_id}:stop", headers=headers)
    assert before.status_code == 404
    stream = client.get(f"/openapi/v1/apps/{app.id}/runs/{run_id}/events", headers=headers)
    assert stream.status_code == 200
    assert task_id in stream.get_data(as_text=True)
    stopped = client.post(f"/openapi/v1/apps/{app.id}/runs/{run_id}:stop", headers=headers)
    assert stopped.status_code == 200, stopped.get_json()
    assert client.post(f"/openapi/v1/apps/{app.id}/runs/{uuid4()}:stop", headers=headers).status_code == 404


def test_pat_business_audit_attributes_success_and_denial_without_secrets(
    client: FlaskClient, caplog: pytest.LogCaptureFixture
) -> None:
    import logging

    caplog.set_level(logging.INFO, logger="controllers.openapi._audit")
    created = client.post(BASE, json={"name": "audit"}).get_json()
    secret = created["secret"]
    fingerprint = client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER]
    headers = {"Authorization": f"Bearer {secret}", CATALOG_HEADER: fingerprint}
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == 200
    headers[CATALOG_HEADER] = "stale"
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == 412
    records = [record for record in caplog.records if record.__dict__.get("event") == "pat.request.openapi"]
    assert len(records) == 2
    assert [record.__dict__["outcome"] for record in records] == ["succeeded", "denied"]
    assert [record.__dict__["http_status"] for record in records] == [200, 412]
    for record in records:
        assert record.__dict__["token_id"] == created["id"]
        assert record.__dict__["account_id"] == client.application.config["TEST_BROWSER_ACCOUNT"].id
        assert record.__dict__["target_route"] == "/openapi/v1/workspaces"
        assert record.__dict__["operation"]
        assert secret not in str(record.__dict__)
        assert "Authorization" not in str(record.__dict__)


def test_pat_business_audit_includes_query_workspace_target(
    client: FlaskClient, caplog: pytest.LogCaptureFixture
) -> None:
    import logging

    caplog.set_level(logging.INFO, logger="controllers.openapi._audit")
    created = client.post(BASE, json={"name": "audit target"}).get_json()
    secret = created["secret"]
    fingerprint = client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER]
    headers = {"Authorization": f"Bearer {secret}", CATALOG_HEADER: fingerprint}
    workspace_id = str(uuid4())
    response = client.get("/openapi/v1/apps", query_string={"workspace_id": workspace_id}, headers=headers)
    assert response.status_code == 404
    records = [record for record in caplog.records if record.__dict__.get("event") == "pat.request.openapi"]
    assert len(records) == 1
    assert records[0].__dict__["target_ids"] == {"workspace_id": workspace_id}
    assert records[0].__dict__["http_status"] == response.status_code


def test_knowledge_configuration_survives_api_disable_and_retains_deleted_reference(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from models.dataset import Dataset
    from tests.helpers.unit.model_factories import make_dataset

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()), name="Knowledge workspace")
    dataset = make_dataset(
        dataset_id=str(uuid4()),
        tenant_id=workspace.id,
        name="Handbook",
        created_by=account.id,
        maintainer=account.id,
        enable_api=False,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                dataset,
                TenantAccountJoin(
                    current=True, tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.OWNER
                ),
            ]
        )
    candidates = client.get("/console/api/account/personal-access-token-resources").get_json()["data"]
    assert [(row["resource_type"], row["resource_id"]) for row in candidates] == [("dataset", dataset.id)]
    payload = {
        "name": "knowledge",
        "resource_scope": {"mode": "selected", "resources": [{"resource_type": "dataset", "resource_id": dataset.id}]},
        "workspace_scope": {"mode": "none"},
    }
    response = client.post(BASE, json=payload)
    assert response.status_code == 201, response.get_json()
    token = response.get_json()
    detail_url = f"{BASE}/{token['id']}"
    detail = client.get(detail_url).get_json()
    assert detail["token"]["status"] == "active"
    assert detail["resources"][0]["display_name"] == "Handbook"
    with sqlite_session_factory.begin() as session:
        session.execute(delete(Dataset).where(Dataset.id == dataset.id))
    detail = client.get(detail_url).get_json()
    assert detail["token"]["status"] == "access_issue"
    assert detail["resources"][0]["display_name"] == "Handbook"
    assert not detail["resources"][0]["available"]
    payload.pop("name")
    renamed = client.patch(detail_url, json={"name": "retained", "version": token["version"], **payload})
    assert renamed.status_code == 200, renamed.get_json()
    assert renamed.get_json()["resources"][0]["resource_id"] == dataset.id


def test_resource_types_with_the_same_id_have_independent_authorization(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from models.dataset import PermissionEnum
    from tests.helpers.unit.model_factories import make_dataset

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    private_workspace = make_tenant(tenant_id=str(uuid4()))
    resource_id = str(uuid4())
    app = make_app(app_id=resource_id, tenant_id=workspace.id, name="Visible app")
    dataset = make_dataset(
        dataset_id=resource_id,
        tenant_id=private_workspace.id,
        name="Private knowledge",
        created_by=str(uuid4()),
        permission=PermissionEnum.ONLY_ME,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                private_workspace,
                app,
                dataset,
                TenantAccountJoin(
                    current=True, tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.NORMAL
                ),
            ]
        )
    token = client.post(
        BASE,
        json={
            "name": "app",
            "resource_scope": {"mode": "selected", "resources": [{"resource_type": "app", "resource_id": resource_id}]},
        },
    ).get_json()
    response = client.patch(
        f"{BASE}/{token['id']}",
        json={
            "name": "must not gain knowledge",
            "version": token["version"],
            "resource_scope": {
                "mode": "selected",
                "resources": [{"resource_type": "dataset", "resource_id": resource_id}],
            },
            "workspace_scope": {"mode": "all"},
        },
    )
    assert response.status_code == 403, response.get_json()
    assert client.get(f"{BASE}/{token['id']}").get_json()["resources"][0]["resource_type"] == "app"


def test_knowledge_scope_does_not_authorize_an_app_with_the_same_id(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from tests.helpers.unit.model_factories import make_dataset

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    resource_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                make_app(app_id=resource_id, tenant_id=workspace.id),
                make_dataset(
                    dataset_id=resource_id, tenant_id=workspace.id, created_by=account.id, maintainer=account.id
                ),
                TenantAccountJoin(
                    current=True, tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.OWNER
                ),
            ]
        )
    response = client.post(
        BASE,
        json={
            "name": "knowledge only",
            "resource_scope": {
                "mode": "selected",
                "resources": [{"resource_type": "dataset", "resource_id": resource_id}],
            },
            "workspace_scope": {"mode": "none"},
        },
    )
    assert response.status_code == 201, response.get_json()
    secret = response.get_json()["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    assert client.post(f"/openapi/v1/apps/{resource_id}/chat:run", json={}, headers=headers).status_code == 403
    listed = client.get("/openapi/v1/apps", query_string={"workspace_id": workspace.id}, headers=headers)
    assert listed.status_code == 200, listed.get_json()
    assert listed.get_json()["data"] == []


def test_api_disabled_app_configuration_stays_active_but_does_not_admit_calls(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    app = make_app(app_id=str(uuid4()), tenant_id=workspace.id)
    app.enable_api = False
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                app,
                TenantAccountJoin(
                    current=True, tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.OWNER
                ),
            ]
        )
    response = client.post(
        BASE,
        json={
            "name": "future API",
            "resource_scope": {"mode": "selected", "resources": [{"resource_type": "app", "resource_id": app.id}]},
        },
    )
    assert response.status_code == 201, response.get_json()
    token = response.get_json()
    assert token["status"] == "active"
    secret = token["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    assert client.post(f"/openapi/v1/apps/{app.id}/chat:run", json={}, headers=headers).status_code == 403
    assert client.get(f"{BASE}/{token['id']}").get_json()["token"]["status"] == "active"


@pytest.fixture
def runner_catalog(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> RunnerCatalog:
    from services.enterprise.base import EnterpriseRequest

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()), name="Runner workspace")
    apps = [make_app(app_id=str(uuid4()), tenant_id=workspace.id, name=f"Runner {i}") for i in range(2)]
    environment_id = str(uuid4())
    deployment_ids = [str(uuid4()), str(uuid4())]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                *apps,
                TenantAccountJoin(
                    tenant_id=workspace.id,
                    account_id=account.id,
                    role=TenantAccountRole.NORMAL,
                    current=True,
                ),
            ]
        )
    responses: dict[str, dict[str, JsonValue] | Exception] = {
        app.id: {
            "environment_deployments": [
                {
                    "deployment_id": deployment_id,
                    "environment": {"id": environment_id, "display_name": "Production"},
                    "deployment": {"runtime_state": "STOPPED"},
                    "access": {"enable_api": False},
                }
            ]
        }
        for app, deployment_id in zip(apps, deployment_ids, strict=True)
    }
    calls: list[str] = []

    def send(method: str, endpoint: str, *, extra_headers: Mapping[str, str] | None = None) -> dict[str, JsonValue]:
        if endpoint == "/info":
            return {}
        assert method == "GET"
        assert endpoint.startswith("/console/api/enterprise/app-deploy/apps/")
        assert endpoint.endswith("/workflows/environment-deployments")
        assert extra_headers is not None
        assert extra_headers["Authorization"].startswith("Bearer ")
        assert extra_headers["X-CSRF-Token"]
        app_id = endpoint.split("/apps/")[1].split("/")[0]
        calls.append(app_id)
        response = responses[app_id]
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(EnterpriseRequest, "send_request", send)
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
    return workspace, apps, environment_id, deployment_ids, responses, calls


def _runner_payload(*ids: str) -> dict[str, JsonValue]:
    return {
        "name": "Runner grants",
        "resource_scope": {
            "mode": "selected",
            "resources": [{"resource_type": "app_deployment", "resource_id": id} for id in ids],
        },
        "workspace_scope": {"mode": "none"},
    }


def test_runner_uses_distinct_deployment_ids_and_ignores_runtime_and_api_switches(
    client: FlaskClient, runner_catalog: RunnerCatalog
) -> None:
    _, _, environment_id, ids, _, _ = runner_catalog
    candidates = client.get("/console/api/account/personal-access-token-resources")
    assert candidates.status_code == 200, candidates.get_json()
    runners = {
        runner["resource_id"]
        for app in candidates.get_json()["data"]
        if app["resource_type"] == "app"
        for runner in app["app_deployments"]
    }
    assert runners == set(ids)
    assert client.post(BASE, json=_runner_payload(environment_id)).status_code == 403
    created = client.post(BASE, json=_runner_payload(*ids))
    assert created.status_code == 201, created.get_json()
    detail = client.get(f"{BASE}/{created.get_json()['id']}").get_json()
    assert detail["token"]["status"] == "active"
    assert {r["resource_id"] for r in detail["resources"]} == set(ids)
    assert all(r["available"] for r in detail["resources"])


@pytest.mark.parametrize("missing", ["permission", "not_returned"])
def test_runner_revocation_retains_snapshot_and_cannot_be_readded(
    client: FlaskClient, runner_catalog: RunnerCatalog, missing: str
) -> None:
    from services.errors.enterprise import EnterpriseAPIForbiddenError

    _, apps, _, ids, responses, _ = runner_catalog
    created = client.post(BASE, json=_runner_payload(ids[0])).get_json()
    responses[apps[0].id] = (
        EnterpriseAPIForbiddenError() if missing == "permission" else {"environment_deployments": []}
    )
    detail = client.get(f"{BASE}/{created['id']}").get_json()
    assert detail["token"]["status"] == "access_issue"
    assert detail["resources"][0]["display_name"] == "Runner 0 / Production"
    edited = client.patch(f"{BASE}/{created['id']}", json={"name": "Keep reference", "version": 1})
    assert edited.status_code == 200, edited.get_json()
    assert client.post(BASE, json=_runner_payload(ids[0])).status_code == 403


def test_runner_workspace_switch_preserves_grant_without_access_issue(
    client: FlaskClient, runner_catalog: RunnerCatalog, sqlite_session_factory: sessionmaker[Session]
) -> None:
    from sqlalchemy import update

    _, _, _, ids, _, calls = runner_catalog
    created = client.post(BASE, json=_runner_payload(ids[0])).get_json()
    with sqlite_session_factory.begin() as session:
        session.execute(update(TenantAccountJoin).values(current=False))
    calls.clear()
    detail = client.get(f"{BASE}/{created['id']}").get_json()
    assert detail["token"]["status"] == "active"
    assert detail["token"]["unavailable_count"] == 0
    assert detail["resources"][0]["reason"] == "workspace_not_current"
    assert not calls
    assert client.post(BASE, json=_runner_payload(ids[0])).status_code == 403


@pytest.mark.parametrize("failure", ["outage", "old_contract"])
def test_runner_catalog_failure_is_not_reported_as_revocation(
    client: FlaskClient, runner_catalog: RunnerCatalog, failure: str
) -> None:
    from services.errors.enterprise import EnterpriseAPIError

    _, apps, _, ids, responses, _ = runner_catalog
    created = client.post(BASE, json=_runner_payload(ids[0])).get_json()
    responses[apps[0].id] = (
        EnterpriseAPIError("Unavailable", status_code=503)
        if failure == "outage"
        else {
            "environment_deployments": [{"environment": {"display_name": "Production"}}],
        }
    )
    assert client.get(f"{BASE}/{created['id']}").status_code == 503
    assert client.get("/console/api/account/personal-access-token-resources").status_code == 503


def test_runner_scope_does_not_authorize_an_app_with_the_same_id(
    client: FlaskClient, runner_catalog: RunnerCatalog
) -> None:
    _, apps, _, _, responses, _ = runner_catalog
    response = responses[apps[0].id]
    assert isinstance(response, dict)
    deployments = response["environment_deployments"]
    assert isinstance(deployments, list)
    deployment = deployments[0]
    assert isinstance(deployment, dict)
    deployment["deployment_id"] = apps[0].id
    created = client.post(BASE, json=_runner_payload(apps[0].id))
    assert created.status_code == 201, created.get_json()
    secret = created.get_json()["secret"]
    headers = {
        "Authorization": f"Bearer {secret}",
        CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER],
    }
    assert client.post(f"/openapi/v1/apps/{apps[0].id}/chat:run", json={}, headers=headers).status_code == 403


def test_runner_removed_reference_cannot_be_added_back_after_revocation(
    client: FlaskClient, runner_catalog: RunnerCatalog
) -> None:
    _, apps, _, ids, responses, _ = runner_catalog
    token = client.post(BASE, json=_runner_payload(ids[0])).get_json()
    responses[apps[0].id] = {"environment_deployments": []}
    removed = client.patch(
        f"{BASE}/{token['id']}",
        json={
            "name": "Removed",
            "version": 1,
            "resource_scope": {"mode": "none"},
            "workspace_scope": {"mode": "all"},
        },
    )
    assert removed.status_code == 200, removed.get_json()
    assert removed.get_json()["resources"] == []
    readd = client.patch(f"{BASE}/{token['id']}", json={**_runner_payload(ids[0]), "version": 2})
    assert readd.status_code == 403


def test_runner_list_translates_catalog_outage_to_service_unavailable(
    client: FlaskClient, runner_catalog: RunnerCatalog
) -> None:
    from services.errors.enterprise import EnterpriseAPIError

    _, apps, _, ids, responses, _ = runner_catalog
    assert client.post(BASE, json=_runner_payload(ids[0])).status_code == 201
    responses[apps[0].id] = EnterpriseAPIError("Unavailable", status_code=503)
    assert client.get(BASE).status_code == 503


def test_runner_failed_edit_preserves_name_scopes_and_version(
    client: FlaskClient, runner_catalog: RunnerCatalog
) -> None:
    from services.errors.enterprise import EnterpriseAPIError

    _, apps, _, ids, responses, _ = runner_catalog
    created = client.post(BASE, json=_runner_payload(ids[0])).get_json()
    available = responses[apps[0].id]
    responses[apps[0].id] = EnterpriseAPIError("Unavailable", status_code=503)
    draft = {
        **_runner_payload(ids[0]),
        "name": "Changed",
        "version": 1,
        "workspace_scope": {"mode": "all"},
    }
    changed = client.patch(f"{BASE}/{created['id']}", json=draft)
    assert changed.status_code == 503
    responses[apps[0].id] = available
    detail = client.get(f"{BASE}/{created['id']}").get_json()
    assert detail["token"]["name"] == created["name"]
    assert detail["token"]["version"] == 1
    assert detail["token"]["workspace_scope_mode"] == "none"
    assert [r["resource_id"] for r in detail["resources"]] == [ids[0]]
    retry = client.patch(f"{BASE}/{created['id']}", json=draft)
    assert retry.status_code == 200, retry.get_json()


def test_runner_create_uses_validated_catalog_without_a_post_commit_remote_read(
    client: FlaskClient, runner_catalog: RunnerCatalog, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.enterprise.base import EnterpriseRequest
    from services.errors.enterprise import EnterpriseAPIError

    _, apps, _, ids, responses, calls = runner_catalog
    send = EnterpriseRequest.send_request

    def fail_after_first_catalog(
        method: str, endpoint: str, *, extra_headers: Mapping[str, str] | None = None
    ) -> object:
        result = send(method, endpoint, extra_headers=extra_headers)
        if len(calls) == len(apps):
            responses[apps[0].id] = EnterpriseAPIError("Unavailable", status_code=503)
        return result

    monkeypatch.setattr(EnterpriseRequest, "send_request", fail_after_first_catalog)
    created = client.post(BASE, json=_runner_payload(ids[0]))
    assert created.status_code == 201, created.get_json()
    assert created.get_json()["resource_count"] == 1
    assert created.get_json()["status"] == "active"


@pytest.mark.parametrize("rbac_enabled", [True], indirect=True)
@pytest.mark.parametrize("resource_type", ["app", "dataset"])
@pytest.mark.parametrize("visibility", ["preview", "override", "own", "restricted", "run_only"])
def test_configuration_reuses_list_visibility_for_candidates_and_save(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    resource_type: str,
    visibility: str,
) -> None:
    from tests.helpers.unit.model_factories import make_dataset
    from tests.helpers.unit.rbac_fakes import build_rbac_domain

    domain = build_rbac_domain(sqlite_session_factory, monkeypatch)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    ids = [str(uuid4()), str(uuid4())]
    resources = [
        make_app(app_id=resource_id, tenant_id=workspace.id, maintainer=account.id if visibility == "own" else "other")
        if resource_type == "app"
        else make_dataset(
            dataset_id=resource_id, tenant_id=workspace.id, maintainer=account.id if visibility == "own" else "other"
        )
        for resource_id in ids
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                *resources,
                TenantAccountJoin(
                    current=True, tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.NORMAL
                ),
            ]
        )
    domain.transport.response = {"allowed": False}
    domain.transport.responses["/rbac/my-permissions"] = {
        "workspace": {
            "permission_keys": [f"{resource_type}.create_and_management"] if visibility in {"own", "restricted"} else []
        },
        resource_type: {
            "default_permission_keys": [f"{resource_type}.acl.preview"]
            if visibility in {"preview", "restricted"}
            else [],
            "overrides": [{"resource_id": ids[0], "permission_keys": [f"{resource_type}.acl.preview"]}]
            if visibility == "override"
            else [],
        },
    }
    domain.transport.responses[f"/rbac/{resource_type}s/whitelist/resources"] = {
        "unrestricted": visibility != "restricted",
        "resource_ids": [ids[0]] if visibility == "restricted" else [],
    }
    expected = (
        set(ids)
        if visibility in {"preview", "own"}
        else {ids[0]}
        if visibility in {"override", "restricted"}
        else set()
    )
    if visibility == "run_only":
        domain.transport.response = {"allowed": True}
    candidates = client.get("/console/api/account/personal-access-token-resources")
    assert candidates.status_code == 200, candidates.get_json()
    assert {r["resource_id"] for r in candidates.get_json()["data"]} == expected
    # Each existing list owns its RBAC query; PAT performs no per-resource CheckAccess.
    assert [r.endpoint for r in domain.transport.requests] == [
        "/rbac/my-permissions",
        "/rbac/apps/whitelist/resources",
        "/rbac/my-permissions",
        "/rbac/datasets/whitelist/resources",
    ]
    for resource_id in ids:
        response = client.post(
            BASE,
            json={
                "name": resource_id,
                "resource_scope": {
                    "mode": "selected",
                    "resources": [{"resource_type": resource_type, "resource_id": resource_id}],
                },
            },
        )
        assert response.status_code == (201 if resource_id in expected else 403), response.get_json()
        if resource_id in expected:
            token_id = response.get_json()["id"]
            assert client.get(f"{BASE}/{token_id}").get_json()["token"]["status"] == "active"

    for resource_id in set(ids) - expected:
        _assert_hidden_resource_cannot_be_added(client, resource_type, resource_id)


@pytest.mark.parametrize(
    "role", [TenantAccountRole.NORMAL, TenantAccountRole.OWNER, TenantAccountRole.DATASET_OPERATOR]
)
def test_knowledge_candidates_reuse_legacy_list_member_visibility(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], role: TenantAccountRole
) -> None:
    from models.dataset import DatasetPermission, PermissionEnum
    from tests.helpers.unit.model_factories import make_dataset

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    ids = [str(uuid4()) for _ in range(5)]
    datasets = [
        make_dataset(dataset_id=resource_id, tenant_id=workspace.id, permission=permission, maintainer=maintainer)
        for resource_id, permission, maintainer in zip(
            ids,
            [
                PermissionEnum.ALL_TEAM,
                PermissionEnum.ONLY_ME,
                PermissionEnum.ONLY_ME,
                PermissionEnum.PARTIAL_TEAM,
                PermissionEnum.PARTIAL_TEAM,
            ],
            [account.id, account.id, str(uuid4()), str(uuid4()), account.id],
            strict=True,
        )
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                *datasets,
                TenantAccountJoin(current=True, tenant_id=workspace.id, account_id=account.id, role=role),
                DatasetPermission(tenant_id=workspace.id, dataset_id=ids[3], account_id=account.id),
            ]
        )
    response = client.get("/console/api/account/personal-access-token-resources")
    expected = {ids[3]} if role == TenantAccountRole.DATASET_OPERATOR else set(ids[:2] + [ids[3]])
    assert {r["resource_id"] for r in response.get_json()["data"]} == expected
    for resource_id in set(ids) - expected:
        _assert_hidden_resource_cannot_be_added(client, "dataset", resource_id)


@pytest.mark.parametrize("kind", ["app", "dataset"])
def test_configuration_lists_and_selected_references_continue_past_first_source_page(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], kind: str
) -> None:
    from tests.helpers.unit.model_factories import make_dataset

    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    workspace = make_tenant(tenant_id=str(uuid4()))
    ids = [str(uuid4()) for _ in range(105)]
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                workspace,
                TenantAccountJoin(
                    current=True, tenant_id=workspace.id, account_id=account.id, role=TenantAccountRole.OWNER
                ),
                *[
                    make_app(
                        app_id=resource_id, tenant_id=workspace.id, name=f"item-{index:03d}", maintainer=account.id
                    )
                    if kind == "app"
                    else make_dataset(
                        dataset_id=resource_id,
                        tenant_id=workspace.id,
                        name=f"item-{index:03d}",
                        maintainer=account.id,
                    )
                    for index, resource_id in enumerate(ids)
                ],
            ]
        )
    endpoint = "/console/api/account/personal-access-token-resources"
    first = client.get(endpoint, query_string={"limit": 100}).get_json()
    assert [r["resource_id"] for r in first["data"]] == ids[:100]
    second = client.get(endpoint, query_string={"limit": 100, "cursor": first["next_cursor"]}).get_json()
    assert [r["resource_id"] for r in second["data"]] == ids[100:]
    assert not second["has_more"]
    created = client.post(
        BASE,
        json={
            "name": "all selections",
            "resource_scope": {
                "mode": "selected",
                "resources": [{"resource_type": kind, "resource_id": value} for value in ids],
            },
        },
    )
    assert created.status_code == 201, created.get_json()
    details = client.get(f"{BASE}/{created.get_json()['id']}").get_json()
    assert details["token"]["status"] == "active"
    assert len(details["resources"]) == 105
    assert all(r["available"] for r in details["resources"])


def test_mixed_app_dataset_and_runner_selections_are_saved_and_edited_independently(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session], runner_catalog: RunnerCatalog
) -> None:
    from tests.helpers.unit.model_factories import make_dataset

    workspace, apps, _, deployment_ids, _, _ = runner_catalog
    account = client.application.config["TEST_BROWSER_ACCOUNT"]
    # App and knowledge IDs may coincide; the type remains part of the selection identity.
    with sqlite_session_factory.begin() as session:
        session.add(
            make_dataset(
                dataset_id=apps[0].id,
                tenant_id=workspace.id,
                name="Handbook",
                maintainer=account.id,
            )
        )
    selections = [
        {"resource_type": "app", "resource_id": apps[0].id},
        {"resource_type": "dataset", "resource_id": apps[0].id},
        {"resource_type": "app_deployment", "resource_id": deployment_ids[0]},
    ]
    created = client.post(
        BASE,
        json={
            "name": "Mixed resources",
            "resource_scope": {"mode": "selected", "resources": selections},
            "workspace_scope": {"mode": "none"},
        },
    )
    assert created.status_code == 201, created.get_json()
    token = created.get_json()
    assert token["resource_count"] == 3
    detail_url = f"{BASE}/{token['id']}"
    detail = client.get(detail_url).get_json()
    assert detail["token"]["status"] == "active"
    assert {(row["resource_type"], row["resource_id"]) for row in detail["resources"]} == {
        (row["resource_type"], row["resource_id"]) for row in selections
    }
    edited = client.patch(
        detail_url,
        json={
            "name": "Keep knowledge and runner",
            "version": token["version"],
            "resource_scope": {"mode": "selected", "resources": selections[1:]},
            "workspace_scope": {"mode": "none"},
        },
    )
    assert edited.status_code == 200, edited.get_json()
    reloaded = client.get(detail_url).get_json()
    assert reloaded["token"]["resource_count"] == 2
    assert reloaded["token"]["status"] == "active"
    assert {(row["resource_type"], row["resource_id"]) for row in reloaded["resources"]} == {
        (row["resource_type"], row["resource_id"]) for row in selections[1:]
    }


def _assert_hidden_resource_cannot_be_added(client: FlaskClient, resource_type: str, resource_id: str) -> None:
    """A hidden candidate must not create a snapshot or mutate an existing PAT."""
    token = client.post(BASE, json={"name": "unchanged"}).get_json()
    token_url = f"{BASE}/{token['id']}"
    original = client.get(token_url).get_json()
    count = client.get(BASE).get_json()["total"]
    scope = {"mode": "selected", "resources": [{"resource_type": resource_type, "resource_id": resource_id}]}
    created = client.post(BASE, json={"name": "forbidden", "resource_scope": scope})
    assert created.status_code == 403, created.get_json()
    assert client.get(BASE).get_json()["total"] == count
    updated = client.patch(
        token_url,
        json={
            "name": "forbidden",
            "version": token["version"],
            "resource_scope": scope,
            "workspace_scope": {"mode": "all"},
        },
    )
    assert updated.status_code == 403, updated.get_json()
    assert client.get(token_url).get_json() == original


@pytest.mark.parametrize(
    "attack", ["unkeyed_digest", "reassign_account", "copy_verifier", "wrong_secret", "rotate_key", "missing_key"]
)
def test_pat_hmac_rejects_forgery_and_account_reassignment(
    client: FlaskClient,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    attack: str,
) -> None:
    import hashlib

    from models.personal_access_token import PersonalAccessToken

    token = client.post(BASE, json={"name": "protected"}).get_json()
    secret = token["secret"]
    headers = {CATALOG_HEADER: client.get("/openapi/v1/_catalog").headers[CATALOG_HEADER]}
    with sqlite_session_factory.begin() as session:
        stored = session.get(PersonalAccessToken, token["id"])
        assert stored is not None
        if attack in {"unkeyed_digest", "wrong_secret"}:
            secret = secret[:-43] + "A" * 43
            if attack == "unkeyed_digest":
                stored.secret_digest = hashlib.sha256(secret.encode()).hexdigest()
        elif attack == "reassign_account":
            victim = make_account(account_id=str(uuid4()), tenant=None)
            session.add(victim)
            stored.account_id = victim.id
        elif attack == "copy_verifier":
            new_id = str(uuid4())
            stored.id = new_id
            secret = f"dpat_{new_id.replace('-', '')}_{secret[-43:]}"
            token["id"] = new_id
    if attack == "rotate_key":
        apply_config_overrides(monkeypatch, SECRET_KEY="different-server-key")
    elif attack == "missing_key":
        apply_config_overrides(monkeypatch, SECRET_KEY="")
    headers["Authorization"] = f"Bearer {secret}"
    assert client.get("/openapi/v1/workspaces", headers=headers).status_code == (
        503 if attack == "missing_key" else 401
    )
    with sqlite_session_factory() as session:
        stored = session.get(PersonalAccessToken, token["id"])
        assert stored is not None
        assert stored.last_used_at is None
