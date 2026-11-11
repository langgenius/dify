from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from core.db.session_factory import session_factory
from models.dataset import Dataset
from models.file_scan import FileScanFallbackAction, FileScanPolicy, FileScanProvider
from services.file_scan.entities import SCOPE_DATASET, ScanPolicy, ScanScope
from services.file_scan.errors import FileScanValidationError


class FileScanPolicyService:
    """Reads and writes the scan policy of one scope.

    Authorization belongs to the module that owns the scope: it exposes these methods behind its
    own route and permission checks.
    """

    def __init__(self, session_maker: sessionmaker[Session] | None = None) -> None:
        self._session_maker = session_maker or session_factory.get_session_maker()

    def get(self, *, tenant_id: str, scope: ScanScope) -> ScanPolicy:
        with self._session_maker() as session:
            row = _policy_row(session, tenant_id=tenant_id, scope=scope)
            return _to_policy(row)

    def set(self, *, tenant_id: str, scope: ScanScope, policy: ScanPolicy, account_id: str | None) -> ScanPolicy:
        if policy.enabled and not policy.provider_id:
            raise FileScanValidationError("Choose a scanner before turning on the malware scan.")
        with self._session_maker() as session:
            if policy.provider_id:
                provider_id = session.scalar(
                    select(FileScanProvider.id).where(
                        FileScanProvider.tenant_id == tenant_id, FileScanProvider.id == policy.provider_id
                    )
                )
                if provider_id is None:
                    raise FileScanValidationError("The selected scanner does not exist.")
            row = _policy_row(session, tenant_id=tenant_id, scope=scope)
            if row is None:
                row = FileScanPolicy(tenant_id=tenant_id, scope_type=scope.type, scope_id=scope.id)
                session.add(row)
            row.enabled = policy.enabled
            row.provider_id = policy.provider_id
            row.on_unavailable = policy.on_unavailable
            row.on_unscannable = policy.on_unscannable
            row.updated_by = account_id
            session.commit()
            return _to_policy(row)

    def dataset_scope(self, *, tenant_id: str, dataset_id: str) -> ScanScope | None:
        """The scope of a Classic Knowledge Base, or ``None`` when the workspace has no such dataset."""
        with self._session_maker() as session:
            found = session.scalar(select(Dataset.id).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id))
        return ScanScope(SCOPE_DATASET, dataset_id) if found is not None else None

    def delete_scope(self, *, tenant_id: str, scope: ScanScope) -> None:
        """Forget the policy of a deleted resource."""
        with self._session_maker() as session:
            session.execute(
                delete(FileScanPolicy).where(
                    FileScanPolicy.tenant_id == tenant_id,
                    FileScanPolicy.scope_type == scope.type,
                    FileScanPolicy.scope_id == scope.id,
                )
            )
            session.commit()


def _policy_row(session: Session, *, tenant_id: str, scope: ScanScope) -> FileScanPolicy | None:
    return session.scalar(
        select(FileScanPolicy).where(
            FileScanPolicy.tenant_id == tenant_id,
            FileScanPolicy.scope_type == scope.type,
            FileScanPolicy.scope_id == scope.id,
        )
    )


def _to_policy(row: FileScanPolicy | None) -> ScanPolicy:
    if row is None:
        return ScanPolicy()
    return ScanPolicy(
        enabled=row.enabled,
        provider_id=row.provider_id,
        on_unavailable=FileScanFallbackAction(row.on_unavailable),
        on_unscannable=FileScanFallbackAction(row.on_unscannable),
    )
