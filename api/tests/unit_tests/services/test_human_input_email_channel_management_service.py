"""Email configuration owner contracts without Flask, SQLAlchemy, or network I/O."""

from dataclasses import replace
from datetime import datetime

import pytest

from core.helper import encrypter
from core.human_input_v2.entities import EmailProviderType
from core.human_input_v2.shared import (
    AccountId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)
from repositories.human_input_v2.email_channel import (
    CreateEmailConfigurationResult,
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationResult,
    DeleteEmailConfigurationStatus,
    EmailChannelConfiguration,
    EmailProviderOperationError,
    EmailProviderValidationError,
    ResendCandidate,
    UpdateEmailConfigurationResult,
    UpdateEmailConfigurationStatus,
)
from services.human_input_v2.email_channel_management_service import HumanInputEmailChannelManagementService
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
_RECIPIENT = NormalizedEmail("operator@example.com")


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
        expected,
        now,
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

    def delete(self, tenant_id: TenantId, *, expected) -> DeleteEmailConfigurationResult:
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

    def validate(self, candidate: ResendCandidate) -> None:
        self._events.append("validate")
        self.settings.append(candidate)
        if self.failure is not None:
            raise self.failure

    def send_test(self, candidate: ResendCandidate, recipient: NormalizedEmail) -> None:
        self._events.append("send_test")
        self.settings.append(candidate)
        assert recipient == _RECIPIENT
        if self.failure is not None:
            raise self.failure


def _candidate(api_key: str = "new-api-key") -> ResendCandidate:
    return ResendCandidate(
        sender_email=NormalizedEmail("Sender@Example.com"),
        sender_name=" Sender ",
        api_key=api_key,
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
        protected_api_key="protected-old-api-key",
        configured_by_account_id=_ACTOR_ID,
        created_at=_NOW,
        updated_at=updated_at,
    )


def _service(
    repository: FakeRepository,
    provider_gateway: FakeProviderGateway,
) -> HumanInputEmailChannelManagementService:
    return HumanInputEmailChannelManagementService(
        repository,
        provider_gateway,
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


def test_resend_candidate_requires_a_non_blank_api_key_and_sender_name() -> None:
    with pytest.raises(ValueError, match="API key must not be blank"):
        ResendCandidate(
            sender_email=NormalizedEmail("sender@example.com"),
            sender_name="Sender",
            api_key="  ",
        )

    with pytest.raises(ValueError, match="sender name must not be blank"):
        ResendCandidate(
            sender_email=NormalizedEmail("sender@example.com"),
            sender_name="  ",
            api_key="new-api-key",
        )


def test_email_configuration_requires_a_protected_api_key() -> None:
    with pytest.raises(ValueError, match="protected API key must not be empty"):
        replace(_configuration(), protected_api_key="")


def test_create_validates_then_protects_before_persistence_and_returns_safe_owner_view(
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

    assert events == ["validate", "protect"]
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

        if channel_id != current.id:
            expected_error = ChannelNotFoundError
        else:
            expected_error = ProviderConfigurationUpdatedError
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

    assert events == ["validate", "protect"]
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

    result = _service(repository, provider_gateway).test(_SCOPE, _candidate(), _RECIPIENT)

    assert result is None
    assert events == ["validate", "send_test"]
    assert repository.events == []
    assert repository.current == current
    assert provider_gateway.settings[0].api_key == "new-api-key"


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
        _service(repository, provider_gateway).create(_SCOPE, _ACTOR_ID, _candidate("sensitive-api-key"))

    assert captured.value.kind is expected_kind
    assert "raw-" not in str(captured.value)
    assert "sensitive-api-key" not in repr(captured.value)
    assert repository.events == ["load"]


def test_unexpected_provider_failure_is_detail_free_and_preserves_state() -> None:
    events: list[str] = []
    current = _configuration()
    repository = FakeRepository(current)
    provider_gateway = FakeProviderGateway(events)
    provider_gateway.failure = RuntimeError("raw provider response with sensitive-api-key")
    service = _service(repository, provider_gateway)
    snapshot = service.get_current(_SCOPE)
    assert snapshot is not None

    with pytest.raises(UnexpectedChannelProviderError) as captured:
        service.update(
            _SCOPE,
            snapshot.id,
            snapshot.revision,
            _ACTOR_ID,
            _candidate("sensitive-api-key"),
        )

    assert "raw provider response" not in str(captured.value)
    assert "sensitive-api-key" not in repr(captured.value)
    assert repository.current == current
    assert repository.events == ["load", "load"]


def test_credential_protection_failure_is_detail_free_and_never_persists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    repository = FakeRepository()

    def fail_protection(_tenant_id: str, _api_key: str) -> str:
        raise RuntimeError("raw encryption failure with sensitive-api-key")

    monkeypatch.setattr(encrypter, "encrypt_token", fail_protection)

    with pytest.raises(UnexpectedChannelProviderError) as captured:
        _service(repository, FakeProviderGateway(events)).create(
            _SCOPE,
            _ACTOR_ID,
            _candidate("sensitive-api-key"),
        )

    assert "raw encryption failure" not in str(captured.value)
    assert "sensitive-api-key" not in repr(captured.value)
    assert events == ["validate"]
    assert repository.events == ["load"]
    assert repository.current is None
