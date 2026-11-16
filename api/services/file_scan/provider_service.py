import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.db.session_factory import session_factory
from core.file_scan.base import FileScanner, ScannerConfigError, ScannerError
from core.file_scan.entities import ScanProviderType
from core.file_scan.factory import SCANNER_CLASSES, create_scanner, scanner_class
from core.helper.encrypter import decrypt_token, encrypt_token
from libs.datetime_utils import naive_utc_now
from models.file_scan import FileScanPolicy, FileScanProvider, FileScanProviderStatus
from services.file_scan.errors import (
    FileScanProviderInUseError,
    FileScanProviderNotFoundError,
    FileScanValidationError,
)

logger = logging.getLogger(__name__)

MAX_NAME_LENGTH = 100


@dataclass(frozen=True)
class FileScanProviderView:
    """A provider as the console sees it: secrets are reduced to "is set" flags."""

    id: str
    name: str
    provider_type: str
    config: dict[str, Any]
    credentials_set: dict[str, bool]
    status: str
    last_error: str | None
    last_tested_at: datetime | None
    created_at: datetime
    policy_count: int


@dataclass(frozen=True)
class FileScanProviderTypeView:
    provider_type: str
    available: bool
    credential_fields: tuple[str, ...]


class FileScanProviderService:
    """Manages a workspace's scanner connections. Callers enforce the owner/admin role."""

    def __init__(self, session_maker: sessionmaker[Session] | None = None) -> None:
        self._session_maker = session_maker or session_factory.get_session_maker()

    @staticmethod
    def provider_types() -> list[FileScanProviderTypeView]:
        return [
            FileScanProviderTypeView(
                provider_type=provider_type.value,
                available=_type_available(provider_type),
                credential_fields=cls.credential_fields,
            )
            for provider_type, cls in SCANNER_CLASSES.items()
        ]

    def list(self, *, tenant_id: str) -> list[FileScanProviderView]:
        with self._session_maker() as session:
            rows = session.scalars(
                select(FileScanProvider)
                .where(FileScanProvider.tenant_id == tenant_id)
                .order_by(FileScanProvider.created_at, FileScanProvider.id)
            ).all()
            counts = {
                provider_id: count
                for provider_id, count in session.execute(
                    select(FileScanPolicy.provider_id, func.count())
                    .where(FileScanPolicy.tenant_id == tenant_id, FileScanPolicy.provider_id.is_not(None))
                    .group_by(FileScanPolicy.provider_id)
                )
                if provider_id is not None
            }
            return [_view(tenant_id, row, policy_count=counts.get(row.id, 0)) for row in rows]

    def create(
        self,
        *,
        tenant_id: str,
        account_id: str | None,
        name: str,
        provider_type: str,
        config: Mapping[str, Any],
        credentials: Mapping[str, str],
    ) -> FileScanProviderView:
        resolved_type = _provider_type(provider_type)
        cleaned_name = _name(name)
        cleaned_credentials = _credentials(resolved_type, credentials)
        cleaned_config = dict(config)
        with self._session_maker() as session:
            self._verify(resolved_type, cleaned_config, cleaned_credentials)
            row = FileScanProvider(
                tenant_id=tenant_id,
                name=cleaned_name,
                provider_type=resolved_type.value,
                config=cleaned_config,
                encrypted_credentials=_encrypt(tenant_id, cleaned_credentials),
                last_tested_at=naive_utc_now(),
                created_by=account_id,
            )
            session.add(row)
            _commit_unique_name(session)
            return _view(tenant_id, row, policy_count=0)

    def update(
        self,
        *,
        tenant_id: str,
        provider_id: str,
        name: str | None = None,
        config: Mapping[str, Any] | None = None,
        credentials: Mapping[str, str] | None = None,
    ) -> FileScanProviderView:
        """Change a provider. Credential fields left out or empty keep their stored value."""
        with self._session_maker() as session:
            row = _row(session, tenant_id, provider_id)
            resolved_type = ScanProviderType(row.provider_type)
            supplied_credentials = _credentials(resolved_type, credentials or {})
            merged_credentials = _decrypt(tenant_id, row.encrypted_credentials)
            merged_credentials.update(supplied_credentials)
            merged_config = dict(config) if config is not None else dict(row.config or {})
            _require_credentials_for_new_destination(
                resolved_type, stored_config=dict(row.config or {}), config=merged_config, supplied=supplied_credentials
            )
            self._verify(resolved_type, merged_config, merged_credentials)
            if name is not None:
                row.name = _name(name)
            row.config = merged_config
            row.encrypted_credentials = _encrypt(tenant_id, merged_credentials)
            row.status = FileScanProviderStatus.ACTIVE
            row.last_error = None
            row.last_tested_at = naive_utc_now()
            _commit_unique_name(session)
            return _view(tenant_id, row, policy_count=_policy_count(session, tenant_id, row.id))

    def test(self, *, tenant_id: str, provider_id: str) -> FileScanProviderView:
        """Run the connectivity check again and store its result."""
        with self._session_maker() as session:
            row = _row(session, tenant_id, provider_id)
            try:
                build_scanner(tenant_id, row).check()
            except (ScannerError, ScannerConfigError) as error:
                row.status = FileScanProviderStatus.ERROR
                row.last_error = str(error)[:255]
            else:
                row.status = FileScanProviderStatus.ACTIVE
                row.last_error = None
            row.last_tested_at = naive_utc_now()
            session.commit()
            return _view(tenant_id, row, policy_count=_policy_count(session, tenant_id, row.id))

    def delete(self, *, tenant_id: str, provider_id: str) -> None:
        with self._session_maker() as session:
            row = _row(session, tenant_id, provider_id)
            if _policy_count(session, tenant_id, row.id):
                raise FileScanProviderInUseError(
                    "This scanner is selected by at least one knowledge base. Choose another scanner there first."
                )
            session.delete(row)
            session.commit()

    @staticmethod
    def _verify(provider_type: ScanProviderType, config: dict[str, Any], credentials: dict[str, str]) -> None:
        """Validate the settings and prove them with a real connectivity check before saving."""
        if not _type_available(provider_type):
            raise FileScanValidationError("This scanner is not available on this deployment.")
        try:
            scanner_class(provider_type).validate_settings(credentials, _runtime_config(provider_type, config))
            _scanner(provider_type, config, credentials).check()
        except ScannerConfigError as error:
            raise FileScanValidationError(str(error)) from error
        except ScannerError as error:
            raise FileScanValidationError(f"The scanner check failed ({error.problem.value}): {error}") from error


def build_scanner(tenant_id: str, row: FileScanProvider) -> FileScanner:
    """Instantiate the scanner for a stored provider with decrypted credentials.

    Raises ``ScannerConfigError`` when the deployment no longer offers this scanner type.
    """
    provider_type = ScanProviderType(row.provider_type)
    if not _type_available(provider_type):
        raise ScannerConfigError("This scanner is not available on this deployment.")
    return _scanner(provider_type, dict(row.config or {}), _decrypt(tenant_id, row.encrypted_credentials))


def _scanner(provider_type: ScanProviderType, config: dict[str, Any], credentials: dict[str, str]) -> FileScanner:
    return create_scanner(provider_type, credentials=credentials, config=_runtime_config(provider_type, config))


def _runtime_config(provider_type: ScanProviderType, config: dict[str, Any]) -> dict[str, Any]:
    """Add what is not stored on the provider: deployment settings."""
    runtime = dict(config)
    runtime["timeout"] = dify_config.FILE_SCAN_REQUEST_TIMEOUT_SECONDS
    if provider_type is ScanProviderType.CLAMAV:
        runtime["host"] = dify_config.FILE_SCAN_CLAMAV_HOST
        runtime["port"] = dify_config.FILE_SCAN_CLAMAV_PORT
    return runtime


def _type_available(provider_type: ScanProviderType) -> bool:
    if provider_type is ScanProviderType.CLAMAV:
        return bool(dify_config.FILE_SCAN_CLAMAV_HOST)
    return True


def _require_credentials_for_new_destination(
    provider_type: ScanProviderType,
    *,
    stored_config: Mapping[str, Any],
    config: Mapping[str, Any],
    supplied: Mapping[str, str],
) -> None:
    """Refuse to send stored credentials to a destination they were not entered for.

    The console never returns a stored key. Without this rule, an administrator could change the
    scanner's address to a server they control and receive the key through the connectivity check.
    """
    cls = scanner_class(provider_type)
    changed = any((stored_config.get(name) or "") != (config.get(name) or "") for name in cls.destination_fields)
    if changed and any(name not in supplied for name in cls.credential_fields):
        raise FileScanValidationError("Enter the credentials again to change where this scanner sends them.")


def _provider_type(value: str) -> ScanProviderType:
    try:
        return ScanProviderType(value)
    except ValueError:
        raise FileScanValidationError("Unknown scanner type.") from None


def _name(value: str) -> str:
    name = value.strip()
    if not name or len(name) > MAX_NAME_LENGTH:
        raise FileScanValidationError(f"The name must be 1 to {MAX_NAME_LENGTH} characters.")
    return name


def _credentials(provider_type: ScanProviderType, credentials: Mapping[str, str]) -> dict[str, str]:
    """Keep only this scanner's secret fields, dropping empty values."""
    allowed = scanner_class(provider_type).credential_fields
    return {key: str(value).strip() for key, value in credentials.items() if key in allowed and str(value).strip()}


def _encrypt(tenant_id: str, credentials: Mapping[str, str]) -> str | None:
    if not credentials:
        return None
    return encrypt_token(tenant_id, json.dumps(dict(credentials)))


def _decrypt(tenant_id: str, encrypted: str | None) -> dict[str, str]:
    if not encrypted:
        return {}
    decoded = json.loads(decrypt_token(tenant_id, encrypted))
    return {str(key): str(value) for key, value in decoded.items()} if isinstance(decoded, dict) else {}


def _row(session: Session, tenant_id: str, provider_id: str) -> FileScanProvider:
    row = session.scalar(
        select(FileScanProvider).where(FileScanProvider.tenant_id == tenant_id, FileScanProvider.id == provider_id)
    )
    if row is None:
        raise FileScanProviderNotFoundError("The scanner was not found.")
    return row


def _policy_count(session: Session, tenant_id: str, provider_id: str) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(FileScanPolicy)
            .where(FileScanPolicy.tenant_id == tenant_id, FileScanPolicy.provider_id == provider_id)
        )
        or 0
    )


def _commit_unique_name(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise FileScanValidationError("A scanner with this name already exists.") from None


def _view(tenant_id: str, row: FileScanProvider, *, policy_count: int) -> FileScanProviderView:
    stored = _decrypt(tenant_id, row.encrypted_credentials)
    fields = scanner_class(ScanProviderType(row.provider_type)).credential_fields
    return FileScanProviderView(
        id=row.id,
        name=row.name,
        provider_type=row.provider_type,
        config=dict(row.config or {}),
        credentials_set={name: name in stored for name in fields},
        status=row.status.value if isinstance(row.status, FileScanProviderStatus) else str(row.status),
        last_error=row.last_error,
        last_tested_at=row.last_tested_at,
        created_at=row.created_at,
        policy_count=policy_count,
    )
