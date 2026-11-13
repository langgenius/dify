import hashlib
import logging
import time
from collections.abc import Callable
from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.db.session_factory import session_factory
from core.file_scan.base import FileScanner, ScannerConfigError
from core.file_scan.entities import ScanProblem, ScanStatus, ScanTarget, ScanVerdict
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models.file_scan import (
    FileScanFallbackAction,
    FileScanProvider,
    FileScanProviderStatus,
    FileScanRecord,
    FileScanRecordStatus,
)
from models.model import UploadFile
from services.file_scan.entities import ScanErrorCode, ScanOutcome, ScanPolicy, ScanScope
from services.file_scan.policy_service import FileScanPolicyService
from services.file_scan.provider_service import build_scanner

logger = logging.getLogger(__name__)

RETRY_BACKOFF_SECONDS = 2.0


class FileScanService:
    """The one entry point product modules call to have a stored file scanned for malware.

    Neither method raises for a scanning problem: the result is a ``ScanOutcome`` and the caller
    stops its own pipeline when ``outcome.allowed`` is false. One file's outcome never depends on
    another file, so a caller that processes a batch can keep going.

    Rules applied here for every module:

    - malware always blocks, and the stored original is deleted;
    - an unscannable file (encrypted, too large) follows the policy's ``on_unscannable``;
    - a temporarily unreachable scanner is retried, then follows ``on_unavailable``;
    - invalid credentials and exhausted quota block without retry and regardless of
      ``on_unavailable``: allowing would hide from administrators that nothing is being scanned.
    """

    def __init__(
        self,
        session_maker: sessionmaker[Session] | None = None,
        *,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._session_maker = session_maker or session_factory.get_session_maker()
        self._sleep = sleep

    def is_enabled(self, *, tenant_id: str, scope: ScanScope) -> bool:
        if not dify_config.FILE_SCAN_ENABLED:
            return False
        return FileScanPolicyService(self._session_maker).get(tenant_id=tenant_id, scope=scope).enabled

    def scan_upload_file(
        self,
        *,
        tenant_id: str,
        upload_file_id: str,
        scope: ScanScope,
        wait_for_result: bool = True,
    ) -> ScanOutcome:
        """Scan an ``UploadFile`` under the policy of ``scope``.

        ``wait_for_result=False`` makes a single attempt, for callers inside a web request; a scan
        that is still running then comes back as ``ScanErrorCode.PENDING`` and can be asked again.
        """
        if not dify_config.FILE_SCAN_ENABLED:
            return _disabled()
        policy = FileScanPolicyService(self._session_maker).get(tenant_id=tenant_id, scope=scope)
        if not policy.enabled:
            return _disabled()

        with self._session_maker() as session:
            upload_file = session.scalar(
                select(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.id == upload_file_id)
            )
            if upload_file is None:
                return ScanOutcome(allowed=False, status=ScanStatus.UNAVAILABLE.value, code=ScanErrorCode.FILE_MISSING)
            key, file_name, size = upload_file.key, upload_file.name, upload_file.size
            mime_type, file_hash = upload_file.mime_type or "", upload_file.hash or ""

        target = ScanTarget(
            scan_id=str(uuid4()),
            file_name=file_name,
            size=size,
            mime_type=mime_type,
            file_hash=file_hash,
            load=lambda: storage.load_once(key),
        )
        outcome = self.scan(
            tenant_id=tenant_id,
            target=target,
            policy=policy,
            scope=scope,
            upload_file_id=upload_file_id,
            wait_for_result=wait_for_result,
        )
        if outcome.code is ScanErrorCode.MALWARE_DETECTED:
            try:
                storage.delete(key)
            except Exception:
                logger.exception("Failed to delete infected upload file %s", upload_file_id)
        return outcome

    def scan_content(
        self,
        *,
        tenant_id: str,
        scope: ScanScope,
        file_name: str,
        mime_type: str,
        content: bytes,
    ) -> ScanOutcome:
        """Scan bytes that are not stored as an ``UploadFile`` yet, under the policy of ``scope``."""
        if not dify_config.FILE_SCAN_ENABLED:
            return _disabled()
        policy = FileScanPolicyService(self._session_maker).get(tenant_id=tenant_id, scope=scope)
        target = ScanTarget(
            scan_id=str(uuid4()),
            file_name=file_name,
            size=len(content),
            mime_type=mime_type,
            file_hash=hashlib.sha3_256(content).hexdigest(),
            load=lambda: content,
        )
        return self.scan(tenant_id=tenant_id, target=target, policy=policy, scope=scope)

    def scan(
        self,
        *,
        tenant_id: str,
        target: ScanTarget,
        policy: ScanPolicy,
        scope: ScanScope | None = None,
        upload_file_id: str | None = None,
        wait_for_result: bool = True,
    ) -> ScanOutcome:
        """Scan any content under an explicit policy. For files that are not ``UploadFile`` rows."""
        if not policy.enabled:
            return _disabled()
        try:
            return self._scan(
                tenant_id=tenant_id,
                target=target,
                policy=policy,
                scope=scope,
                upload_file_id=upload_file_id,
                wait_for_result=wait_for_result,
            )
        except Exception:
            # Storage, database or decryption trouble must stop this file only, never the caller.
            logger.exception("File scan failed unexpectedly for %s", target.file_name)
            return self._outcome_for_unavailable(policy, file_name=target.file_name)

    def _scan(
        self,
        *,
        tenant_id: str,
        target: ScanTarget,
        policy: ScanPolicy,
        scope: ScanScope | None,
        upload_file_id: str | None,
        wait_for_result: bool,
    ) -> ScanOutcome:
        with self._session_maker() as session:
            provider = (
                session.scalar(
                    select(FileScanProvider).where(
                        FileScanProvider.tenant_id == tenant_id, FileScanProvider.id == policy.provider_id
                    )
                )
                if policy.provider_id
                else None
            )
            if provider is None:
                return ScanOutcome(
                    allowed=False,
                    status=ScanStatus.UNAVAILABLE.value,
                    code=ScanErrorCode.PROVIDER_MISSING,
                    file_name=target.file_name,
                )
            provider_id, provider_name, provider_type = provider.id, provider.name, provider.provider_type

            reused = _reusable_record(session, tenant_id=tenant_id, provider_id=provider_id, file_hash=target.file_hash)
            if reused is not None:
                return _outcome_from_record(reused, file_name=target.file_name)

            external_id = _pending_external_id(
                session, tenant_id=tenant_id, provider_id=provider_id, upload_file_id=upload_file_id
            )
            scanner: FileScanner | None = None
            config_error = ""
            try:
                scanner = build_scanner(tenant_id, provider)
            except ScannerConfigError as error:
                config_error = str(error)

        if scanner is None:
            # The provider can no longer be built (for example ClamAV was removed from the
            # deployment). An administrator has to act, exactly as for invalid credentials.
            verdict = ScanVerdict.unavailable(ScanProblem.AUTH, message=config_error)
        else:
            verdict = self._scan_with_retries(scanner, target, external_id, wait_for_result=wait_for_result)

        outcome = self._decide(
            verdict,
            policy,
            file_name=target.file_name,
            provider_name=provider_name,
            provider_type=provider_type,
            wait_for_result=wait_for_result,
        )
        record_id = self._record(
            tenant_id=tenant_id,
            provider_id=provider_id,
            provider_name=provider_name,
            provider_type=provider_type,
            target=target,
            verdict=verdict,
            outcome=outcome,
            scope=scope,
            upload_file_id=upload_file_id,
        )
        return _with_record(outcome, record_id)

    def _scan_with_retries(
        self, scanner: FileScanner, target: ScanTarget, external_id: str | None, *, wait_for_result: bool
    ) -> ScanVerdict:
        """Ask the scanner, repeating only for transient failures and scans that are still running."""
        attempts = dify_config.FILE_SCAN_MAX_ATTEMPTS if wait_for_result else 1
        verdict = scanner.scan(target, external_id=external_id)
        for attempt in range(1, attempts):
            if not verdict.retryable:
                break
            if verdict.problem is not ScanProblem.PENDING:
                self._sleep(RETRY_BACKOFF_SECONDS * attempt)
            verdict = scanner.scan(target, external_id=verdict.external_id or external_id)
        return verdict

    def _decide(
        self,
        verdict: ScanVerdict,
        policy: ScanPolicy,
        *,
        file_name: str,
        provider_name: str,
        provider_type: str,
        wait_for_result: bool,
    ) -> ScanOutcome:
        def outcome(allowed: bool, code: ScanErrorCode | None, *, unscanned: bool = False) -> ScanOutcome:
            return ScanOutcome(
                allowed=allowed,
                status=verdict.status.value,
                code=code,
                file_name=file_name,
                provider_name=provider_name,
                provider_type=provider_type,
                problem=verdict.problem.value if verdict.problem else None,
                threats=verdict.threats,
                size_limit=verdict.size_limit,
                unscanned=unscanned,
            )

        if verdict.status is ScanStatus.CLEAN:
            return outcome(True, None)
        if verdict.status is ScanStatus.INFECTED:
            return outcome(False, ScanErrorCode.MALWARE_DETECTED)
        if verdict.status is ScanStatus.UNSCANNABLE:
            if policy.on_unscannable is FileScanFallbackAction.ALLOW:
                return outcome(True, None, unscanned=True)
            return outcome(False, ScanErrorCode.UNSCANNABLE)
        if verdict.problem is ScanProblem.AUTH:
            return outcome(False, ScanErrorCode.PROVIDER_AUTH_FAILED)
        if verdict.problem is ScanProblem.QUOTA:
            return outcome(False, ScanErrorCode.PROVIDER_QUOTA_EXCEEDED)
        if verdict.problem is ScanProblem.PENDING and not wait_for_result:
            return outcome(False, ScanErrorCode.PENDING)
        if policy.on_unavailable is FileScanFallbackAction.ALLOW:
            return outcome(True, None, unscanned=True)
        return outcome(False, ScanErrorCode.UNAVAILABLE)

    @staticmethod
    def _outcome_for_unavailable(policy: ScanPolicy, *, file_name: str) -> ScanOutcome:
        allowed = policy.on_unavailable is FileScanFallbackAction.ALLOW
        return ScanOutcome(
            allowed=allowed,
            status=ScanStatus.UNAVAILABLE.value,
            code=None if allowed else ScanErrorCode.UNAVAILABLE,
            file_name=file_name,
            unscanned=allowed,
        )

    def _record(
        self,
        *,
        tenant_id: str,
        provider_id: str,
        provider_name: str,
        provider_type: str,
        target: ScanTarget,
        verdict: ScanVerdict,
        outcome: ScanOutcome,
        scope: ScanScope | None,
        upload_file_id: str | None,
    ) -> str | None:
        """Store the verdict and keep the provider's health in step with it."""
        try:
            with self._session_maker() as session:
                record = FileScanRecord(
                    tenant_id=tenant_id,
                    provider_id=provider_id,
                    provider_type=provider_type,
                    provider_name=provider_name,
                    file_hash=target.file_hash,
                    file_name=target.file_name[:255],
                    file_size=target.size,
                    status=FileScanRecordStatus(verdict.status.value),
                    allowed=outcome.allowed,
                    upload_file_id=upload_file_id,
                    scope_type=scope.type if scope else None,
                    scope_id=scope.id if scope else None,
                    problem=verdict.problem.value if verdict.problem else None,
                    threats=list(verdict.threats),
                    engine=verdict.engine,
                    message=verdict.message,
                    external_id=verdict.external_id,
                    size_limit=verdict.size_limit,
                )
                session.add(record)
                provider = session.get(FileScanProvider, provider_id)
                if provider is not None:
                    if verdict.problem in (ScanProblem.AUTH, ScanProblem.QUOTA):
                        provider.status = FileScanProviderStatus.ERROR
                        provider.last_error = (verdict.message or verdict.problem.value)[:255]
                    elif verdict.status in (ScanStatus.CLEAN, ScanStatus.INFECTED):
                        provider.status = FileScanProviderStatus.ACTIVE
                        provider.last_error = None
                session.commit()
                return record.id
        except Exception:
            logger.exception("Failed to store the file scan record for %s", target.file_name)
            return None


def _disabled() -> ScanOutcome:
    return ScanOutcome(allowed=True, status="disabled")


def _with_record(outcome: ScanOutcome, record_id: str | None) -> ScanOutcome:
    return replace(outcome, record_id=record_id)


def _reusable_record(session: Session, *, tenant_id: str, provider_id: str, file_hash: str) -> FileScanRecord | None:
    """An earlier verdict for the same content under the same provider.

    Infected verdicts are reused forever. Clean verdicts expire because signatures are updated.
    """
    if not file_hash:
        return None
    latest = session.scalar(
        select(FileScanRecord)
        .where(
            FileScanRecord.tenant_id == tenant_id,
            FileScanRecord.provider_id == provider_id,
            FileScanRecord.file_hash == file_hash,
            FileScanRecord.status.in_([FileScanRecordStatus.CLEAN, FileScanRecordStatus.INFECTED]),
        )
        .order_by(FileScanRecord.created_at.desc())
        .limit(1)
    )
    if latest is None:
        return None
    if latest.status == FileScanRecordStatus.INFECTED:
        return latest
    ttl = timedelta(hours=dify_config.FILE_SCAN_CLEAN_VERDICT_TTL_HOURS)
    return latest if latest.created_at >= naive_utc_now() - ttl else None


def _pending_external_id(
    session: Session, *, tenant_id: str, provider_id: str, upload_file_id: str | None
) -> str | None:
    """The scanner-side id of a scan a previous attempt submitted and left running."""
    if upload_file_id is None:
        return None
    latest = session.scalar(
        select(FileScanRecord)
        .where(
            FileScanRecord.tenant_id == tenant_id,
            FileScanRecord.provider_id == provider_id,
            FileScanRecord.upload_file_id == upload_file_id,
        )
        .order_by(FileScanRecord.created_at.desc())
        .limit(1)
    )
    if latest is None or latest.problem != ScanProblem.PENDING.value:
        return None
    return latest.external_id


def _outcome_from_record(record: FileScanRecord, *, file_name: str) -> ScanOutcome:
    infected = record.status == FileScanRecordStatus.INFECTED
    return ScanOutcome(
        allowed=not infected,
        status=str(record.status.value if isinstance(record.status, FileScanRecordStatus) else record.status),
        code=ScanErrorCode.MALWARE_DETECTED if infected else None,
        file_name=file_name,
        provider_name=record.provider_name,
        provider_type=record.provider_type,
        threats=tuple(record.threats or ()),
        record_id=record.id,
    )
