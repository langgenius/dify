"""Email configuration owner contracts without Flask, SQLAlchemy, or network I/O."""

from dataclasses import replace
from datetime import datetime
from typing import Never

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core.helper import encrypter
from core.human_input_v2.entities import EmailProviderType
from core.human_input_v2.shared import (
    AccountId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials
from repositories.human_input_v2.email_channel import (
    CreateEmailConfigurationResult,
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationResult,
    DeleteEmailConfigurationStatus,
    EmailChannelConfiguration,
    EmailConfigurationSnapshot,
    EmailProviderOperationError,
    EmailProviderValidationError,
    ResendCandidate,
    UpdateEmailConfigurationResult,
    UpdateEmailConfigurationStatus,
)
from repositories.human_input_v2.email_channel.entities import ResendCredentials
from services.human_input_v2.email_channel_management_service import HumanInputEmailChannelManagementService
from services.human_input_v2.email_credential_codec import load_email_credentials, seal_email_credentials
from services.human_input_v2.errors import (
    ChannelAlreadyConfiguredError,
    ChannelNotFoundError,
    ChannelProviderError,
    ProviderConfigurationUpdatedError,
    ProviderFailureKind,
    UnexpectedChannelProviderError,
)

_NOW = datetime(2026, 8, 20, 8)
_LATER = datetime(2026, 8, 20, 9)
_SCOPE = WorkspaceScope(TenantId("workspace-1"))
_ACTOR_ID = AccountId("account-1")


class FakeRepository:
    def __init__(self, current: EmailChannelConfiguration | None = None) -> None:
        self.current = current
        self.events: list[str] = []
        self.force_create_conflict = False
        self.force_update_stale = False
        self.force_delete_stale = False

    def load(self, tenant_id: TenantId) -> EmailChannelConfiguration | None:
        self.events.append("load")
        if self.current is None or self.current.tenant_id != tenant_id:
            return None
        return self.current

    def create(self, configuration: EmailChannelConfiguration) -> CreateEmailConfigurationResult:
        self.events.append("create")
        if self.force_create_conflict or self.current is not None:
            return CreateEmailConfigurationResult(CreateEmailConfigurationStatus.CONFLICT, None)
        self.current = configuration
        return CreateEmailConfigurationResult(CreateEmailConfigurationStatus.CREATED, configuration)

    def update(
        self,
        configuration: EmailChannelConfiguration,
        *,
        expected: EmailConfigurationSnapshot,
        now: datetime,
    ) -> UpdateEmailConfigurationResult:
        self.events.append("update")
        if self.force_update_stale or self.current is None or self.current.snapshot != expected:
            return UpdateEmailConfigurationResult(UpdateEmailConfigurationStatus.STALE, None)
        self.current = replace(
            configuration,
            config_version=self.current.config_version + 1,
            updated_at=now,
        )
        return UpdateEmailConfigurationResult(UpdateEmailConfigurationStatus.UPDATED, self.current)

    def delete(self, tenant_id: TenantId, *, expected: EmailConfigurationSnapshot) -> DeleteEmailConfigurationResult:
        self.events.append("delete")
        if self.current is None or self.current.tenant_id != tenant_id:
            return DeleteEmailConfigurationResult(DeleteEmailConfigurationStatus.NOT_CONFIGURED)
        if self.force_delete_stale or self.current.snapshot != expected:
            return DeleteEmailConfigurationResult(DeleteEmailConfigurationStatus.STALE)
        self.current = None
        return DeleteEmailConfigurationResult(DeleteEmailConfigurationStatus.DELETED)


class FakeProviderGateway:
    def __init__(self, events: list[str]) -> None:
        self._events = events
        self.failure: Exception | None = None
        self.settings: list[ResendCandidate] = []

    def send_test(self, candidate: ResendCandidate) -> None:
        self._events.append("send_test")
        self.settings.append(candidate)
        if self.failure is not None:
            raise self.failure


def _candidate(api_key: str = "new-api-key") -> ResendCandidate:
    return ResendCandidate(
        sender_email=NormalizedEmail("Sender@Example.com"),
        sender_name="Sender",
        credentials=ResendCredentials(api_key=api_key),
    )


def _configuration(
    *,
    configuration_id: str = "email-1",
    updated_at: datetime = _NOW,
) -> EmailChannelConfiguration:
    return EmailChannelConfiguration(
        id=EmailProviderId(configuration_id),
        tenant_id=_SCOPE.id,
        sender_email=NormalizedEmail("old@example.com"),
        sender_name="Old Sender",
        encrypted_credentials=seal_email_credentials(_SCOPE.id, ResendCredentials(api_key="saved-api-key")),
        configured_by_account_id=_ACTOR_ID,
        created_at=_NOW,
        updated_at=updated_at,
    )


def _service(
    repository: FakeRepository,
    provider_gateway: FakeProviderGateway,
) -> HumanInputEmailChannelManagementService:
    return HumanInputEmailChannelManagementService(
        provider_gateway,
        session_factory=Session,
        repository_factory=lambda _session: repository,
        clock=lambda: _LATER,
        id_factory=lambda: "email-new",
    )


@pytest.fixture(autouse=True)
def _protect_email_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        encrypter,
        "encrypt_token",
        lambda tenant_id, api_key: f"{tenant_id}:protected:{api_key}",
    )
    monkeypatch.setattr(
        encrypter, "decrypt_token", lambda tenant_id, ciphertext: ciphertext.removeprefix(f"{tenant_id}:protected:")
    )


def test_email_credentials_require_non_empty_ciphertext() -> None:
    with pytest.raises(ValidationError):
        ChannelEncryptedCredentials(ciphertext="")


def test_create_protects_without_provider_io_and_returns_safe_owner_view(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    repository = FakeRepository()
    provider_gateway = FakeProviderGateway(events)
    monkeypatch.setattr(
        encrypter,
        "encrypt_token",
        lambda tenant_id, api_key: events.append("protect") or f"{tenant_id}:protected:{api_key}",
    )

    view = _service(repository, provider_gateway).create(_SCOPE, _ACTOR_ID, _candidate())

    assert events == ["protect"]
    assert repository.events == ["load", "create"]
    assert view.id == EmailProviderId("email-new")
    assert view.provider is EmailProviderType.RESEND
    assert view.sender_email == "sender@example.com"
    assert view.sender_name == "Sender"
    assert view.revision == repository.current.snapshot if repository.current is not None else False
    assert "new-api-key" not in repr(view)
    assert repository.current is not None
    assert "new-api-key" not in repr(repository.current)


def test_create_rejects_existing_configuration_before_provider_io() -> None:
    events: list[str] = []
    repository = FakeRepository(_configuration())
    provider_gateway = FakeProviderGateway(events)

    with pytest.raises(ChannelAlreadyConfiguredError):
        _service(repository, provider_gateway).create(_SCOPE, _ACTOR_ID, _candidate())

    assert events == []
    assert repository.events == ["load"]


def test_update_requires_matching_path_identity_and_owner_revision_before_provider_io() -> None:
    current = _configuration()
    for channel_id, expected_revision in (
        (EmailProviderId("email-other"), current.snapshot),
        (current.id, replace(current.snapshot, config_version=current.config_version + 1)),
    ):
        events: list[str] = []
        repository = FakeRepository(current)
        provider_gateway = FakeProviderGateway(events)
        service = _service(repository, provider_gateway)

        expected_error = ChannelNotFoundError if channel_id != current.id else ProviderConfigurationUpdatedError
        with pytest.raises(expected_error):
            service.update(_SCOPE, channel_id, expected_revision, _ACTOR_ID, _candidate())

        assert events == []
        assert repository.events == ["load"]
        assert repository.current == current


def test_update_uses_repository_cas_and_advances_the_owner_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    repository = FakeRepository(_configuration())
    provider_gateway = FakeProviderGateway(events)
    monkeypatch.setattr(
        encrypter,
        "encrypt_token",
        lambda tenant_id, api_key: events.append("protect") or f"{tenant_id}:protected:{api_key}",
    )
    service = _service(repository, provider_gateway)
    current = service.get(_SCOPE, EmailProviderId("email-1"))

    updated = service.update(
        _SCOPE,
        current.id,
        current.revision,
        _ACTOR_ID,
        _candidate("rotated-api-key"),
    )

    assert events == ["protect"]
    assert repository.events == ["load", "load", "update"]
    assert updated.id == current.id
    assert updated.revision != current.revision
    assert repository.current is not None
    assert repository.current.sender_name == "Sender"


def test_update_maps_a_racing_repository_write_to_provider_configuration_updated() -> None:
    events: list[str] = []
    repository = FakeRepository(_configuration())
    repository.force_update_stale = True
    provider_gateway = FakeProviderGateway(events)
    service = _service(repository, provider_gateway)
    current = service.get_current(_SCOPE)
    assert current is not None

    with pytest.raises(ProviderConfigurationUpdatedError):
        service.update(_SCOPE, current.id, current.revision, _ACTOR_ID, _candidate())

    assert repository.current == _configuration()


def test_partial_update_cannot_overwrite_credentials_changed_during_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.human_input_v2.credential_update import ResendChannelUpdate, ResendCredentialsUpdate, Unchanged

    current = _configuration()
    winner = replace(
        current,
        encrypted_credentials=seal_email_credentials(_SCOPE.id, _candidate("concurrent-api-key").credentials),
        config_version=2,
    )
    repository = FakeRepository(current)
    gateway = FakeProviderGateway([])

    def encrypt_while_another_save_wins(tenant_id: str, plaintext: str) -> str:
        repository.current = winner
        return f"{tenant_id}:protected:{plaintext}"

    monkeypatch.setattr(encrypter, "encrypt_token", encrypt_while_another_save_wins)
    edit = ResendChannelUpdate(Unchanged.VALUE, "Stale Sender", ResendCredentialsUpdate(api_key=Unchanged.VALUE))

    with pytest.raises(ProviderConfigurationUpdatedError):
        _service(repository, gateway).update(_SCOPE, current.id, current.snapshot, _ACTOR_ID, edit)

    assert repository.current == winner
    assert repository.current is not None
    assert (
        load_email_credentials(repository.current.tenant_id, repository.current.encrypted_credentials)
        == _candidate("concurrent-api-key").credentials
    )
    assert gateway.settings == []


def test_delete_requires_identity_and_snapshot_cas() -> None:
    events: list[str] = []
    repository = FakeRepository(_configuration())
    provider_gateway = FakeProviderGateway(events)
    service = _service(repository, provider_gateway)
    current = service.get_current(_SCOPE)
    assert current is not None

    with pytest.raises(ProviderConfigurationUpdatedError):
        service.delete(
            _SCOPE,
            current.id,
            replace(current.revision, config_version=current.revision.config_version + 1),
        )
    assert repository.current is not None

    deleted_id = service.delete(_SCOPE, current.id, current.revision)

    assert deleted_id == current.id
    assert repository.current is None
    assert events == []


def test_delete_maps_repository_cas_loss_without_deleting_the_current_configuration() -> None:
    events: list[str] = []
    repository = FakeRepository(_configuration())
    repository.force_delete_stale = True
    service = _service(repository, FakeProviderGateway(events))
    current = service.get_current(_SCOPE)
    assert current is not None

    with pytest.raises(ProviderConfigurationUpdatedError):
        service.delete(_SCOPE, current.id, current.revision)

    assert repository.current is not None


def test_candidate_test_uses_only_submitted_credentials_and_never_persists() -> None:
    events: list[str] = []
    current = _configuration()
    repository = FakeRepository(current)
    provider_gateway = FakeProviderGateway(events)

    result = _service(repository, provider_gateway).test(_SCOPE, _candidate())

    assert result is None
    assert events == ["send_test"]
    assert repository.events == []
    assert repository.current == current
    assert provider_gateway.settings[0].credentials.api_key == "new-api-key"


@pytest.mark.parametrize(
    ("provider_error", "expected_kind"),
    [
        (EmailProviderValidationError("raw-invalid-code"), ProviderFailureKind.INVALID_CREDENTIALS),
        (EmailProviderOperationError("raw-connection-code"), ProviderFailureKind.CONNECTION_FAILURE),
    ],
)
def test_expected_provider_failures_are_safely_classified(
    provider_error: Exception,
    expected_kind: ProviderFailureKind,
) -> None:
    events: list[str] = []
    repository = FakeRepository()
    provider_gateway = FakeProviderGateway(events)
    provider_gateway.failure = provider_error

    with pytest.raises(ChannelProviderError) as captured:
        _service(repository, provider_gateway).test(_SCOPE, _candidate("sensitive-api-key"))

    assert captured.value.kind is expected_kind
    assert "raw-" not in str(captured.value)
    assert "sensitive-api-key" not in repr(captured.value)
    assert repository.events == []


def test_unexpected_provider_failure_is_detail_free_and_preserves_state() -> None:
    events: list[str] = []
    current = _configuration()
    repository = FakeRepository(current)
    provider_gateway = FakeProviderGateway(events)
    provider_gateway.failure = RuntimeError("raw provider response with sensitive-api-key")
    service = _service(repository, provider_gateway)
    with pytest.raises(UnexpectedChannelProviderError) as captured:
        service.test(_SCOPE, _candidate("sensitive-api-key"))

    assert "raw provider response" not in str(captured.value)
    assert "sensitive-api-key" not in repr(captured.value)
    assert repository.current == current
    assert repository.events == []


def test_email_test_exposes_upstream_code_in_safe_user_description() -> None:
    repository = FakeRepository()
    gateway = FakeProviderGateway([])
    gateway.failure = EmailProviderValidationError("invalid_api_key", provider_error_code="restricted_api_key")

    with pytest.raises(ChannelProviderError) as captured:
        _service(repository, gateway).test(_SCOPE, _candidate("sensitive-api-key"))

    assert captured.value.status_description == (
        "The submitted credentials are invalid. API error code: restricted_api_key."
    )
    assert "sensitive-api-key" not in str(captured.value)


def test_credential_protection_failure_propagates_and_never_persists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    repository = FakeRepository()
    failure = OSError("encryption backend unavailable")

    def fail_protection(_tenant_id: str, _api_key: str) -> Never:
        raise failure

    monkeypatch.setattr(encrypter, "encrypt_token", fail_protection)

    with pytest.raises(OSError, match="encryption backend unavailable") as captured:
        _service(repository, FakeProviderGateway(events)).create(
            _SCOPE,
            _ACTOR_ID,
            _candidate("sensitive-api-key"),
        )

    assert captured.value is failure
    assert events == []
    assert repository.events == ["load"]
    assert repository.current is None


@pytest.mark.parametrize("retain_key", [True, False])
@pytest.mark.parametrize(
    ("sender_field", "expected_email", "expected_name"),
    [
        ("sender_name", "old@example.com", "New Sender"),
        ("sender_email", "new@example.com", "Old Sender"),
        (None, "old@example.com", "Old Sender"),
    ],
)
def test_partial_update_preserves_settings_and_protects_the_complete_credentials(
    retain_key: bool, sender_field: str | None, expected_email: str, expected_name: str
) -> None:
    from services.human_input_v2.credential_update import ResendChannelUpdate, ResendCredentialsUpdate, Unchanged

    current = _configuration()
    repository = FakeRepository(current)
    gateway = FakeProviderGateway([])
    service = _service(repository, gateway)
    edit = ResendChannelUpdate(
        sender_email=NormalizedEmail("new@example.com") if sender_field == "sender_email" else Unchanged.VALUE,
        sender_name="New Sender" if sender_field == "sender_name" else Unchanged.VALUE,
        credentials=ResendCredentialsUpdate(api_key=Unchanged.VALUE if retain_key else "replacement-api-key"),
    )

    view = service.update(_SCOPE, current.id, current.snapshot, _ACTOR_ID, edit)

    assert view.sender_email == expected_email
    assert view.sender_name == expected_name
    assert repository.current is not None
    assert repository.current.sender_email == NormalizedEmail(expected_email)
    assert repository.current.sender_name == expected_name
    assert load_email_credentials(
        repository.current.tenant_id, repository.current.encrypted_credentials
    ) == ResendCredentials(api_key="saved-api-key" if retain_key else "replacement-api-key")
    assert view.revision.config_version == 2
    assert gateway.settings == []


@pytest.mark.parametrize("temporary_key", [None, "temporary-api-key"])
def test_saved_test_uses_saved_key_or_override_without_persisting(temporary_key: str | None) -> None:
    from services.human_input_v2.credential_update import ResendChannelUpdate, ResendCredentialsUpdate, Unchanged

    current = _configuration()
    repository = FakeRepository(current)
    gateway = FakeProviderGateway([])
    edit = ResendChannelUpdate(
        Unchanged.VALUE,
        "Temporary Sender",
        ResendCredentialsUpdate(api_key=temporary_key if temporary_key is not None else Unchanged.VALUE),
    )

    _service(repository, gateway).test_saved(_SCOPE, current.id, current.snapshot, edit)

    assert len(gateway.settings) == 1
    assert gateway.settings[0].credentials.api_key == (temporary_key if temporary_key is not None else "saved-api-key")
    assert gateway.settings[0].sender_email == NormalizedEmail("old@example.com")
    assert gateway.settings[0].sender_name == "Temporary Sender"
    assert repository.current == current


def test_saved_test_rejects_stale_revision_before_decrypting(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.human_input_v2.credential_update import ResendChannelUpdate, ResendCredentialsUpdate, Unchanged

    current = _configuration()
    repository = FakeRepository(current)
    gateway = FakeProviderGateway([])

    def unexpected_decrypt(*_args: object) -> Never:
        pytest.fail("a stale test must not decrypt credentials")

    monkeypatch.setattr(encrypter, "decrypt_token", unexpected_decrypt)
    edit = ResendChannelUpdate(Unchanged.VALUE, Unchanged.VALUE, ResendCredentialsUpdate(api_key=Unchanged.VALUE))
    with pytest.raises(ProviderConfigurationUpdatedError):
        _service(repository, gateway).test_saved(_SCOPE, current.id, replace(current.snapshot, config_version=2), edit)
    assert gateway.settings == []
    assert repository.current == current


@pytest.mark.parametrize("replacement_key", [None, "replacement-api-key"])
@pytest.mark.parametrize("operation", ["update", "test"])
def test_decryption_failure_propagates_without_sending_or_persisting(
    monkeypatch: pytest.MonkeyPatch,
    replacement_key: str | None,
    operation: str,
) -> None:
    from services.human_input_v2.credential_update import ResendChannelUpdate, ResendCredentialsUpdate, Unchanged

    current = _configuration()
    repository = FakeRepository(current)
    gateway = FakeProviderGateway([])
    failure = OSError("decryption backend unavailable")

    def fail_decryption(*_args: object) -> Never:
        raise failure

    monkeypatch.setattr(encrypter, "decrypt_token", fail_decryption)
    edit = ResendChannelUpdate(
        Unchanged.VALUE,
        Unchanged.VALUE,
        ResendCredentialsUpdate(api_key=Unchanged.VALUE if replacement_key is None else replacement_key),
    )
    service = _service(repository, gateway)
    if operation == "test":
        with pytest.raises(OSError, match="decryption backend unavailable") as captured:
            service.test_saved(_SCOPE, current.id, current.snapshot, edit)
    else:
        with pytest.raises(OSError, match="decryption backend unavailable") as captured:
            service.update(_SCOPE, current.id, current.snapshot, _ACTOR_ID, edit)
    assert captured.value is failure
    assert gateway.settings == []
    assert repository.current == current


def test_reading_sender_metadata_does_not_decrypt_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    repository = FakeRepository(_configuration())

    def unavailable_decryption(*_args: object) -> Never:
        pytest.fail("configuration metadata must remain readable without decryption")

    monkeypatch.setattr(encrypter, "decrypt_token", unavailable_decryption)
    service = _service(repository, FakeProviderGateway([]))
    current = service.get_current(_SCOPE)
    assert current is not None
    assert current.sender_email == "old@example.com"
    assert current.sender_name == "Old Sender"
    assert service.get(_SCOPE, current.id) == current
