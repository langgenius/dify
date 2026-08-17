"""Resend handler lifecycle tests without database, Flask, or network access."""

from dataclasses import replace
from datetime import datetime

import pytest

from core.human_input_v2.channel_management import (
    ChannelFailureCategory,
    ChannelKind,
    ChannelProvider,
    ChannelRef,
    ChannelStatus,
    DeleteChannelCommand,
    HumanInputChannelManagementContext,
    ResendChannelTestSummary,
    SaveEmailChannelCommand,
)
from core.human_input_v2.channel_management import (
    TestEmailChannelCommand as EmailTestCommand,
)
from core.human_input_v2.email_channel import (
    CreateEmailConfigurationResult,
    CreateEmailConfigurationStatus,
    DeleteEmailConfigurationResult,
    DeleteEmailConfigurationStatus,
    EmailChannelConfiguration,
    EmailProviderOperationError,
    EmailProviderValidationError,
    NewAPIKey,
    ProtectedAPIKey,
    ResendCandidate,
    RetainExistingAPIKey,
    UpdateEmailConfigurationResult,
    UpdateEmailConfigurationStatus,
)
from core.human_input_v2.shared import (
    AccountId,
    EmailProviderId,
    NormalizedEmail,
    TenantId,
)
from services.human_input_email_channel_manager import (
    DifyEmailCredentialProtector,
    HumanInputEmailChannelManager,
)

_NOW = datetime(2026, 7, 28, 8)
_LATER = datetime(2026, 7, 28, 9)
_REF = ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)
_CONTEXT = HumanInputChannelManagementContext(
    TenantId("workspace-1"),
    AccountId("account-1"),
    NormalizedEmail("operator@example.com"),
)


class FakeRepository:
    def __init__(self, current: EmailChannelConfiguration | None = None) -> None:
        self.current = current
        self.load_calls = 0
        self.writes: list[str] = []

    def load(self, tenant_id):
        self.load_calls += 1
        return self.current if self.current is None or self.current.tenant_id == tenant_id else None

    def create(self, configuration):
        self.writes.append("create")
        if self.current is not None:
            return CreateEmailConfigurationResult(CreateEmailConfigurationStatus.CONFLICT, None)
        self.current = configuration
        return CreateEmailConfigurationResult(CreateEmailConfigurationStatus.CREATED, configuration)

    def update(self, configuration, *, expected, now):
        self.writes.append("update")
        if self.current is None or self.current.snapshot != expected:
            return UpdateEmailConfigurationResult(UpdateEmailConfigurationStatus.STALE, None)
        self.current = replace(configuration, updated_at=now)
        return UpdateEmailConfigurationResult(UpdateEmailConfigurationStatus.UPDATED, self.current)

    def delete(self, _tenant_id):
        self.writes.append("delete")
        if self.current is None:
            return DeleteEmailConfigurationResult(DeleteEmailConfigurationStatus.NOT_CONFIGURED)
        self.current = None
        return DeleteEmailConfigurationResult(DeleteEmailConfigurationStatus.DELETED)


class FakeValidator:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str | None]] = []
        self.failure: Exception | None = None

    def validate(self, settings):
        self.calls.append(("validate", settings.api_key, None))
        if self.failure is not None:
            raise self.failure

    def send_test(self, settings, recipient):
        self.calls.append(("send_test", settings.api_key, str(recipient)))
        if self.failure is not None:
            raise self.failure


class FakeProtector:
    def __init__(self) -> None:
        self.protect_calls: list[tuple[TenantId, str]] = []
        self.reveal_calls: list[tuple[TenantId, ProtectedAPIKey]] = []

    def protect(self, tenant_id, api_key):
        self.protect_calls.append((tenant_id, api_key))
        return ProtectedAPIKey(f"{tenant_id}:protected:{api_key}")

    def reveal(self, tenant_id, protected_api_key):
        self.reveal_calls.append((tenant_id, protected_api_key))
        prefix = f"{tenant_id}:protected:"
        if not protected_api_key.value.startswith(prefix):
            raise ValueError("wrong workspace")
        return protected_api_key.value.removeprefix(prefix)


def _configuration(api_key: str = "old-key") -> EmailChannelConfiguration:
    return EmailChannelConfiguration(
        EmailProviderId("email-1"),
        _CONTEXT.tenant_id,
        NormalizedEmail("old@example.com"),
        "Old Sender",
        FakeProtector().protect(_CONTEXT.tenant_id, api_key),
        _CONTEXT.actor_account_id,
        _NOW,
        _NOW,
    )


def _manager(
    repository: FakeRepository,
    validator: FakeValidator,
    protector: FakeProtector | None = None,
) -> HumanInputEmailChannelManager:
    return HumanInputEmailChannelManager(
        repository,
        validator,
        protector or FakeProtector(),
        clock=lambda: _LATER,
        id_factory=lambda: "email-new",
    )


def _save(candidate: ResendCandidate) -> SaveEmailChannelCommand:
    return SaveEmailChannelCommand(_REF, candidate)


def test_get_projects_only_the_registered_resend_channel() -> None:
    repository = FakeRepository(_configuration())

    result = _manager(repository, FakeValidator()).get(_CONTEXT)

    assert repository.load_calls == 1
    assert result.view is not None
    assert result.view.ref == _REF
    assert result.view.configured


def test_save_validates_before_protecting_and_never_sends_test() -> None:
    repository = FakeRepository()
    validator = FakeValidator()

    result = _manager(repository, validator).save(
        _CONTEXT,
        _save(ResendCandidate(NormalizedEmail("Sender@Example.com"), " Sender ", NewAPIKey("new-key"))),
    )

    assert result.view is not None
    assert repository.writes == ["create"]
    assert validator.calls == [("validate", "new-key", None)]
    assert repository.current is not None
    assert repository.current.sender_email == NormalizedEmail("sender@example.com")
    assert "new-key" not in repr(repository.current)
    assert "new-key" not in repr(result)


def test_failed_validation_preserves_current_configuration() -> None:
    current = _configuration()
    repository = FakeRepository(current)
    validator = FakeValidator()
    validator.failure = EmailProviderValidationError("invalid_api_key")

    result = _manager(repository, validator).save(
        _CONTEXT,
        _save(ResendCandidate(NormalizedEmail("new@example.com"), "New", NewAPIKey("bad-key"))),
    )

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.VALIDATION_FAILURE
    assert result.failure.code == "invalid_api_key"
    assert repository.current == current
    assert repository.writes == []
    assert "bad-key" not in repr(result)


def test_unexpected_provider_failure_is_sanitized() -> None:
    repository = FakeRepository()
    validator = FakeValidator()
    validator.failure = RuntimeError("raw response containing bad-key")

    result = _manager(repository, validator).save(
        _CONTEXT,
        _save(ResendCandidate(NormalizedEmail("new@example.com"), "New", NewAPIKey("bad-key"))),
    )

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.PROVIDER_FAILURE
    assert result.failure.code == "provider_failure"
    assert "bad-key" not in repr(result)
    assert "raw response" not in repr(result)


def test_classified_provider_failure_preserves_safe_code() -> None:
    repository = FakeRepository()
    validator = FakeValidator()
    validator.failure = EmailProviderOperationError("provider_rate_limited")

    result = _manager(repository, validator).save(
        _CONTEXT,
        _save(ResendCandidate(NormalizedEmail("new@example.com"), "New", NewAPIKey("sensitive-key"))),
    )

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.PROVIDER_FAILURE
    assert result.failure.code == "provider_rate_limited"
    assert repository.writes == []
    assert "sensitive-key" not in repr(result)


def test_retained_key_is_revealed_for_validation_and_preserved_on_update() -> None:
    current = _configuration()
    repository = FakeRepository(current)
    validator = FakeValidator()
    protector = FakeProtector()

    result = _manager(repository, validator, protector).save(
        _CONTEXT,
        _save(
            ResendCandidate(
                NormalizedEmail("new@example.com"),
                "New",
                RetainExistingAPIKey(),
            )
        ),
    )

    assert result.view is not None
    assert validator.calls == [("validate", "old-key", None)]
    assert protector.reveal_calls == [(_CONTEXT.tenant_id, current.protected_api_key)]
    assert protector.protect_calls == []
    assert repository.current is not None
    assert repository.current.protected_api_key == current.protected_api_key


def test_retained_key_without_configuration_fails_before_provider_or_persistence_work() -> None:
    repository = FakeRepository()
    validator = FakeValidator()
    protector = FakeProtector()

    result = _manager(repository, validator, protector).save(
        _CONTEXT,
        _save(
            ResendCandidate(
                NormalizedEmail("new@example.com"),
                "New",
                RetainExistingAPIKey(),
            )
        ),
    )

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.NOT_CONFIGURED
    assert result.failure.code == "cannot_retain_missing_api_key"
    assert validator.calls == []
    assert protector.protect_calls == []
    assert protector.reveal_calls == []
    assert repository.writes == []


def test_replacement_key_is_protected_and_replaces_previous_credential() -> None:
    current = _configuration()
    repository = FakeRepository(current)
    validator = FakeValidator()
    protector = FakeProtector()

    result = _manager(repository, validator, protector).save(
        _CONTEXT,
        _save(ResendCandidate(NormalizedEmail("new@example.com"), "New", NewAPIKey("replacement-key"))),
    )

    assert result.view is not None
    assert protector.protect_calls == [(_CONTEXT.tenant_id, "replacement-key")]
    assert protector.reveal_calls == []
    assert repository.current is not None
    assert repository.current.protected_api_key != current.protected_api_key
    assert "replacement-key" not in repr(repository.current)
    assert "replacement-key" not in repr(result)


def test_credential_protection_failure_is_sanitized(
    caplog: pytest.LogCaptureFixture,
) -> None:
    class FailingProtector(FakeProtector):
        def protect(self, _tenant_id, api_key):
            raise RuntimeError(f"failed to protect {api_key}")

    repository = FakeRepository()
    validator = FakeValidator()
    candidate = ResendCandidate(NormalizedEmail("new@example.com"), "New", NewAPIKey("sensitive-key"))

    result = _manager(repository, validator, FailingProtector()).save(_CONTEXT, _save(candidate))

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.CHANNEL_FAILURE
    assert result.failure.code == "credential_protection_failed"
    assert repository.writes == []
    assert "sensitive-key" not in repr(candidate)
    assert "sensitive-key" not in repr(result)
    assert "sensitive-key" not in caplog.text


def test_cross_workspace_credential_reveal_failure_is_sanitized(
    caplog: pytest.LogCaptureFixture,
) -> None:
    current = replace(
        _configuration(),
        protected_api_key=ProtectedAPIKey("workspace-2:protected:foreign-key"),
    )
    repository = FakeRepository(current)
    validator = FakeValidator()

    result = _manager(repository, validator, FakeProtector()).save(
        _CONTEXT,
        _save(
            ResendCandidate(
                NormalizedEmail("new@example.com"),
                "New",
                RetainExistingAPIKey(),
            )
        ),
    )

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.CHANNEL_FAILURE
    assert result.failure.code == "credential_reveal_failed"
    assert validator.calls == []
    assert repository.writes == []
    assert "foreign-key" not in repr(result)
    assert "foreign-key" not in caplog.text


def test_test_connection_targets_operator_and_never_persists() -> None:
    current = _configuration()
    repository = FakeRepository(current)
    validator = FakeValidator()
    candidate = ResendCandidate(NormalizedEmail("sender@example.com"), "Sender", NewAPIKey("candidate-key"))

    result = _manager(repository, validator).test(_CONTEXT, EmailTestCommand(_REF, candidate))

    assert result.view is None
    assert result.test_result is not None
    assert result.test_result.ref == _REF
    assert result.test_result.status is ChannelStatus.CONNECTED
    assert result.test_result.checked_at == _LATER
    assert result.test_result.summary == ResendChannelTestSummary(
        recipient_email=_CONTEXT.actor_email,
        sender_email=candidate.sender_email,
        sender_name=candidate.sender_name,
    )
    assert validator.calls == [
        ("validate", "candidate-key", None),
        ("send_test", "candidate-key", "operator@example.com"),
    ]
    assert repository.current == current
    assert repository.writes == []
    assert "candidate-key" not in repr(result)


def test_test_connection_without_configuration_does_not_claim_persisted_state() -> None:
    repository = FakeRepository()
    candidate = ResendCandidate(NormalizedEmail("sender@example.com"), "Sender", NewAPIKey("candidate-key"))

    result = _manager(repository, FakeValidator()).test(_CONTEXT, EmailTestCommand(_REF, candidate))

    assert result.view is None
    assert result.test_result is not None
    assert not hasattr(result.test_result, "configured")
    assert not hasattr(result.test_result.summary, "api_key_configured")
    assert repository.current is None
    assert repository.writes == []


def test_delete_absent_configuration_is_stable_not_configured() -> None:
    repository = FakeRepository()
    result = _manager(repository, FakeValidator()).delete(_CONTEXT, DeleteChannelCommand(_REF))

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.NOT_CONFIGURED


def test_dify_credential_protector_always_passes_workspace_scope(monkeypatch) -> None:
    calls: list[tuple[str, str, str]] = []

    def encrypt_token(tenant_id: str, token: str) -> str:
        calls.append(("protect", tenant_id, token))
        return f"{tenant_id}:ciphertext"

    def decrypt_token(tenant_id: str, token: str) -> str:
        calls.append(("reveal", tenant_id, token))
        if not token.startswith(f"{tenant_id}:"):
            raise ValueError("credential belongs to another workspace")
        return "plaintext"

    monkeypatch.setattr("services.human_input_email_channel_manager.encrypter.encrypt_token", encrypt_token)
    monkeypatch.setattr("services.human_input_email_channel_manager.encrypter.decrypt_token", decrypt_token)
    protector = DifyEmailCredentialProtector()

    protected = protector.protect(_CONTEXT.tenant_id, "plaintext")
    revealed = protector.reveal(_CONTEXT.tenant_id, protected)
    with pytest.raises(ValueError, match="another workspace"):
        protector.reveal(TenantId("workspace-2"), protected)

    assert revealed == "plaintext"
    assert calls == [
        ("protect", "workspace-1", "plaintext"),
        ("reveal", "workspace-1", "workspace-1:ciphertext"),
        ("reveal", "workspace-2", "workspace-1:ciphertext"),
    ]
