"""HTTP behavior of Contact writes using real services and SQLite persistence."""

import pytest
from flask import Flask, g
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from controllers.console.workspace.human_input import (
    WorkspaceContactsRemoveApi,
    WorkspaceExternalContactApi,
    WorkspaceExternalContactsApi,
)
from enums import DeploymentEdition
from libs.external_api import ExternalApi
from models.account import Account, AccountStatus, Tenant, TenantAccountRole
from models.human_input_v2 import HumanInputExternalContactProfile

_CONTACTS_URL = "/console/api/workspaces/current/human-input/contacts"
_TENANT_ID = "00000000-0000-0000-0000-000000000101"


@pytest.fixture
def client(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> FlaskClient:
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Contact transaction test")
        tenant.id = _TENANT_ID
        session.add(tenant)

    account = Account(name="Owner", email="owner@example.com", status=AccountStatus.ACTIVE)
    account.role = TenantAccountRole.OWNER
    account._current_tenant = tenant
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", False)

    app = Flask(__name__)
    api = ExternalApi(app)
    api.add_resource(WorkspaceExternalContactsApi, f"{_CONTACTS_URL}/external")
    api.add_resource(WorkspaceExternalContactApi, f"{_CONTACTS_URL}/external/<uuid:contact_id>")
    api.add_resource(WorkspaceContactsRemoveApi, f"{_CONTACTS_URL}/remove")

    @app.before_request
    def authenticate_owner() -> None:
        # Supply request identity; keep controller, service, repository and transaction handling real.
        g._login_user = account

    return app.test_client()


def test_external_contact_create_edit_and_remove(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    created = client.post(f"{_CONTACTS_URL}/external", json={"name": "Original name", "email": "contact@example.com"})
    assert created.status_code == 200
    contact_id = created.get_json()["contact"]["id"]

    edited = client.patch(f"{_CONTACTS_URL}/external/{contact_id}", json={"name": "Updated name"})
    assert edited.status_code == 200
    assert edited.get_json()["contact"]["name"] == "Updated name"
    assert edited.get_json()["contact"]["email"] == "contact@example.com"
    with sqlite_session_factory() as session:
        stored = session.scalar(
            select(HumanInputExternalContactProfile).where(HumanInputExternalContactProfile.contact_id == contact_id)
        )
        assert stored is not None
        assert (stored.name, stored.email) == ("Updated name", "contact@example.com")

    removed = client.post(f"{_CONTACTS_URL}/remove", json={"contact_ids": [contact_id]})
    assert removed.status_code == 200
    assert removed.get_json()["removed_contact_ids"] == [contact_id]
    with sqlite_session_factory() as session:
        assert session.scalar(select(HumanInputExternalContactProfile)) is None


def test_conflicting_email_returns_409_without_changing_contact(
    client: FlaskClient, sqlite_session_factory: sessionmaker[Session]
) -> None:
    for name, email in (("Original name", "contact@example.com"), ("Other contact", "other@example.com")):
        response = client.post(f"{_CONTACTS_URL}/external", json={"name": name, "email": email})
        assert response.status_code == 200

    with sqlite_session_factory() as session:
        contact_id = session.scalar(
            select(HumanInputExternalContactProfile.contact_id).where(
                HumanInputExternalContactProfile.email == "contact@example.com"
            )
        )

    response = client.patch(
        f"{_CONTACTS_URL}/external/{contact_id}",
        json={"name": "Must roll back", "email": "other@example.com"},
    )
    assert response.status_code == 409
    with sqlite_session_factory() as session:
        stored = session.scalar(
            select(HumanInputExternalContactProfile).where(HumanInputExternalContactProfile.contact_id == contact_id)
        )
        assert stored is not None
        assert (stored.name, stored.email) == ("Original name", "contact@example.com")
