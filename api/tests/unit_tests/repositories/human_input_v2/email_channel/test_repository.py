"""Email persistence and credential contracts using caller-owned SQLite Sessions."""

import json
from dataclasses import replace
from datetime import datetime

import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.helper import encrypter
from core.human_input_v2.shared import AccountId, EmailProviderId, NormalizedEmail, TenantId, WorkspaceScope
from models.account import Tenant
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.email_channel import (
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationStatus,
    EmailChannelConfiguration,
    UpdateEmailConfigurationStatus,
)
from repositories.human_input_v2.email_channel.entities import ResendCandidate, ResendCredentials
from repositories.human_input_v2.email_channel.mappers import (
    email_configuration_from_record,
    email_configuration_to_record,
)
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from services.human_input_v2.credential_update import ResendChannelUpdate, ResendCredentialsUpdate, Unchanged
from services.human_input_v2.email_channel_management_service import HumanInputEmailChannelManagementService
from services.human_input_v2.email_credential_codec import load_email_credentials, seal_email_credentials
from services.human_input_v2.errors import ProviderConfigurationUpdatedError

_NOW = datetime(2026, 7, 28, 8)
_EARLIER = datetime(2026, 7, 28, 7)
_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000001")
_SCOPE = WorkspaceScope(_TENANT_ID)


@pytest.fixture(autouse=True)
def credential_cipher(monkeypatch: pytest.MonkeyPatch) -> None:
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(encrypter, "encrypt_token", lambda _tenant, token: cipher.encrypt(token.encode()).decode())
    monkeypatch.setattr(encrypter, "decrypt_token", lambda _tenant, token: cipher.decrypt(token.encode()).decode())


def _candidate(sender_name: str = "Sender") -> ResendCandidate:
    return ResendCandidate(
        NormalizedEmail("sender@example.com"), sender_name, ResendCredentials(api_key="private-api-key")
    )


def _configuration(
    configuration_id: str = "00000000-0000-0000-0000-000000000010",
    tenant_id: TenantId = _TENANT_ID,
) -> EmailChannelConfiguration:
    return EmailChannelConfiguration(
        id=EmailProviderId(configuration_id),
        tenant_id=tenant_id,
        sender_email=_candidate().sender_email,
        sender_name=_candidate().sender_name,
        encrypted_credentials=seal_email_credentials(tenant_id, _candidate().credentials),
        configured_by_account_id=AccountId("00000000-0000-0000-0000-000000000020"),
        created_at=_NOW,
        updated_at=_NOW,
    )


@pytest.fixture
def sessions(sqlite_engine: Engine) -> sessionmaker[Session]:
    session_maker = sessionmaker(sqlite_engine, expire_on_commit=False)
    with session_maker.begin() as session:
        tenant = Tenant(name="Workspace")
        tenant.id = str(_TENANT_ID)
        session.add(tenant)
    return session_maker


class ProviderGateway:
    def __init__(self) -> None:
        self.tests: list[ResendCandidate] = []

    def send_test(self, candidate: ResendCandidate) -> None:
        self.tests.append(candidate)


def _service(sessions: sessionmaker[Session], gateway: ProviderGateway) -> HumanInputEmailChannelManagementService:
    return HumanInputEmailChannelManagementService(gateway, session_factory=sessions)


def _assert_stored_credentials(sessions: sessionmaker[Session], candidate: ResendCandidate) -> None:
    with sessions() as session:
        stored = session.execute(
            sa.text("SELECT encrypted_credentials, sender_email, sender_name FROM human_input_email_providers")
        ).one()
    envelope = json.loads(stored.encrypted_credentials)
    assert candidate.credentials.api_key not in stored.encrypted_credentials
    assert str(candidate.sender_email) not in stored.encrypted_credentials
    assert set(envelope) == {"version", "ciphertext"}
    assert envelope["version"] == 1
    assert stored.sender_email == str(candidate.sender_email)
    assert stored.sender_name == candidate.sender_name
    assert json.loads(encrypter.decrypt_token(str(_TENANT_ID), envelope["ciphertext"])) == {
        "api_key": candidate.credentials.api_key,
    }


def test_save_encrypts_the_complete_credentials_and_returns_safe_view(sessions: sessionmaker[Session]) -> None:
    gateway = ProviderGateway()
    service = _service(sessions, gateway)

    view = service.create(_SCOPE, None, _candidate())

    _assert_stored_credentials(sessions, _candidate())
    assert service.get(_SCOPE, view.id) == view
    assert view.sender_email == "sender@example.com"
    assert view.sender_name == "Sender"
    assert "private-api-key" not in repr(view)
    assert gateway.tests == []


@pytest.mark.parametrize("retain_key", [True, False])
def test_saved_configuration_is_tested_without_persisting_edits_and_updated_with_cas(
    sessions: sessionmaker[Session], retain_key: bool
) -> None:
    gateway = ProviderGateway()
    service = _service(sessions, gateway)
    current = service.create(_SCOPE, None, _candidate())
    with sessions() as session:
        saved_credentials = session.scalar(sa.text("SELECT encrypted_credentials FROM human_input_email_providers"))
    edit = ResendChannelUpdate(
        Unchanged.VALUE,
        "Edited Sender",
        ResendCredentialsUpdate(api_key=Unchanged.VALUE if retain_key else "replacement-api-key"),
    )

    service.test_saved(_SCOPE, current.id, current.revision, edit)

    expected = ResendCandidate(
        NormalizedEmail("sender@example.com"),
        "Edited Sender",
        ResendCredentials(api_key="private-api-key" if retain_key else "replacement-api-key"),
    )
    assert gateway.tests == [expected]
    with sessions() as session:
        stored = session.execute(
            sa.text("SELECT encrypted_credentials, config_version FROM human_input_email_providers")
        ).one()
    assert stored.encrypted_credentials == saved_credentials
    assert stored.config_version == 1

    updated = service.update(_SCOPE, current.id, current.revision, None, edit)

    _assert_stored_credentials(sessions, expected)
    assert updated.revision.config_version == 2
    assert service.get_current(_SCOPE) == updated
    with pytest.raises(ProviderConfigurationUpdatedError):
        service.update(_SCOPE, current.id, current.revision, None, edit)
    _assert_stored_credentials(sessions, expected)


def test_create_load_conflict_and_cross_tenant_isolation(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as session:
        repository = SQLAlchemyEmailChannelRepository(session)
        created = repository.create(_configuration())
        conflict = repository.create(_configuration("00000000-0000-0000-0000-000000000011"))
        assert created.status is CreateEmailConfigurationStatus.CREATED
        assert conflict.status is CreateEmailConfigurationStatus.CONFLICT
    with sessions() as session:
        repository = SQLAlchemyEmailChannelRepository(session)
        assert repository.load(_TENANT_ID) == created.configuration
        assert repository.load(TenantId("00000000-0000-0000-0000-000000000099")) is None


def test_email_configuration_mapper_round_trip_is_detached() -> None:
    configuration = _configuration()
    restored = email_configuration_from_record(email_configuration_to_record(configuration))
    assert restored == configuration
    assert restored is not configuration


def test_update_uses_identity_and_revision_and_advances_numeric_version(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as session:
        current = SQLAlchemyEmailChannelRepository(session).create(_configuration()).configuration
        assert current is not None
    replacement = replace(
        current,
        sender_name="Updated",
        encrypted_credentials=seal_email_credentials(_TENANT_ID, _candidate("Updated").credentials),
    )
    with sessions.begin() as session:
        result = SQLAlchemyEmailChannelRepository(session).update(replacement, expected=current.snapshot, now=_EARLIER)
    with sessions.begin() as session:
        repository = SQLAlchemyEmailChannelRepository(session)
        stale = repository.update(current, expected=current.snapshot, now=_NOW)
        assert result.status is UpdateEmailConfigurationStatus.UPDATED
        assert result.configuration is not None
        assert result.configuration.config_version == current.config_version + 1
        assert result.configuration.updated_at > current.updated_at
        assert stale.status is UpdateEmailConfigurationStatus.STALE
        assert repository.load(_TENANT_ID) == result.configuration
        assert (
            load_email_credentials(result.configuration.tenant_id, result.configuration.encrypted_credentials)
            == _candidate("Updated").credentials
        )


def test_delete_recreate_rejects_deleted_identity_snapshot(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as session:
        repository = SQLAlchemyEmailChannelRepository(session)
        deleted = repository.create(_configuration()).configuration
        assert deleted is not None
        assert repository.delete(_TENANT_ID, expected=deleted.snapshot).status is DeleteEmailConfigurationStatus.DELETED
        session.flush()
        recreated = repository.create(_configuration("00000000-0000-0000-0000-000000000011")).configuration
        assert recreated is not None
    with sessions.begin() as session:
        repository = SQLAlchemyEmailChannelRepository(session)
        stale = repository.update(deleted, expected=deleted.snapshot, now=_NOW)
        assert stale.status is UpdateEmailConfigurationStatus.STALE
        assert repository.load(_TENANT_ID) == recreated


def test_delete_uses_identity_and_revision_snapshot(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as session:
        repository = SQLAlchemyEmailChannelRepository(session)
        current = repository.create(_configuration()).configuration
        assert current is not None
        wrong_identity = replace(current.snapshot, configuration_id=EmailProviderId("email-other"))
        stale_identity = repository.delete(_TENANT_ID, expected=wrong_identity)
        stale_revision = repository.delete(_TENANT_ID, expected=replace(current.snapshot, config_version=2))
        assert stale_identity.status is DeleteEmailConfigurationStatus.STALE
        assert stale_revision.status is DeleteEmailConfigurationStatus.STALE
        assert repository.load(_TENANT_ID) == current


def test_failed_update_rolls_back_all_changes(sessions: sessionmaker[Session], sqlite_engine: Engine) -> None:
    with sessions.begin() as session:
        current = SQLAlchemyEmailChannelRepository(session).create(_configuration()).configuration
        assert current is not None

    def fail_update(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        if statement.lstrip().upper().startswith("UPDATE"):
            raise RuntimeError("forced write failure")

    event.listen(sqlite_engine, "before_cursor_execute", fail_update)
    try:
        with pytest.raises(RuntimeError, match="forced write failure"), sessions.begin() as session:
            SQLAlchemyEmailChannelRepository(session).update(
                replace(current, encrypted_credentials=ChannelEncryptedCredentials(ciphertext="replacement")),
                expected=current.snapshot,
                now=_NOW,
            )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", fail_update)
    with sessions() as session:
        assert SQLAlchemyEmailChannelRepository(session).load(_TENANT_ID) == current
