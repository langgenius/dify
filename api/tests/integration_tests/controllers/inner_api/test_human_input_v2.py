"""Deployment HTTP, Redis/Celery and PostgreSQL contracts on dedicated middleware.

Set HITL_INNER_TEST_ENVIRONMENT to opt in to fixture cleanup, then run with
the shared middleware fixtures and a migrated, isolated database:
pytest -p tests.e2e_tests.middleware.conftest <this module>
Only the external IM provider's credential/directory responses are isolated.
"""

import os
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from threading import Thread
from time import monotonic, sleep
from uuid import uuid4

import httpx
import pytest
import sqlalchemy as sa
from celery import Celery
from celery.contrib.testing.worker import start_worker
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.serving import make_server

from configs import dify_config
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.entities import (
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    ProviderUserId,
)
from core.human_input_v2.im_integration.adapters.feishu_lark import FeishuIMProviderAdapter
from core.human_input_v2.shared import AccountId, ContactId
from extensions.ext_database import db
from extensions.ext_storage import storage
from libs.credential_cipher import CredentialKeyUnavailableError
from libs.key_providers.deployment_local import LocalDeploymentKeyBackend
from models.account import Account, AccountStatus
from models.human_input_v2 import (
    HumanInputContactIdentity,
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from models.model import DifySetup
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from services.deployment_credential_composition import build_deployment_credential_service

_BASE = "/inner/api/enterprise/human-input/v2"
_CREDENTIALS = {
    "provider": "feishu",
    "app_id": "integration-app",
    "app_secret": "integration-only-secret",
    "verification_token": None,
    "encrypt_key": None,
}
_UNCHANGED = {
    "provider": "feishu",
    **{
        field: {"type": "unchanged"}
        for field in (
            "app_id",
            "app_secret",
            "verification_token",
            "encrypt_key",
        )
    },
}


@dataclass(frozen=True)
class _Deployment:
    app: Flask
    sessions: sessionmaker[Session]
    instance_id: str
    contact_id: ContactId
    email: str


@pytest.fixture
def deployment(flask_app: Flask, flask_req_ctx: object) -> Generator[_Deployment]:
    """Seed only this test's deployment; schema initialization belongs to the middleware runner."""
    assert os.environ.get("HITL_INNER_TEST_ENVIRONMENT"), "Dedicated middleware must be explicitly selected"
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    assert db.engine.dialect.name == "postgresql"
    instance_id = str(uuid4())
    email = f"inner-{instance_id}@example.com"
    with sessions.begin() as session:
        assert session.scalar(sa.select(DifySetup)) is None
        assert session.scalar(sa.select(HumanInputIMChannel)) is None
        session.add(DifySetup(version="inner-integration-test", instance_id=instance_id))
        account = Account(name="Integration Contact", email=email, status=AccountStatus.ACTIVE)
        account.created_at = datetime(2020, 1, 1)
        session.add(account)
        session.flush()
        contact_id = SQLAlchemyContactRepository(session).provision_account_backed_contact(AccountId(account.id))
        account_id = account.id
    try:
        yield _Deployment(flask_app, sessions, instance_id, contact_id, email)
    finally:
        with sessions.begin() as session:
            for model in (
                HumanInputIMReconciliationChange,
                HumanInputIMSyncResult,
                HumanInputIMBindingWorkspaceOverride,
                HumanInputIMBinding,
                HumanInputIMIdentity,
                HumanInputIMSyncRun,
                HumanInputIMChannel,
            ):
                session.execute(sa.delete(model))
            session.execute(sa.delete(HumanInputContactIdentity).where(HumanInputContactIdentity.id == str(contact_id)))
            session.execute(sa.delete(Account).where(Account.id == account_id))
            session.execute(sa.delete(DifySetup).where(DifySetup.instance_id == instance_id))
        path = f"privkeys/deployments/{instance_id}/private.pem"
        if storage.exists(path):
            storage.delete(path)


@pytest.fixture
def client(deployment: _Deployment, monkeypatch: pytest.MonkeyPatch) -> Generator[httpx.Client]:
    """Serve the real Flask application on loopback; authenticate through the production inner guard."""
    inner_key = "isolated-inner-integration-key"
    monkeypatch.setattr(dify_config, "INNER_API", True)
    monkeypatch.setattr(dify_config, "INNER_API_KEY", inner_key)
    server = make_server("127.0.0.1", 0, deployment.app, threaded=True)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with httpx.Client(
            base_url=f"http://127.0.0.1:{server.server_port}",
            headers={"X-Inner-Api-Key": inner_key},
            timeout=20,
        ) as connection:
            yield connection
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


class _Directory:
    def __init__(self, email: str) -> None:
        self._email = email

    def read_directory(self) -> Directory:
        return Directory((DirectoryEntry(ProviderUserId("integration-user"), "Provider Contact", self._email),))


def test_real_http_and_redis_worker_complete_the_deployment_lifecycle(
    deployment: _Deployment,
    client: httpx.Client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    build_deployment_credential_service().provision()
    monkeypatch.setattr(
        FeishuIMProviderAdapter,
        "test_credentials",
        lambda _: CredentialTestSuccess(IMProvider.FEISHU, "integration-organization"),
    )
    monkeypatch.setattr(FeishuIMProviderAdapter, "directory", property(lambda _: _Directory(deployment.email)))
    assert len(client.get(f"{_BASE}/channel-providers").json()["im_providers"]) == 6
    assert client.get(f"{_BASE}/channels").json() == {"channels": []}
    assert client.post(f"{_BASE}/channels:test", json={"credentials": _CREDENTIALS}).json()["status"] == "connected"
    created = client.post(f"{_BASE}/channels", json={"credentials": _CREDENTIALS})
    assert created.status_code == 200, created.text
    summary = created.json()["summary"]
    channel_id = summary["id"]
    detail = client.get(f"{_BASE}/channels/{channel_id}")
    assert detail.status_code == 200
    assert "integration-only-secret" not in detail.text
    edit = {"expected_config_version": summary["config_version"], "credentials": _UNCHANGED}
    assert client.post(f"{_BASE}/channels/{channel_id}:test", json=edit).status_code == 200
    updated = client.patch(f"{_BASE}/channels/{channel_id}", json=edit)
    assert updated.status_code == 200, updated.text
    assert client.patch(f"{_BASE}/channels/{channel_id}", json=edit).status_code == 409
    first_actor, second_actor = str(uuid4()), str(uuid4())
    first = client.post(f"{_BASE}/sync-runs", json={"started_by_sys_user_id": first_actor})
    second = client.post(f"{_BASE}/sync-runs", json={"started_by_sys_user_id": second_actor})
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert second.json()["run"]["started_by_sys_user_id"] == first_actor
    celery = deployment.app.extensions["celery"]
    assert isinstance(celery, Celery)
    with start_worker(
        celery,
        concurrency=1,
        pool="solo",
        queues=["human_input_contact_sync"],
        perform_ping_check=False,
        loglevel="WARNING",
        shutdown_timeout=20,
    ):
        deadline = monotonic() + 30
        latest = client.get(f"{_BASE}/sync-runs/latest")
        while latest.json()["run"]["status"] in ("queued", "running") and monotonic() < deadline:
            sleep(0.1)
            latest = client.get(f"{_BASE}/sync-runs/latest")
        assert latest.json()["run"]["status"] == "succeeded", latest.text
    results = client.get(f"{_BASE}/sync-runs/latest/records", params={"result": "added"})
    assert results.status_code == 200
    assert results.json()["total"] == 1
    assert results.json()["data"][0]["result"]["contact"]["email"] == deployment.email
    contacts = client.get(f"{_BASE}/contacts").json()
    assert contacts["data"][0]["joined_at"] == 1577836800
    identities = client.get(f"{_BASE}/identities").json()
    identity_id = identities["data"][0]["id"]
    bound = client.put(f"{_BASE}/contacts/{deployment.contact_id}/bindings", json={"identity_id": identity_id})
    assert bound.status_code == 200
    binding_id = bound.json()["contact"]["im_bindings"][0]["id"]
    assert client.get(f"{_BASE}/contacts/{deployment.contact_id}").json()["im_binding_details"][0]["id"] == binding_id
    deleted = client.delete(f"{_BASE}/contacts/{deployment.contact_id}/bindings")
    assert deleted.status_code == 200
    assert deleted.json() == {"binding_id": binding_id}
    replacement = client.post(
        f"{_BASE}/channels/{channel_id}:replace",
        json={
            "credentials": _CREDENTIALS,
            "expected_config_version": updated.json()["summary"]["config_version"],
        },
    )
    assert replacement.status_code == 200, replacement.text
    summary = replacement.json()["summary"]
    assert client.get(f"{_BASE}/channels/{channel_id}").status_code == 404
    assert client.get(f"{_BASE}/identities").json()["total"] == 0
    assert (
        client.delete(
            f"{_BASE}/channels/{summary['id']}", params={"expected_config_version": summary["config_version"]}
        ).status_code
        == 200
    )


def test_concurrent_provisioning_uses_the_real_redis_lease(deployment: _Deployment) -> None:
    def provision(_index: int) -> str:
        with deployment.app.app_context():
            return build_deployment_credential_service().provision()

    with ThreadPoolExecutor(max_workers=4) as executor:
        references = list(executor.map(provision, range(8)))
    assert len(set(references)) == 1
    cipher = build_deployment_credential_service().build_cipher()
    assert cipher.decrypt(cipher.encrypt("deployment credential")) == "deployment credential"


def test_partial_creation_recovers_and_missing_material_never_replaces_the_key(deployment: _Deployment) -> None:
    backend = LocalDeploymentKeyBackend(storage)
    reference = backend.provision(deployment.instance_id, None)
    path = f"privkeys/deployments/{deployment.instance_id}/private.pem"
    material = storage.load_once(path)
    service = build_deployment_credential_service()
    with pytest.raises(CredentialKeyUnavailableError):
        service.build_cipher()
    assert service.provision() == reference
    assert storage.load_once(path) == material
    storage.delete(path)
    with pytest.raises(CredentialKeyUnavailableError):
        service.build_cipher()
    with pytest.raises(CredentialKeyUnavailableError):
        service.provision()
    assert not storage.exists(path)


def test_inner_admission_rejects_untrusted_requests(client: httpx.Client, monkeypatch: pytest.MonkeyPatch) -> None:
    assert client.get(f"{_BASE}/channels", headers={"X-Inner-Api-Key": "wrong"}).status_code == 401
    monkeypatch.setattr(dify_config, "INNER_API", False)
    assert client.get(f"{_BASE}/channels").status_code == 404
