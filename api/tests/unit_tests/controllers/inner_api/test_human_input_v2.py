"""Real HTTP -> service -> repository contracts; external providers and dispatch are isolated."""

from datetime import datetime
from unittest.mock import MagicMock

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from configs.deploy import IMEventTransportMode
from controllers.inner_api import api, bp
from controllers.inner_api.human_input_v2 import contact, im_channel, im_sync
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.entities import CredentialTestSuccess
from core.human_input_v2.shared import AccountId, ContactId, IMIdentityId, IMSyncRunId
from libs.credential_cipher import CredentialKeyUnavailableError
from libs.key_providers.deployment_local import LocalDeploymentKeyBackend
from models.account import Account, AccountStatus
from models.human_input_v2 import HumanInputContactIdentity, HumanInputIMChannel
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.human_input_v2.im_identity_repository import IMIdentityObservation, OpaqueProviderPayload
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import DeploymentIMChannelReader
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.human_input_v2 import im_channel_service as channel_service
from services.human_input_v2.im_channel_service import DeploymentIMChannelService
from services.human_input_v2.im_contact_sync.service import IMSyncService

_BASE = "/inner/api/enterprise/human-input/v2"
_HEADERS = {"X-Inner-Api-Key": "test-inner-key"}
_CREDENTIALS = {
    "provider": "feishu",
    "app_id": "app-1",
    "app_secret": "secret-must-never-escape",
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


class _Storage:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def load_once(self, filename: str) -> bytes:
        if filename not in self.files:
            raise FileNotFoundError
        return self.files[filename]

    def save_if_absent(self, filename: str, data: bytes) -> bool:
        if filename in self.files:
            return False
        self.files[filename] = data
        return True


@pytest.fixture(scope="module")
def inner_app() -> Flask:
    application = Flask(__name__)
    application.config.update(TESTING=False, RESTX_ERROR_404_HELP=False)
    application.register_blueprint(bp)
    return application


@pytest.fixture
def api_context(inner_app, sqlite_session_factory, monkeypatch):
    monkeypatch.setattr(dify_config, "INNER_API", True)
    monkeypatch.setattr(dify_config, "INNER_API_KEY", "test-inner-key")
    backend = LocalDeploymentKeyBackend(_Storage())
    cipher = backend.bind("test-deployment", backend.provision("test-deployment", None))
    service = DeploymentIMChannelService(sqlite_session_factory, cipher, IMEventTransportMode.WEBHOOK)
    monkeypatch.setattr(im_channel, "build_deployment_im_channel_service", lambda: service)
    adapter = MagicMock()
    adapter.test_credentials.return_value = CredentialTestSuccess(IMProvider.FEISHU, "company-1")
    monkeypatch.setattr(channel_service, "build_im_provider_adapter", lambda _: adapter)
    dispatched = []
    sync = IMSyncService(
        sqlite_session_factory,
        lambda session, _: DeploymentIMChannelReader(session).get(),
        lambda run_id, scope: dispatched.append((run_id, scope)),
        account_query=SQLAlchemyAccountRepository(sqlite_session_factory),
    )
    monkeypatch.setattr(im_sync, "build_im_sync_service", lambda: sync)
    monkeypatch.setattr(contact, "build_im_sync_service", lambda: sync)
    return inner_app.test_client(), sqlite_session_factory, dispatched


def _create(client):
    response = client.post(f"{_BASE}/channels", headers=_HEADERS, json={"credentials": _CREDENTIALS})
    assert response.status_code == 200, response.json
    return response.json["summary"]


def test_channel_http_lifecycle_and_cas(api_context) -> None:
    client, sessions, dispatched = api_context
    assert len(client.get(f"{_BASE}/channel-providers", headers=_HEADERS).json["im_providers"]) == 6
    assert client.get(f"{_BASE}/channels", headers=_HEADERS).json == {"channels": []}
    created = _create(client)
    channel_id = created["id"]
    detail = client.get(f"{_BASE}/channels/{channel_id}", headers=_HEADERS)
    assert detail.status_code == 200
    assert detail.json["credentials"]["app_secret"] == {"type": "redacted"}
    assert "secret-must-never-escape" not in detail.text
    with sessions() as session:
        row = session.scalar(select(HumanInputIMChannel))
        assert row is not None
        assert "secret-must-never-escape" not in str(row.encrypted_credentials)
        assert row.configured_by_account_id is None
    duplicate = client.post(f"{_BASE}/channels", headers=_HEADERS, json={"credentials": _CREDENTIALS})
    assert duplicate.status_code == 409
    assert duplicate.json["code"] == "conflict"
    edit = {"credentials": _UNCHANGED, "expected_config_version": created["config_version"]}
    tested = client.post(f"{_BASE}/channels/{channel_id}:test", headers=_HEADERS, json=edit)
    assert tested.status_code == 200
    assert tested.json["status"] == "connected"
    assert client.get(f"{_BASE}/channels/{channel_id}", headers=_HEADERS).json["summary"] == created
    updated = client.patch(f"{_BASE}/channels/{channel_id}", headers=_HEADERS, json=edit)
    assert updated.status_code == 200
    assert updated.json["summary"]["id"] == channel_id
    assert updated.json["summary"]["config_version"] != created["config_version"]
    stale = client.patch(f"{_BASE}/channels/{channel_id}", headers=_HEADERS, json=edit)
    assert stale.status_code == 409
    assert stale.json["code"] == "provider_configuration_updated"
    replacement = client.post(
        f"{_BASE}/channels/{channel_id}:replace",
        headers=_HEADERS,
        json={
            "credentials": _CREDENTIALS,
            "expected_config_version": updated.json["summary"]["config_version"],
        },
    )
    assert replacement.status_code == 200
    assert replacement.json["summary"]["id"] != channel_id
    assert client.get(f"{_BASE}/channels/{channel_id}", headers=_HEADERS).status_code == 404
    summary = replacement.json["summary"]
    deleted = client.delete(
        f"{_BASE}/channels/{summary['id']}",
        headers=_HEADERS,
        query_string={"expected_config_version": summary["config_version"]},
    )
    assert deleted.status_code == 200
    assert deleted.json == {"channel_id": summary["id"]}
    assert dispatched == []


def test_sync_reuses_original_ee_initiator_and_latest_results(api_context) -> None:
    client, _, dispatched = api_context
    assert client.get(f"{_BASE}/sync-runs/latest", headers=_HEADERS).json["code"] == "im_integration_not_configured"
    _create(client)
    assert client.get(f"{_BASE}/sync-runs/latest", headers=_HEADERS).json["code"] == "im_sync_run_not_found"
    first = client.post(
        f"{_BASE}/sync-runs",
        headers=_HEADERS,
        json={
            "started_by_sys_user_id": "00000000-0000-0000-0000-000000000001",
        },
    )
    assert first.status_code == 200, first.json
    second = client.post(
        f"{_BASE}/sync-runs",
        headers=_HEADERS,
        json={
            "started_by_sys_user_id": "00000000-0000-0000-0000-000000000002",
        },
    )
    assert second.json == first.json
    assert second.json["run"]["started_by_sys_user_id"] == "00000000-0000-0000-0000-000000000001"
    assert second.json["run"]["initiator_display_name"] == ""
    assert len(dispatched) == 2
    latest = client.get(f"{_BASE}/sync-runs/latest", headers=_HEADERS)
    assert latest.json == first.json
    page = client.get(f"{_BASE}/sync-runs/latest/records?result=added", headers=_HEADERS)
    assert page.status_code == 200
    assert page.json == {"data": [], "page": 1, "limit": 20, "total": 0}
    assert client.get(f"{_BASE}/sync-runs/latest/records?result=all", headers=_HEADERS).status_code == 400


def _seed_contact(sessions: sessionmaker[Session], email: str, *, status=AccountStatus.ACTIVE) -> ContactId:
    with sessions.begin() as session:
        account = Account(name=email.split("@")[0], email=email, status=status)
        account.created_at = datetime(2020, 1, 1)
        session.add(account)
        session.flush()
        contact_id = SQLAlchemyContactRepository(session).provision_account_backed_contact(AccountId(account.id))
    return contact_id


def test_organization_contacts_and_atomic_default_binding(api_context) -> None:
    client, sessions, _ = api_context
    first = _seed_contact(sessions, "first@example.com")
    second = _seed_contact(sessions, "second@example.com")
    _seed_contact(sessions, "disabled@example.com", status=AccountStatus.BANNED)
    listed = client.get(f"{_BASE}/contacts", headers=_HEADERS)
    assert listed.status_code == 200
    assert listed.json["total"] == 2
    assert listed.json["data"][0]["joined_at"] == 1577836800
    assert "type" not in listed.json["data"][0]
    assert client.get(f"{_BASE}/contacts?keyword=SECOND", headers=_HEADERS).json["total"] == 1
    current_channel = _create(client)
    assert client.get(f"{_BASE}/identities", headers=_HEADERS).json["total"] == 0
    run = client.post(
        f"{_BASE}/sync-runs",
        headers=_HEADERS,
        json={
            "started_by_sys_user_id": "00000000-0000-0000-0000-000000000001",
        },
    ).json["run"]
    identity_id = IMIdentityId("00000000-0000-0000-0000-000000000099")
    with sessions.begin() as session:
        channel = DeploymentIMChannelReader(session).get()
        assert channel is not None
        SQLAlchemyIMIdentityRepository(session, channel.id).create(
            identity_id,
            IMIdentityObservation(
                "provider-user",
                "Provider Name",
                "first@example.com",
                OpaqueProviderPayload({}),
                IMSyncRunId(run["id"]),
                datetime(2026, 1, 1),
            ),
        )
    from core.human_input_v2.shared import TenantId
    from models.account import Tenant
    from models.human_input_v2 import HumanInputIMBindingWorkspaceOverride
    from repositories.human_input_v2.im_binding_repository import IMBindingAssignment
    from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository

    with sessions.begin() as session:
        tenant = Tenant(name="Override workspace")
        session.add(tenant)
        session.flush()
        channel = DeploymentIMChannelReader(session).get()
        assert channel is not None
        override = SQLAlchemyIMBindingRepository(session, channel.id).set_workspace_override(
            TenantId(tenant.id),
            IMBindingAssignment(first, identity_id, datetime(2026, 1, 1)),
            bound_by_account_id=None,
        )
    bound = client.put(f"{_BASE}/contacts/{first}/bindings", headers=_HEADERS, json={"identity_id": identity_id})
    assert bound.status_code == 200, bound.json
    binding_id = bound.json["contact"]["im_bindings"][0]["id"]
    repeated = client.put(f"{_BASE}/contacts/{first}/bindings", headers=_HEADERS, json={"identity_id": identity_id})
    assert repeated.json == bound.json
    detail = client.get(f"{_BASE}/contacts/{first}", headers=_HEADERS)
    assert detail.json["im_binding_details"][0]["identity"]["provider_user_id"] == "provider-user"
    identities = client.get(f"{_BASE}/identities?keyword=Provider", headers=_HEADERS)
    assert identities.json["data"][0]["binding_status"] == "bound"
    rejected = client.put(
        f"{_BASE}/contacts/{second}/bindings",
        headers=_HEADERS,
        json={
            "identity_id": "00000000-0000-0000-0000-000000000098",
        },
    )
    assert rejected.status_code == 404
    assert (
        client.get(f"{_BASE}/contacts/{first}", headers=_HEADERS).json["contact"]["im_bindings"][0]["id"] == binding_id
    )
    moved = client.put(f"{_BASE}/contacts/{second}/bindings", headers=_HEADERS, json={"identity_id": identity_id})
    assert moved.status_code == 200
    new_id = moved.json["contact"]["im_bindings"][0]["id"]
    assert new_id != binding_id
    assert client.get(f"{_BASE}/contacts/{first}", headers=_HEADERS).json["contact"]["im_bindings"] == []
    deleted = client.delete(f"{_BASE}/contacts/{second}/bindings", headers=_HEADERS)
    assert deleted.status_code == 200
    assert deleted.json == {"binding_id": new_id}
    assert client.delete(f"{_BASE}/contacts/{second}/bindings", headers=_HEADERS).json["code"] == "im_binding_not_found"
    with sessions() as session:
        assert len(session.scalars(select(HumanInputContactIdentity)).all()) == 3
        preserved = session.get(HumanInputIMBindingWorkspaceOverride, str(override.id))
        assert preserved is not None
        assert preserved.im_identity_id == str(identity_id)
    client.put(f"{_BASE}/contacts/{first}/bindings", headers=_HEADERS, json={"identity_id": identity_id})
    replacement = client.post(
        f"{_BASE}/channels/{current_channel['id']}:replace",
        headers=_HEADERS,
        json={
            "credentials": _CREDENTIALS,
            "expected_config_version": current_channel["config_version"],
        },
    )
    assert replacement.status_code == 200
    assert client.get(f"{_BASE}/identities", headers=_HEADERS).json["total"] == 0
    assert client.get(f"{_BASE}/contacts/{first}", headers=_HEADERS).json["contact"]["im_bindings"] == []


def test_authentication_and_sanitized_boundary_errors(api_context, monkeypatch) -> None:
    client, _, _ = api_context
    assert client.get(f"{_BASE}/channels").status_code == 401
    assert client.get(f"{_BASE}/channels", headers={"X-Inner-Api-Key": "wrong"}).status_code == 401
    monkeypatch.setattr(dify_config, "INNER_API", False)
    assert client.get(f"{_BASE}/channels", headers=_HEADERS).status_code == 404
    monkeypatch.setattr(dify_config, "INNER_API", True)
    response = client.post(
        f"{_BASE}/channels",
        headers=_HEADERS,
        json={
            "credentials": {"provider": "slack", "bot_token": "secret-must-never-escape"},
            "tenant_id": "spoofed-owner",
        },
    )
    assert response.status_code == 400
    assert "secret-must-never-escape" not in response.text
    assert client.get(f"{_BASE}/contacts?tenant_id=spoofed", headers=_HEADERS).status_code == 400


def test_generated_schema_documents_both_collection_operations(inner_app) -> None:
    with inner_app.test_request_context():
        schema = api.__schema__
    assert isinstance(schema, dict)
    paths = schema["paths"]
    assert isinstance(paths, dict)
    operations = {
        (path, method)
        for path, methods in paths.items()
        if path.startswith("/enterprise/human-input/v2") and isinstance(methods, dict)
        for method in methods
        if method in {"get", "post", "patch", "delete", "put"}
    }
    assert ("/enterprise/human-input/v2/channels", "get") in operations
    assert ("/enterprise/human-input/v2/channels", "post") in operations
    assert len(operations) == 17


def test_persistence_failure_uses_global_error_response(api_context, monkeypatch) -> None:
    from sqlalchemy.exc import StatementError

    client, _, _ = api_context
    service = MagicMock()
    service.create.side_effect = StatementError(
        "raw database error",
        "INSERT ciphertext",
        {"ciphertext": "private-ciphertext-parameter"},
        ConnectionError(),
    )
    monkeypatch.setattr(im_channel, "build_deployment_im_channel_service", lambda: service)
    response = client.post(f"{_BASE}/channels", headers=_HEADERS, json={"credentials": _CREDENTIALS})
    assert response.status_code == 500
    assert response.json["code"] == "unknown"
    assert "private-ciphertext-parameter" not in response.text
    assert "secret-must-never-escape" not in response.text


@pytest.mark.parametrize("operation", ["get_detail", "update", "delete", "replace", "test_saved"])
def test_addressed_channel_operations_preserve_not_found_contract(api_context, monkeypatch, operation) -> None:
    from controllers.common.human_input_v2.config_version import encode_im_config_version
    from repositories.human_input_v2.im_channel_repository import IMChannelId
    from services.human_input_v2.errors import ChannelNotFoundError

    client, _, _ = api_context
    channel_id = "00000000-0000-0000-0000-000000000001"
    version = encode_im_config_version(IMChannelId(channel_id), 1)
    service = MagicMock()
    monkeypatch.setattr(service, operation, MagicMock(side_effect=ChannelNotFoundError("Missing Channel")))
    monkeypatch.setattr(im_channel, "build_deployment_im_channel_service", lambda: service)
    path = f"{_BASE}/channels/{channel_id}"
    if operation == "get_detail":
        response = client.get(path, headers=_HEADERS)
    elif operation == "delete":
        response = client.delete(path, headers=_HEADERS, query_string={"expected_config_version": version})
    elif operation == "update":
        response = client.patch(
            path, headers=_HEADERS, json={"credentials": _UNCHANGED, "expected_config_version": version}
        )
    elif operation == "replace":
        response = client.post(
            f"{path}:replace", headers=_HEADERS, json={"credentials": _CREDENTIALS, "expected_config_version": version}
        )
    else:
        response = client.post(
            f"{path}:test", headers=_HEADERS, json={"credentials": _UNCHANGED, "expected_config_version": version}
        )
    assert response.status_code == 404
    assert response.json["code"] == "not_found"


@pytest.mark.parametrize("operation", ["put", "delete"])
def test_binding_operations_preserve_missing_contact_contract(api_context, monkeypatch, operation) -> None:
    from core.human_input_v2.im_integration import IMBindingCommandError, IMBindingCommandErrorCode

    client, _, _ = api_context
    service = MagicMock()
    error = IMBindingCommandError(IMBindingCommandErrorCode.CONTACT_NOT_FOUND, "Contact was not found")
    service.set_organization_im_binding.side_effect = error
    service.delete_organization_im_binding.side_effect = error
    monkeypatch.setattr(contact, "build_deployment_contact_service", lambda _session, **_options: service)
    path = f"{_BASE}/contacts/00000000-0000-0000-0000-000000000001/bindings"
    if operation == "put":
        response = client.put(path, headers=_HEADERS, json={"identity_id": "00000000-0000-0000-0000-000000000002"})
    else:
        response = client.delete(path, headers=_HEADERS)
    assert response.status_code == 404
    assert response.json["code"] == "contact_not_found"


@pytest.mark.parametrize("path", ["/sync-runs/latest", "/sync-runs/latest/records?result=added"])
def test_latest_sync_operations_preserve_run_not_found_contract(api_context, monkeypatch, path) -> None:
    from services.human_input_v2.im_contact_sync.service import IMSyncRunNotFoundError

    client, _, _ = api_context
    service = MagicMock()
    service.get_latest_run.side_effect = IMSyncRunNotFoundError("No run")
    service.list_latest_results.side_effect = IMSyncRunNotFoundError("No run")
    monkeypatch.setattr(im_sync, "build_im_sync_service", lambda: service)
    response = client.get(f"{_BASE}{path}", headers=_HEADERS)
    assert response.status_code == 404
    assert response.json["code"] == "im_sync_run_not_found"


def test_uninitialized_deployment_key_rejects_save_before_provider_io(api_context, monkeypatch) -> None:
    client, sessions, _ = api_context
    cipher = MagicMock()
    cipher.encrypt.side_effect = CredentialKeyUnavailableError("Unavailable deployment key")
    service = DeploymentIMChannelService(sessions, cipher, IMEventTransportMode.WEBHOOK)
    monkeypatch.setattr(im_channel, "build_deployment_im_channel_service", lambda: service)
    provider = MagicMock()
    provider.test_credentials.return_value = CredentialTestSuccess(IMProvider.FEISHU, "company-1")
    constructed = []

    def build_adapter(credentials):
        constructed.append(credentials)
        return provider

    monkeypatch.setattr(channel_service, "build_im_provider_adapter", build_adapter)
    saved = client.post(f"{_BASE}/channels", headers=_HEADERS, json={"credentials": _CREDENTIALS})
    assert saved.status_code == 503
    assert constructed == []


def test_expected_provider_failures_are_status_results_only_for_tests(api_context, monkeypatch) -> None:
    from core.human_input_v2.im_integration.adapters.entities import CredentialTestFailure, CredentialTestFailureKind

    client, _, dispatched = api_context
    adapter = MagicMock()
    adapter.test_credentials.return_value = CredentialTestFailure(
        CredentialTestFailureKind.AUTHENTICATION_REJECTED,
        "raw-provider-body-secret",
    )
    monkeypatch.setattr(channel_service, "build_im_provider_adapter", lambda _: adapter)
    tested = client.post(f"{_BASE}/channels:test", headers=_HEADERS, json={"credentials": _CREDENTIALS})
    assert tested.status_code == 200
    assert tested.json["status"] == "invalid_credentials"
    saved = client.post(f"{_BASE}/channels", headers=_HEADERS, json={"credentials": _CREDENTIALS})
    assert saved.status_code == 400
    assert "secret" not in tested.text + saved.text
    assert client.get(f"{_BASE}/channels", headers=_HEADERS).json == {"channels": []}
    assert dispatched == []


def test_dispatch_failure_preserves_queued_run_for_latest(api_context, monkeypatch) -> None:
    client, sessions, _ = api_context
    _create(client)

    def unavailable(_run_id, _scope):
        raise ConnectionError("broker unavailable")

    sync = IMSyncService(
        sessions,
        lambda session, _: DeploymentIMChannelReader(session).get(),
        unavailable,
        account_query=SQLAlchemyAccountRepository(sessions),
    )
    monkeypatch.setattr(im_sync, "build_im_sync_service", lambda: sync)
    response = client.post(
        f"{_BASE}/sync-runs",
        headers=_HEADERS,
        json={
            "started_by_sys_user_id": "00000000-0000-0000-0000-000000000001",
        },
    )
    assert response.status_code == 503
    assert response.json["code"] == "im_sync_dispatch_unavailable"
    latest = client.get(f"{_BASE}/sync-runs/latest", headers=_HEADERS)
    assert latest.status_code == 200
    assert latest.json["run"]["status"] == "queued"


def test_deployment_worker_uses_global_contacts_without_initialization(api_context) -> None:
    from core.human_input_v2.im_integration.adapters.entities import Directory, DirectoryEntry, ProviderUserId
    from core.human_input_v2.shared import DeploymentScope
    from models.human_input_v2 import HumanInputIMBinding
    from services.human_input_v2.im_contact_sync.composition import build_im_contact_sync_worker

    client, sessions, _ = api_context
    contact_id = _seed_contact(sessions, "first@example.com")
    # A read/sync must never allocate a Contact for an unprojected Account.
    with sessions.begin() as session:
        session.add(Account(name="Unprojected", email="unprojected@example.com", status=AccountStatus.ACTIVE))
    _create(client)
    run = client.post(
        f"{_BASE}/sync-runs",
        headers=_HEADERS,
        json={
            "started_by_sys_user_id": "00000000-0000-0000-0000-000000000001",
        },
    ).json["run"]
    adapter = MagicMock()
    adapter.directory.read_directory.return_value = Directory(
        (
            DirectoryEntry(ProviderUserId("provider-first"), "First", "first@example.com"),
            DirectoryEntry(ProviderUserId("provider-unprojected"), "Unprojected", "unprojected@example.com"),
        )
    )
    worker = build_im_contact_sync_worker(session_maker=sessions, deployment_adapter_factory=lambda _: adapter)
    finished = worker.execute(IMSyncRunId(run["id"]), DeploymentScope())
    assert finished.status.value == "succeeded"
    assert finished.added_count == 1
    assert finished.not_matched_count == 1
    with sessions() as session:
        assert len(session.scalars(select(HumanInputContactIdentity)).all()) == 1
        binding = session.scalar(select(HumanInputIMBinding))
        assert binding is not None
        assert binding.contact_id == str(contact_id)
    results = client.get(f"{_BASE}/sync-runs/latest/records?result=added", headers=_HEADERS)
    assert results.status_code == 200
    assert results.json["data"][0]["result"]["contact"]["email"] == "first@example.com"
