"""HTTP authorization for Human Input Contact management and editor options."""

from typing import Never

import pytest
from flask import Flask, g
from flask.testing import FlaskClient
from flask_login import LoginManager
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from controllers.console import bp as console_bp
from controllers.console.human_input_v2 import contact as controller
from enums import DeploymentEdition
from models.account import Account, AccountStatus, Tenant, TenantAccountRole
from models.human_input_v2 import HumanInputExternalContactProfile

_BASE_URL = "/console/api/workspaces/current/human-input/v2"
_CONTACT_ID = "00000000-0000-0000-0000-000000000123"
_MANAGEMENT_REQUESTS = (
    ("GET", "/contacts"),
    ("GET", f"/contacts/{_CONTACT_ID}"),
    ("GET", f"/contacts/batch?contact_ids={_CONTACT_ID}"),
    ("GET", "/organization-candidates"),
    ("POST", "/contacts/platform"),
    ("POST", "/contacts/external"),
    ("PATCH", f"/contacts/external/{_CONTACT_ID}"),
    ("POST", "/contacts/remove"),
    ("POST", "/im-sync-runs"),
    ("GET", "/im-sync-runs/latest"),
    ("GET", "/im-sync-runs/latest/results"),
    ("GET", "/im-identities"),
    ("PUT", f"/contacts/{_CONTACT_ID}/im-override"),
    ("DELETE", f"/contacts/{_CONTACT_ID}/im-override"),
    ("PUT", f"/contacts/{_CONTACT_ID}/im-bindings"),
    ("DELETE", f"/contacts/{_CONTACT_ID}/im-bindings"),
)


@pytest.fixture
def current_account(sqlite_session_factory: sessionmaker[Session]) -> Account:
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Contact authorization test")
        session.add(tenant)

    account = Account(name="Reviewer", email="reviewer@example.com", status=AccountStatus.ACTIVE)
    account.role = TenantAccountRole.OWNER
    account._current_tenant = tenant
    return account


@pytest.fixture(params=[False, True], ids=["legacy-roles", "rbac"])
def client(current_account: Account, request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> FlaskClient:
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", request.param)

    app = Flask(__name__)
    LoginManager().init_app(app)
    app.register_blueprint(console_bp)

    @app.before_request
    def authenticate() -> None:
        g._login_user = current_account

    return app.test_client()


@pytest.mark.parametrize(
    "role", [TenantAccountRole.EDITOR, TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR]
)
@pytest.mark.parametrize(("method", "path"), _MANAGEMENT_REQUESTS)
def test_management_rejects_non_administrators_before_business_work(
    client: FlaskClient,
    current_account: Account,
    monkeypatch: pytest.MonkeyPatch,
    role: TenantAccountRole,
    method: str,
    path: str,
) -> None:
    current_account.role = role

    def reject_business_work(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("Unauthorized requests must not enter Contact management")

    monkeypatch.setattr(controller, "_contact_service", reject_business_work)
    monkeypatch.setattr(controller, "build_enterprise_contact_management_service", reject_business_work)
    monkeypatch.setattr(controller, "build_im_contact_sync_application", reject_business_work)

    response = client.open(f"{_BASE_URL}{path}", method=method, json={})

    assert response.status_code == 403, response.get_json()


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN])
def test_administrators_can_read_create_edit_and_remove_contacts(
    client: FlaskClient,
    current_account: Account,
    sqlite_session_factory: sessionmaker[Session],
    role: TenantAccountRole,
) -> None:
    current_account.role = role

    created = client.post(f"{_BASE_URL}/contacts/external", json={"name": "Reviewer", "email": "contact@example.com"})
    assert created.status_code == 200
    contact_id = created.get_json()["contact"]["id"]

    listed = client.get(f"{_BASE_URL}/contacts")
    assert listed.status_code == 200
    assert [contact["id"] for contact in listed.get_json()["data"]] == [contact_id]

    details = client.get(f"{_BASE_URL}/contacts/{contact_id}")
    assert details.status_code == 200
    assert details.get_json()["contact"]["id"] == contact_id

    edited = client.patch(f"{_BASE_URL}/contacts/external/{contact_id}", json={"name": "Updated reviewer"})
    assert edited.status_code == 200
    assert edited.get_json()["contact"]["name"] == "Updated reviewer"
    with sqlite_session_factory() as session:
        stored = session.scalar(
            select(HumanInputExternalContactProfile).where(HumanInputExternalContactProfile.contact_id == contact_id)
        )
        assert stored is not None
        assert stored.name == "Updated reviewer"

    removed = client.post(f"{_BASE_URL}/contacts/remove", json={"contact_ids": [contact_id]})
    assert removed.status_code == 200
    assert removed.get_json()["removed_contact_ids"] == [contact_id]
    with sqlite_session_factory() as session:
        assert session.scalar(select(HumanInputExternalContactProfile)) is None


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
def test_editing_roles_can_select_contacts(
    client: FlaskClient, current_account: Account, role: TenantAccountRole
) -> None:
    created = client.post(f"{_BASE_URL}/contacts/external", json={"name": "Reviewer", "email": "contact@example.com"})
    assert created.status_code == 200
    contact_id = created.get_json()["contact"]["id"]
    current_account.role = role

    options = client.get(f"{_BASE_URL}/contact-options")
    assert options.status_code == 200
    assert options.get_json()["data"] == [
        {"id": contact_id, "type": "external", "name": "Reviewer", "email": "contact@example.com", "avatar_url": None}
    ]

    resolved = client.get(f"{_BASE_URL}/contact-options/batch", query_string={"contact_ids": contact_id})
    assert resolved.status_code == 200
    assert resolved.get_json()["data"] == options.get_json()["data"]
    if role == TenantAccountRole.EDITOR:
        assert client.get(f"{_BASE_URL}/contacts").status_code == 403


@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
@pytest.mark.parametrize("path", ["/contact-options", f"/contact-options/batch?contact_ids={_CONTACT_ID}"])
def test_contact_options_reject_non_editing_roles_before_query(
    client: FlaskClient,
    current_account: Account,
    monkeypatch: pytest.MonkeyPatch,
    role: TenantAccountRole,
    path: str,
) -> None:
    current_account.role = role

    def reject_contact_query(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("Unauthorized requests must not query Contact options")

    monkeypatch.setattr(controller, "_contact_service", reject_contact_query)

    response = client.get(f"{_BASE_URL}{path}")

    assert response.status_code == 403, response.get_json()
