from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import ClassVar, override

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.file_scan.base import FileScanner, ScannerConfigError, ScannerError
from core.file_scan.entities import ScanProblem, ScanProviderType, ScanTarget, ScanVerdict
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset
from models.enums import CreatorUserRole
from models.file_scan import (
    FileScanFallbackAction,
    FileScanPolicy,
    FileScanProvider,
    FileScanProviderStatus,
    FileScanRecord,
)
from models.model import UploadFile
from services.file_scan import (
    FileScanPolicyService,
    FileScanProviderInUseError,
    FileScanProviderService,
    FileScanService,
    FileScanValidationError,
    ScanErrorCode,
    ScanOutcome,
    ScanPolicy,
    ScanScope,
)
from services.file_scan import file_scan_service as service_module
from services.file_scan import provider_service as provider_module

TENANT_ID = "11111111-1111-4111-8111-111111111111"
OTHER_TENANT_ID = "22222222-2222-4222-8222-222222222222"
ACCOUNT_ID = "33333333-3333-4333-8333-333333333333"
SCOPE = ScanScope("dataset", "44444444-4444-4444-8444-444444444444")


class _Storage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.loads = 0

    def load_once(self, key: str) -> bytes:
        self.loads += 1
        return self.objects[key]

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


class _Scanner(FileScanner):
    """Returns scripted verdicts and records how it was called."""

    provider_type = ScanProviderType.CLOUDMERSIVE

    def __init__(self, *verdicts: ScanVerdict) -> None:
        super().__init__({}, {})
        self.verdicts = list(verdicts)
        self.external_ids: list[str | None] = []

    @classmethod
    @override
    def validate_settings(cls, credentials: Mapping[str, str], config: Mapping[str, object]) -> None:
        del credentials, config

    @override
    def _scan(self, target: ScanTarget, *, external_id: str | None) -> ScanVerdict:
        self.external_ids.append(external_id)
        target.load()
        return self.verdicts.pop(0) if len(self.verdicts) > 1 else self.verdicts[0]


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> _Storage:
    backend = _Storage()
    monkeypatch.setattr(service_module, "storage", backend)
    return backend


@pytest.fixture(autouse=True)
def _settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service_module.dify_config, "FILE_SCAN_ENABLED", True)
    monkeypatch.setattr(service_module.dify_config, "FILE_SCAN_MAX_ATTEMPTS", 3)
    monkeypatch.setattr(service_module.dify_config, "FILE_SCAN_CLEAN_VERDICT_TTL_HOURS", 24)
    # The workspace key provider is not available in unit tests; the cipher is not under test here.
    monkeypatch.setattr(provider_module, "encrypt_token", lambda _tenant_id, token: f"enc:{token}")
    monkeypatch.setattr(provider_module, "decrypt_token", lambda _tenant_id, token: token.removeprefix("enc:"))


def _use_scanner(monkeypatch: pytest.MonkeyPatch, *verdicts: ScanVerdict) -> _Scanner:
    scanner = _Scanner(*verdicts)
    monkeypatch.setattr(service_module, "build_scanner", lambda _tenant_id, _provider: scanner)
    return scanner


def _seed(
    session_maker: sessionmaker[Session],
    storage: _Storage,
    *,
    upload_file_id: str = "55555555-5555-4555-8555-555555555555",
    file_hash: str | None = "hash-a",
    name: str = "report.docx",
    on_unavailable: FileScanFallbackAction = FileScanFallbackAction.BLOCK,
    on_unscannable: FileScanFallbackAction = FileScanFallbackAction.BLOCK,
    enabled: bool = True,
) -> tuple[str, str]:
    """Create a provider, a policy for ``SCOPE`` and one stored upload file."""
    key = f"upload_files/{upload_file_id}"
    storage.objects[key] = b"content"
    with session_maker.begin() as session:
        provider = session.scalar(select(FileScanProvider).where(FileScanProvider.tenant_id == TENANT_ID))
        if provider is None:
            provider = FileScanProvider(tenant_id=TENANT_ID, name="Company scanner", provider_type="cloudmersive")
            session.add(provider)
            session.flush()
            session.add(
                FileScanPolicy(
                    tenant_id=TENANT_ID,
                    scope_type=SCOPE.type,
                    scope_id=SCOPE.id,
                    enabled=enabled,
                    provider_id=provider.id,
                    on_unavailable=on_unavailable,
                    on_unscannable=on_unscannable,
                )
            )
        upload_file = UploadFile(
            tenant_id=TENANT_ID,
            storage_type=StorageType.LOCAL,
            key=key,
            name=name,
            size=7,
            extension="docx",
            mime_type="application/octet-stream",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=ACCOUNT_ID,
            created_at=datetime(2026, 11, 11, tzinfo=UTC),
            used=False,
            hash=file_hash,
        )
        upload_file.id = upload_file_id
        session.add(upload_file)
        return provider.id, upload_file_id


def _service(session_maker: sessionmaker[Session]) -> tuple[FileScanService, list[float]]:
    sleeps: list[float] = []
    return FileScanService(session_maker, sleep=sleeps.append), sleeps


def _scan(service: FileScanService, upload_file_id: str, *, wait_for_result: bool = True) -> ScanOutcome:
    return service.scan_upload_file(
        tenant_id=TENANT_ID, upload_file_id=upload_file_id, scope=SCOPE, wait_for_result=wait_for_result
    )


def _records(session_maker: sessionmaker[Session]) -> list[FileScanRecord]:
    with session_maker() as session:
        return list(session.scalars(select(FileScanRecord).order_by(FileScanRecord.created_at, FileScanRecord.id)))


def test_scope_without_a_policy_or_with_scanning_off_is_allowed_without_reading_the_file(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    scanner = _use_scanner(monkeypatch, ScanVerdict.infected(["never asked"]))
    service, _ = _service(sqlite_session_factory)

    no_policy = service.scan_upload_file(tenant_id=TENANT_ID, upload_file_id="missing", scope=SCOPE)
    assert (no_policy.allowed, no_policy.status) == (True, "disabled")

    _, upload_file_id = _seed(sqlite_session_factory, storage, enabled=False)
    assert _scan(service, upload_file_id).status == "disabled"

    monkeypatch.setattr(service_module.dify_config, "FILE_SCAN_ENABLED", False)
    with sqlite_session_factory.begin() as session:
        policy = session.scalar(select(FileScanPolicy))
        assert policy is not None
        policy.enabled = True
    assert _scan(service, upload_file_id).status == "disabled"
    assert scanner.external_ids == []
    assert storage.loads == 0
    assert not service.is_enabled(tenant_id=TENANT_ID, scope=SCOPE)


def test_clean_file_is_allowed_and_recorded(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_scanner(monkeypatch, ScanVerdict.clean(engine="Engine 1"))
    provider_id, upload_file_id = _seed(sqlite_session_factory, storage)
    service, _ = _service(sqlite_session_factory)

    outcome = _scan(service, upload_file_id)

    assert (outcome.allowed, outcome.status, outcome.code, outcome.unscanned) == (True, "clean", None, False)
    [record] = _records(sqlite_session_factory)
    assert outcome.record_id == record.id
    assert (record.provider_id, record.upload_file_id, record.scope_type, record.scope_id) == (
        provider_id,
        upload_file_id,
        SCOPE.type,
        SCOPE.id,
    )
    assert (record.allowed, record.engine, record.file_name) == (True, "Engine 1", "report.docx")


def test_malware_blocks_deletes_the_original_and_names_the_threat(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    _use_scanner(monkeypatch, ScanVerdict.infected(["Win.Trojan.Agent-123"]))
    _, upload_file_id = _seed(
        sqlite_session_factory,
        storage,
        on_unavailable=FileScanFallbackAction.ALLOW,
        on_unscannable=FileScanFallbackAction.ALLOW,
    )
    service, _ = _service(sqlite_session_factory)

    outcome = _scan(service, upload_file_id)

    assert not outcome.allowed
    assert outcome.code is ScanErrorCode.MALWARE_DETECTED
    assert not outcome.retryable
    assert storage.objects == {}
    assert outcome.describe() == (
        '"report.docx" was blocked by the malware scan: Win.Trojan.Agent-123 detected. The original file was deleted.'
    )
    assert outcome.to_error() == {
        "code": "file_scan_malware_detected",
        "file_name": "report.docx",
        "provider_name": "Company scanner",
        "provider_type": "cloudmersive",
        "problem": None,
        "threats": ["Win.Trojan.Agent-123"],
        "size_limit": None,
        "retryable": False,
    }


def test_one_bad_file_does_not_change_the_outcome_of_the_others(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    verdicts = {
        "a.docx": ScanVerdict.clean(),
        "b.docx": ScanVerdict.infected(["Evil"]),
        "c.zip": ScanVerdict.unscannable(ScanProblem.ENCRYPTED),
        "d.docx": ScanVerdict.clean(),
    }

    class ByName(_Scanner):
        @override
        def _scan(self, target: ScanTarget, *, external_id: str | None) -> ScanVerdict:
            del external_id
            return verdicts[target.file_name]

    monkeypatch.setattr(service_module, "build_scanner", lambda _tenant_id, _provider: ByName())
    ids = [
        _seed(
            sqlite_session_factory,
            storage,
            upload_file_id=f"55555555-5555-4555-8555-55555555555{index}",
            file_hash=f"hash-{name}",
            name=name,
        )[1]
        for index, name in enumerate(verdicts)
    ]
    service, _ = _service(sqlite_session_factory)

    outcomes = [_scan(service, upload_file_id) for upload_file_id in ids]

    assert [outcome.allowed for outcome in outcomes] == [True, False, False, True]
    assert [outcome.code for outcome in outcomes] == [
        None,
        ScanErrorCode.MALWARE_DETECTED,
        ScanErrorCode.UNSCANNABLE,
        None,
    ]
    assert "password" in outcomes[2].describe()
    assert len(storage.objects) == 3


@pytest.mark.parametrize(
    ("action", "allowed", "code"),
    [
        (FileScanFallbackAction.BLOCK, False, ScanErrorCode.UNSCANNABLE),
        (FileScanFallbackAction.ALLOW, True, None),
    ],
)
def test_unscannable_file_follows_the_policy(
    sqlite_session_factory: sessionmaker[Session],
    storage: _Storage,
    monkeypatch: pytest.MonkeyPatch,
    action: FileScanFallbackAction,
    allowed: bool,
    code: ScanErrorCode | None,
) -> None:
    _use_scanner(monkeypatch, ScanVerdict.unscannable(ScanProblem.TOO_LARGE, size_limit=1024))
    _, upload_file_id = _seed(sqlite_session_factory, storage, on_unscannable=action)
    service, _ = _service(sqlite_session_factory)

    outcome = _scan(service, upload_file_id)

    assert (outcome.allowed, outcome.code, outcome.unscanned) == (allowed, code, allowed)
    assert outcome.size_limit == 1024
    assert storage.objects != {}


@pytest.mark.parametrize(
    ("action", "allowed", "code"),
    [
        (FileScanFallbackAction.BLOCK, False, ScanErrorCode.UNAVAILABLE),
        (FileScanFallbackAction.ALLOW, True, None),
    ],
)
def test_unreachable_scanner_is_retried_then_follows_the_policy(
    sqlite_session_factory: sessionmaker[Session],
    storage: _Storage,
    monkeypatch: pytest.MonkeyPatch,
    action: FileScanFallbackAction,
    allowed: bool,
    code: ScanErrorCode | None,
) -> None:
    scanner = _use_scanner(monkeypatch, ScanVerdict.unavailable(ScanProblem.NETWORK))
    _, upload_file_id = _seed(sqlite_session_factory, storage, on_unavailable=action)
    service, sleeps = _service(sqlite_session_factory)

    outcome = _scan(service, upload_file_id)

    assert (outcome.allowed, outcome.code, outcome.unscanned) == (allowed, code, allowed)
    assert len(scanner.external_ids) == 3
    assert sleeps == [2.0, 4.0]
    assert len(_records(sqlite_session_factory)) == 1


def test_scanner_that_recovers_during_retries_gives_a_normal_verdict(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    scanner = _use_scanner(monkeypatch, ScanVerdict.unavailable(ScanProblem.TIMEOUT), ScanVerdict.clean())
    _, upload_file_id = _seed(sqlite_session_factory, storage)
    service, _ = _service(sqlite_session_factory)

    assert _scan(service, upload_file_id).allowed
    assert len(scanner.external_ids) == 2


@pytest.mark.parametrize(
    ("problem", "code"),
    [
        (ScanProblem.AUTH, ScanErrorCode.PROVIDER_AUTH_FAILED),
        (ScanProblem.QUOTA, ScanErrorCode.PROVIDER_QUOTA_EXCEEDED),
    ],
)
def test_invalid_key_and_exhausted_quota_stop_the_file_even_when_the_policy_allows(
    sqlite_session_factory: sessionmaker[Session],
    storage: _Storage,
    monkeypatch: pytest.MonkeyPatch,
    problem: ScanProblem,
    code: ScanErrorCode,
) -> None:
    scanner = _use_scanner(monkeypatch, ScanVerdict.unavailable(problem, message="HTTP 401"))
    provider_id, upload_file_id = _seed(sqlite_session_factory, storage, on_unavailable=FileScanFallbackAction.ALLOW)
    service, sleeps = _service(sqlite_session_factory)

    outcome = _scan(service, upload_file_id)

    assert not outcome.allowed
    assert outcome.code is code
    assert outcome.retryable
    assert len(scanner.external_ids) == 1
    assert sleeps == []
    assert "Company scanner" in outcome.describe()
    with sqlite_session_factory() as session:
        provider = session.get(FileScanProvider, provider_id)
        assert provider is not None
        assert provider.status == FileScanProviderStatus.ERROR
        assert provider.last_error == "HTTP 401"

    # A later successful scan clears the provider's error state.
    scanner.verdicts = [ScanVerdict.clean()]
    assert _scan(service, upload_file_id).allowed
    with sqlite_session_factory() as session:
        provider = session.get(FileScanProvider, provider_id)
        assert provider is not None
        assert provider.status == FileScanProviderStatus.ACTIVE
        assert provider.last_error is None


def test_infected_verdict_is_reused_forever_and_clean_verdict_until_it_expires(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    scanner = _use_scanner(monkeypatch, ScanVerdict.clean())
    _, first = _seed(sqlite_session_factory, storage)
    _, second = _seed(sqlite_session_factory, storage, upload_file_id="55555555-5555-4555-8555-555555555556")
    service, _ = _service(sqlite_session_factory)

    assert _scan(service, first).allowed
    assert _scan(service, second).allowed
    assert len(scanner.external_ids) == 1

    with sqlite_session_factory.begin() as session:
        for record in session.scalars(select(FileScanRecord)):
            record.created_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=25)
    scanner.verdicts = [ScanVerdict.infected(["Late.Detection"])]
    late = _scan(service, second)
    assert late.code is ScanErrorCode.MALWARE_DETECTED
    assert len(scanner.external_ids) == 2

    scanner.verdicts = [ScanVerdict.clean()]
    reused = _scan(service, first)
    assert reused.code is ScanErrorCode.MALWARE_DETECTED
    assert reused.threats == ("Late.Detection",)
    assert len(scanner.external_ids) == 2


def test_file_without_a_hash_is_always_scanned(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    scanner = _use_scanner(monkeypatch, ScanVerdict.clean())
    _, upload_file_id = _seed(sqlite_session_factory, storage, file_hash=None)
    service, _ = _service(sqlite_session_factory)

    _scan(service, upload_file_id)
    _scan(service, upload_file_id)

    assert len(scanner.external_ids) == 2


def test_single_attempt_reports_a_running_scan_as_pending_and_the_next_call_resumes_it(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    scanner = _use_scanner(
        monkeypatch,
        ScanVerdict.unavailable(ScanProblem.PENDING, external_id="data-1"),
        ScanVerdict.clean(external_id="data-1"),
    )
    _, upload_file_id = _seed(sqlite_session_factory, storage, on_unavailable=FileScanFallbackAction.ALLOW)
    service, sleeps = _service(sqlite_session_factory)

    pending = _scan(service, upload_file_id, wait_for_result=False)
    assert (pending.allowed, pending.code, pending.retryable) == (False, ScanErrorCode.PENDING, True)
    assert scanner.external_ids == [None]

    resumed = _scan(service, upload_file_id, wait_for_result=False)
    assert resumed.allowed
    assert scanner.external_ids == [None, "data-1"]
    assert sleeps == []


def test_waiting_caller_keeps_polling_a_running_scan_without_backoff(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    scanner = _use_scanner(
        monkeypatch,
        ScanVerdict.unavailable(ScanProblem.PENDING, external_id="data-1"),
        ScanVerdict.unavailable(ScanProblem.PENDING, external_id="data-1"),
        ScanVerdict.infected(["Evil"], external_id="data-1"),
    )
    _, upload_file_id = _seed(sqlite_session_factory, storage)
    service, sleeps = _service(sqlite_session_factory)

    assert _scan(service, upload_file_id).code is ScanErrorCode.MALWARE_DETECTED
    assert scanner.external_ids == [None, "data-1", "data-1"]
    assert sleeps == []


def test_missing_provider_missing_file_and_broken_settings_block_with_a_reason(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider_id, upload_file_id = _seed(sqlite_session_factory, storage)
    service, _ = _service(sqlite_session_factory)

    assert _scan(service, "66666666-6666-4666-8666-666666666666").code is ScanErrorCode.FILE_MISSING
    other_tenant = service.scan_upload_file(tenant_id=OTHER_TENANT_ID, upload_file_id=upload_file_id, scope=SCOPE)
    assert other_tenant.status == "disabled"

    def broken(_tenant_id: str, _provider: FileScanProvider) -> FileScanner:
        raise ScannerConfigError("ClamAV is not configured for this deployment")

    monkeypatch.setattr(service_module, "build_scanner", broken)
    assert _scan(service, upload_file_id).code is ScanErrorCode.PROVIDER_AUTH_FAILED

    with sqlite_session_factory.begin() as session:
        session.delete(session.get(FileScanProvider, provider_id))
    missing = _scan(service, upload_file_id)
    assert missing.code is ScanErrorCode.PROVIDER_MISSING
    assert "settings" in missing.describe()


def test_unexpected_failure_stops_only_this_file_and_never_raises(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(_tenant_id: str, _provider: FileScanProvider) -> FileScanner:
        raise RuntimeError("decryption failed")

    monkeypatch.setattr(service_module, "build_scanner", explode)
    _, upload_file_id = _seed(sqlite_session_factory, storage)
    service, _ = _service(sqlite_session_factory)

    outcome = _scan(service, upload_file_id)

    assert (outcome.allowed, outcome.code) == (False, ScanErrorCode.UNAVAILABLE)


# --- policies and providers


def test_policy_defaults_validation_and_scope_cleanup(sqlite_session_factory: sessionmaker[Session]) -> None:
    policies = FileScanPolicyService(sqlite_session_factory)

    assert policies.get(tenant_id=TENANT_ID, scope=SCOPE) == ScanPolicy()
    with pytest.raises(FileScanValidationError):
        policies.set(tenant_id=TENANT_ID, scope=SCOPE, policy=ScanPolicy(enabled=True), account_id=ACCOUNT_ID)
    with pytest.raises(FileScanValidationError):
        policies.set(
            tenant_id=TENANT_ID,
            scope=SCOPE,
            policy=ScanPolicy(enabled=True, provider_id="77777777-7777-4777-8777-777777777777"),
            account_id=ACCOUNT_ID,
        )

    with sqlite_session_factory.begin() as session:
        provider = FileScanProvider(tenant_id=TENANT_ID, name="Scanner", provider_type="scanii")
        session.add(provider)
        session.flush()
        provider_id = provider.id
    wanted = ScanPolicy(
        enabled=True,
        provider_id=provider_id,
        on_unavailable=FileScanFallbackAction.ALLOW,
        on_unscannable=FileScanFallbackAction.BLOCK,
    )
    assert policies.set(tenant_id=TENANT_ID, scope=SCOPE, policy=wanted, account_id=ACCOUNT_ID) == wanted
    assert policies.get(tenant_id=TENANT_ID, scope=SCOPE) == wanted
    assert policies.get(tenant_id=OTHER_TENANT_ID, scope=SCOPE) == ScanPolicy()
    with pytest.raises(FileScanValidationError):
        policies.set(tenant_id=OTHER_TENANT_ID, scope=SCOPE, policy=wanted, account_id=ACCOUNT_ID)

    policies.delete_scope(tenant_id=TENANT_ID, scope=SCOPE)
    assert policies.get(tenant_id=TENANT_ID, scope=SCOPE) == ScanPolicy()


class _CheckedScanner(_Scanner):
    checks: ClassVar[int] = 0
    fail_with: ClassVar[Exception | None] = None
    credential_fields: ClassVar[tuple[str, ...]] = ("api_key",)
    destination_fields: ClassVar[tuple[str, ...]] = ("endpoint",)
    seen_credentials: ClassVar[list[dict[str, str]]] = []

    def __init__(self, credentials: Mapping[str, str], config: Mapping[str, object]) -> None:
        super().__init__(ScanVerdict.clean())
        self.credentials, self.config = credentials, config

    @classmethod
    @override
    def validate_settings(cls, credentials: Mapping[str, str], config: Mapping[str, object]) -> None:
        del config
        if not credentials.get("api_key"):
            raise ScannerConfigError("api_key is required")

    @override
    def check(self) -> None:
        type(self).checks += 1
        type(self).seen_credentials.append(dict(self.credentials))
        failure = type(self).fail_with
        if failure is not None:
            raise failure


@pytest.fixture
def checked_scanner(monkeypatch: pytest.MonkeyPatch) -> type[_CheckedScanner]:
    _CheckedScanner.checks = 0
    _CheckedScanner.seen_credentials.clear()
    _CheckedScanner.fail_with = None
    classes = {**provider_module.SCANNER_CLASSES, ScanProviderType.CLOUDMERSIVE: _CheckedScanner}
    monkeypatch.setattr(provider_module, "SCANNER_CLASSES", classes)
    monkeypatch.setattr(provider_module, "scanner_class", lambda provider_type: classes[provider_type])
    monkeypatch.setattr(
        provider_module,
        "create_scanner",
        lambda provider_type, *, credentials, config: classes[provider_type](credentials, config),
    )
    return _CheckedScanner


def test_provider_is_checked_before_saving_and_never_returns_its_secret(
    sqlite_session_factory: sessionmaker[Session], checked_scanner: type[_CheckedScanner]
) -> None:
    providers = FileScanProviderService(sqlite_session_factory)

    with pytest.raises(FileScanValidationError, match="api_key is required"):
        providers.create(
            tenant_id=TENANT_ID,
            account_id=ACCOUNT_ID,
            name="Scanner",
            provider_type="cloudmersive",
            config={},
            credentials={},
        )
    assert providers.list(tenant_id=TENANT_ID) == []

    created = providers.create(
        tenant_id=TENANT_ID,
        account_id=ACCOUNT_ID,
        name="  Scanner  ",
        provider_type="cloudmersive",
        config={"endpoint": "https://private.example"},
        credentials={"api_key": "top-secret", "ignored": "value"},
    )

    assert checked_scanner.checks == 1
    assert (created.name, created.credentials_set, created.status) == ("Scanner", {"api_key": True}, "active")
    assert "top-secret" not in repr(created)
    with sqlite_session_factory() as session:
        row = session.get(FileScanProvider, created.id)
        assert row is not None
        assert row.encrypted_credentials == 'enc:{"api_key": "top-secret"}'

    with pytest.raises(FileScanValidationError, match="already exists"):
        providers.create(
            tenant_id=TENANT_ID,
            account_id=ACCOUNT_ID,
            name="Scanner",
            provider_type="cloudmersive",
            config={},
            credentials={"api_key": "other"},
        )
    with pytest.raises(FileScanValidationError, match="Unknown scanner type"):
        providers.create(
            tenant_id=TENANT_ID,
            account_id=ACCOUNT_ID,
            name="X",
            provider_type="virustotal",
            config={},
            credentials={},
        )
    assert providers.list(tenant_id=OTHER_TENANT_ID) == []


def test_provider_update_keeps_the_stored_secret_and_failed_checks_do_not_save(
    sqlite_session_factory: sessionmaker[Session], checked_scanner: type[_CheckedScanner]
) -> None:
    providers = FileScanProviderService(sqlite_session_factory)
    created = providers.create(
        tenant_id=TENANT_ID,
        account_id=ACCOUNT_ID,
        name="Scanner",
        provider_type="cloudmersive",
        config={},
        credentials={"api_key": "first"},
    )

    renamed = providers.update(tenant_id=TENANT_ID, provider_id=created.id, name="Renamed", credentials={"api_key": ""})
    assert renamed.name == "Renamed"
    with sqlite_session_factory() as session:
        row = session.get(FileScanProvider, created.id)
        assert row is not None
        assert row.encrypted_credentials == 'enc:{"api_key": "first"}'

    checked_scanner.fail_with = ScannerError(ScanProblem.AUTH, "HTTP 401")
    with pytest.raises(FileScanValidationError, match="auth"):
        providers.update(tenant_id=TENANT_ID, provider_id=created.id, credentials={"api_key": "wrong"})
    with sqlite_session_factory() as session:
        row = session.get(FileScanProvider, created.id)
        assert row is not None
        assert row.encrypted_credentials == 'enc:{"api_key": "first"}'

    tested = providers.test(tenant_id=TENANT_ID, provider_id=created.id)
    assert (tested.status, tested.last_error) == ("error", "HTTP 401")
    checked_scanner.fail_with = None
    assert providers.test(tenant_id=TENANT_ID, provider_id=created.id).status == "active"


@pytest.mark.usefixtures("checked_scanner")
def test_provider_in_use_cannot_be_deleted(sqlite_session_factory: sessionmaker[Session]) -> None:
    providers = FileScanProviderService(sqlite_session_factory)
    policies = FileScanPolicyService(sqlite_session_factory)
    created = providers.create(
        tenant_id=TENANT_ID,
        account_id=ACCOUNT_ID,
        name="Scanner",
        provider_type="cloudmersive",
        config={},
        credentials={"api_key": "k"},
    )
    policies.set(
        tenant_id=TENANT_ID, scope=SCOPE, policy=ScanPolicy(enabled=True, provider_id=created.id), account_id=None
    )

    assert providers.list(tenant_id=TENANT_ID)[0].policy_count == 1
    with pytest.raises(FileScanProviderInUseError):
        providers.delete(tenant_id=TENANT_ID, provider_id=created.id)

    policies.delete_scope(tenant_id=TENANT_ID, scope=SCOPE)
    providers.delete(tenant_id=TENANT_ID, provider_id=created.id)
    assert providers.list(tenant_id=TENANT_ID) == []


def test_clamav_is_offered_only_when_the_deployment_configures_it(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(provider_module.dify_config, "FILE_SCAN_CLAMAV_HOST", "")
    available = {item.provider_type: item.available for item in FileScanProviderService.provider_types()}
    assert available == {
        "clamav": False,
        "cloudmersive": True,
        "scanii": True,
        "metadefender": True,
        "api": True,
    }

    monkeypatch.setattr(provider_module.dify_config, "FILE_SCAN_CLAMAV_HOST", "clamav")
    assert FileScanProviderService.provider_types()[0].available


def test_scan_content_scans_bytes_that_are_not_stored_yet_under_the_scope_policy(
    sqlite_session_factory: sessionmaker[Session], storage: _Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    scanner = _use_scanner(monkeypatch, ScanVerdict.infected(["Evil.A"]))
    _seed(sqlite_session_factory, storage)
    service, _ = _service(sqlite_session_factory)

    outcome = service.scan_content(
        tenant_id=TENANT_ID, scope=SCOPE, file_name="direct.pdf", mime_type="application/pdf", content=b"bytes"
    )

    assert (outcome.allowed, outcome.code, outcome.file_name) == (False, ScanErrorCode.MALWARE_DETECTED, "direct.pdf")
    assert scanner.external_ids == [None]
    [record] = _records(sqlite_session_factory)
    assert (record.upload_file_id, record.file_size, record.scope_id) == (None, 5, SCOPE.id)
    assert len(record.file_hash) == 64
    # Nothing was stored, so there is nothing to delete; the seeded upload file is untouched.
    assert len(storage.objects) == 1

    other_scope = ScanScope("knowledge_fs_space", "no-policy")
    unscoped = service.scan_content(
        tenant_id=TENANT_ID, scope=other_scope, file_name="a.txt", mime_type="text/plain", content=b"x"
    )
    assert unscoped.status == "disabled"


def test_dataset_scope_exists_only_for_a_dataset_of_the_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset_id = "88888888-8888-4888-8888-888888888888"
    with sqlite_session_factory.begin() as session:
        dataset = Dataset(tenant_id=TENANT_ID, name="Docs", created_by=ACCOUNT_ID)
        dataset.id = dataset_id
        session.add(dataset)
    policies = FileScanPolicyService(sqlite_session_factory)

    assert policies.dataset_scope(tenant_id=TENANT_ID, dataset_id=dataset_id) == ScanScope("dataset", dataset_id)
    assert policies.dataset_scope(tenant_id=OTHER_TENANT_ID, dataset_id=dataset_id) is None
    assert policies.dataset_scope(tenant_id=TENANT_ID, dataset_id="99999999-9999-4999-8999-999999999999") is None


def test_stored_key_is_never_sent_to_a_new_address_unless_it_is_entered_again(
    sqlite_session_factory: sessionmaker[Session], checked_scanner: type[_CheckedScanner]
) -> None:
    providers = FileScanProviderService(sqlite_session_factory)
    created = providers.create(
        tenant_id=TENANT_ID,
        account_id=ACCOUNT_ID,
        name="Scanner",
        provider_type="cloudmersive",
        config={"endpoint": "https://vendor.example"},
        credentials={"api_key": "stored-secret"},
    )
    checked_scanner.seen_credentials.clear()

    with pytest.raises(FileScanValidationError, match="Enter the credentials again"):
        providers.update(tenant_id=TENANT_ID, provider_id=created.id, config={"endpoint": "https://collector.example"})
    with pytest.raises(FileScanValidationError, match="Enter the credentials again"):
        providers.update(tenant_id=TENANT_ID, provider_id=created.id, config={})

    # No connectivity check ran, so the stored key went nowhere, and nothing was saved.
    assert checked_scanner.seen_credentials == []
    assert providers.list(tenant_id=TENANT_ID)[0].config == {"endpoint": "https://vendor.example"}

    # The same address, or a new address together with a newly entered key, is accepted.
    providers.update(
        tenant_id=TENANT_ID, provider_id=created.id, name="Renamed", config={"endpoint": "https://vendor.example"}
    )
    moved = providers.update(
        tenant_id=TENANT_ID,
        provider_id=created.id,
        config={"endpoint": "https://other.example"},
        credentials={"api_key": "new-secret"},
    )
    assert moved.config == {"endpoint": "https://other.example"}
    assert checked_scanner.seen_credentials[-1] == {"api_key": "new-secret"}


def test_custom_endpoint_keeps_its_own_address_and_key(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.file_scan.scanners import api as api_module

    calls: list[tuple[str, dict[str, object]]] = []

    def respond(method: str, url: str, **kwargs: object) -> httpx.Response:
        del method
        calls.append((url, kwargs))
        return httpx.Response(200, json={"verdict": "clean"})

    monkeypatch.setattr(api_module, "http_request", respond)
    providers = FileScanProviderService(sqlite_session_factory)

    with pytest.raises(FileScanValidationError, match="endpoint must be an http or https URL"):
        providers.create(
            tenant_id=TENANT_ID,
            account_id=ACCOUNT_ID,
            name="Mine",
            provider_type="api",
            config={"endpoint": "ftp://scanner.example"},
            credentials={"api_key": "secret"},
        )
    with pytest.raises(FileScanValidationError, match="api_key is required"):
        providers.create(
            tenant_id=TENANT_ID,
            account_id=ACCOUNT_ID,
            name="Mine",
            provider_type="api",
            config={"endpoint": "https://scanner.example/scan"},
            credentials={},
        )
    assert calls == []

    created = providers.create(
        tenant_id=TENANT_ID,
        account_id=ACCOUNT_ID,
        name="Mine",
        provider_type="api",
        config={"endpoint": "https://scanner.example/scan"},
        credentials={"api_key": "secret"},
    )

    assert (created.config, created.credentials_set) == (
        {"endpoint": "https://scanner.example/scan"},
        {"api_key": True},
    )
    url, kwargs = calls[0]
    assert url == "https://scanner.example/scan"
    assert kwargs["headers"] == {"Authorization": "Bearer secret"}

    # The stored key is not sent to a different address unless it is entered again.
    with pytest.raises(FileScanValidationError, match="Enter the credentials again"):
        providers.update(tenant_id=TENANT_ID, provider_id=created.id, config={"endpoint": "https://collector.example"})
    assert len(calls) == 1
