"""SQLAlchemy IM Control Plane adapter.

Read-only queries own short sessions without acquiring the Organization write
lock. Every configuration and active-run mutation requires an explicit stable
Organization scope and delegates to the guarded write unit of work. ORM records
never cross these boundaries, and aggregate relationships are loaded explicitly
because their model relationships use ``lazy="raise"``.
"""

from __future__ import annotations

from types import TracebackType
from typing import Protocol

import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload, sessionmaker

from core.human_input_v2.contact_directory import ContactSnapshot
from core.human_input_v2.entities import IMIdentityBindingStatus, IMProvider, IMSyncResultType
from core.human_input_v2.im_integration import (
    ActiveRunDecision,
    BindingResolutionKind,
    BindingResolutionResult,
    ConfigurationTransition,
    EffectiveBindingResolver,
    IMControlPlanePersistenceError,
    IMIntegration,
    IMIntegrationState,
    IMSyncRun,
    IntegrationDeletion,
    IntegrationRevisionToken,
    StaleRevision,
    SynchronizedIMIdentity,
    SynchronizedIMIdentityPage,
    SyncResultFact,
    SyncResultPage,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from repositories.human_input_v2.contact_directory.mappers import contact_from_record

from .mappers import (
    binding_from_record,
    identity_from_record,
    integration_from_record,
    sync_result_from_record,
    sync_result_to_record,
    sync_run_from_record,
)


class _ProtectedIMWriter(Protocol):
    def create_integration(
        self,
        integration: IMIntegration,
        *,
        organization_scope: DirectoryScope,
    ) -> IMIntegration: ...

    def compare_and_swap_configuration(
        self,
        transition: ConfigurationTransition,
        *,
        organization_scope: DirectoryScope,
    ) -> IMIntegration | StaleRevision: ...

    def compare_and_swap_delete(
        self,
        deletion: IntegrationDeletion,
        *,
        organization_scope: DirectoryScope,
    ) -> None | StaleRevision: ...

    def create_or_get_active_run(
        self,
        integration_revision: IntegrationRevisionToken,
        *,
        organization_scope: DirectoryScope,
        sync_run_id: IMSyncRunId,
        started_by_account_id: AccountId | None,
        now: NaiveDatetime,
    ) -> ActiveRunDecision: ...


class _OrganizationIMWriteUnitOfWork(Protocol):
    def __enter__(self) -> _ProtectedIMWriter: ...

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...


class _OrganizationIMWriteUnitOfWorkFactory(Protocol):
    def __call__(self, scope: DirectoryScope, /) -> _OrganizationIMWriteUnitOfWork: ...


class SQLAlchemyIMControlPlaneRepository:
    """Transactional adapter for configuration, sync, and binding invariants."""

    _session_maker: sessionmaker[Session]

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        write_unit_of_work_factory: _OrganizationIMWriteUnitOfWorkFactory,
    ) -> None:
        self._session_maker = session_maker
        self._write_unit_of_work_factory = write_unit_of_work_factory

    def load_current_integration(self, tenant_id: TenantId | None) -> IMIntegration | None:
        """Load only the exact owner scope used by management."""

        owner_predicate = (
            HumanInputIMIntegration.tenant_id.is_(None)
            if tenant_id is None
            else HumanInputIMIntegration.tenant_id == str(tenant_id)
        )
        try:
            with self._session_maker() as session:
                record = session.scalar(select(HumanInputIMIntegration).where(owner_predicate).limit(1))
                return integration_from_record(record) if record is not None else None
        except SQLAlchemyError as error:
            raise IMControlPlanePersistenceError("failed to load IM Integration") from error

    def create_integration(
        self,
        integration: IMIntegration,
        *,
        organization_scope: DirectoryScope,
    ) -> IMIntegration:
        """Route configuration creation through the explicit Organization guard."""

        self._ensure_scope_matches_owner(organization_scope, integration.tenant_id)
        try:
            with self._write_unit_of_work_factory(organization_scope) as protected_repository:
                return protected_repository.create_integration(
                    integration,
                    organization_scope=organization_scope,
                )
        except SQLAlchemyError as error:
            raise IMControlPlanePersistenceError("failed to create IM Integration") from error

    @staticmethod
    def _ensure_scope_matches_owner(scope: DirectoryScope, tenant_id: TenantId | None) -> None:
        if isinstance(scope, WorkspaceScope):
            if tenant_id != scope.id:
                raise ValueError("Organization write scope does not match IM Integration owner")
            return
        if isinstance(scope, DeploymentScope):
            if tenant_id is not None:
                raise ValueError("Organization write scope does not match IM Integration owner")
            return
        raise TypeError("unsupported Organization write scope")

    def compare_and_swap_configuration(
        self,
        transition: ConfigurationTransition,
        *,
        organization_scope: DirectoryScope,
    ) -> IMIntegration | StaleRevision:
        """Route configuration CAS through the explicit Organization guard."""

        self._ensure_scope_matches_owner(organization_scope, transition.integration.tenant_id)
        try:
            with self._write_unit_of_work_factory(organization_scope) as protected_repository:
                return protected_repository.compare_and_swap_configuration(
                    transition,
                    organization_scope=organization_scope,
                )
        except SQLAlchemyError as error:
            raise IMControlPlanePersistenceError("failed to persist IM Integration configuration") from error

    def compare_and_swap_delete(
        self,
        deletion: IntegrationDeletion,
        *,
        organization_scope: DirectoryScope,
    ) -> None | StaleRevision:
        """Route configuration deletion through the explicit Organization guard."""

        try:
            with self._write_unit_of_work_factory(organization_scope) as protected_repository:
                return protected_repository.compare_and_swap_delete(
                    deletion,
                    organization_scope=organization_scope,
                )
        except SQLAlchemyError as error:
            raise IMControlPlanePersistenceError("failed to delete IM Integration") from error

    def create_or_get_active_run(
        self,
        integration_revision: IntegrationRevisionToken,
        *,
        organization_scope: DirectoryScope,
        sync_run_id: IMSyncRunId,
        started_by_account_id: AccountId | None,
        now: NaiveDatetime,
    ) -> ActiveRunDecision:
        """Route active-run creation through the explicit Organization guard."""

        with self._write_unit_of_work_factory(organization_scope) as protected_repository:
            return protected_repository.create_or_get_active_run(
                integration_revision,
                organization_scope=organization_scope,
                sync_run_id=sync_run_id,
                started_by_account_id=started_by_account_id,
                now=now,
            )

    def load_integration_state(self, integration_id: IntegrationId) -> IMIntegrationState:
        """Eagerly load and map an Integration with all modeled child relationships."""

        with self._session_maker() as session, session.begin():
            record = session.scalar(
                select(HumanInputIMIntegration)
                .where(HumanInputIMIntegration.id == str(integration_id))
                .options(
                    selectinload(HumanInputIMIntegration.identities).selectinload(HumanInputIMIdentity.bindings),
                    selectinload(HumanInputIMIntegration.sync_runs).selectinload(HumanInputIMSyncRun.results),
                )
            )
            if record is None:
                raise ValueError("integration not found")
            identity_records = tuple(record.identities)
            run_records = tuple(record.sync_runs)
            return IMIntegrationState(
                integration=integration_from_record(record),
                identities=tuple(identity_from_record(item) for item in identity_records),
                bindings=tuple(
                    binding_from_record(binding) for identity in identity_records for binding in identity.bindings
                ),
                sync_runs=tuple(sync_run_from_record(item) for item in run_records),
                sync_results=tuple(sync_result_from_record(result) for run in run_records for result in run.results),
            )

    def load_sync_run(self, sync_run_id: IMSyncRunId) -> IMSyncRun | None:
        """Load one run through a read-only session without taking the write lock."""

        with self._session_maker() as session:
            record = session.get(HumanInputIMSyncRun, str(sync_run_id))
            return sync_run_from_record(record) if record is not None else None

    def load_latest_sync_run(self, integration_id: IntegrationId) -> IMSyncRun | None:
        """Load one deterministically selected latest run for an Integration."""

        with self._session_maker() as session:
            record = session.scalar(
                select(HumanInputIMSyncRun)
                .where(HumanInputIMSyncRun.integration_id == str(integration_id))
                .order_by(HumanInputIMSyncRun.created_at.desc(), HumanInputIMSyncRun.id.desc())
                .limit(1)
            )
            return sync_run_from_record(record) if record is not None else None

    def page_sync_results(
        self,
        sync_run_id: IMSyncRunId,
        result_type: IMSyncResultType,
        *,
        page: int,
        limit: int,
    ) -> SyncResultPage:
        """Read one required result bucket in stable creation order."""

        if page < 1:
            raise ValueError("page must be positive")
        if limit < 1 or limit > 100:
            raise ValueError("limit must be between 1 and 100")
        if not isinstance(result_type, IMSyncResultType):
            raise ValueError("result type must be a real synchronization bucket")
        predicate = (
            HumanInputIMSyncResult.sync_run_id == str(sync_run_id),
            HumanInputIMSyncResult.result_type == result_type,
        )
        with self._session_maker() as session:
            total = session.scalar(select(sa.func.count(HumanInputIMSyncResult.id)).where(*predicate)) or 0
            records = session.scalars(
                select(HumanInputIMSyncResult)
                .where(*predicate)
                .order_by(HumanInputIMSyncResult.created_at, HumanInputIMSyncResult.id)
                .offset((page - 1) * limit)
                .limit(limit)
            ).all()
            return SyncResultPage(
                tuple(sync_result_from_record(record) for record in records),
                page=page,
                limit=limit,
                total=total,
            )

    def search_identities(
        self,
        integration_id: IntegrationId,
        provider: IMProvider,
        *,
        keyword: str | None,
        page: int,
        limit: int,
    ) -> SynchronizedIMIdentityPage:
        """Search one current Integration namespace without acquiring the write lock."""

        if page < 1:
            raise ValueError("page must be positive")
        if limit < 1 or limit > 100:
            raise ValueError("limit must be between 1 and 100")
        predicates: list[sa.ColumnElement[bool]] = [
            HumanInputIMIdentity.integration_id == str(integration_id),
            HumanInputIMIdentity.provider == provider,
        ]
        normalized_keyword = keyword.strip().casefold() if keyword is not None else ""
        if normalized_keyword:
            predicates.append(
                sa.or_(
                    sa.func.lower(HumanInputIMIdentity.display_name).contains(normalized_keyword, autoescape=True),
                    sa.func.lower(HumanInputIMIdentity.email).contains(normalized_keyword, autoescape=True),
                    sa.func.lower(HumanInputIMIdentity.provider_user_id).contains(
                        normalized_keyword,
                        autoescape=True,
                    ),
                )
            )
        is_bound = sa.exists(
            select(HumanInputIMBinding.id).where(
                HumanInputIMBinding.integration_id == str(integration_id),
                HumanInputIMBinding.provider == provider,
                HumanInputIMBinding.im_identity_id == HumanInputIMIdentity.id,
            )
        )
        with self._session_maker() as session:
            total = session.scalar(select(sa.func.count(HumanInputIMIdentity.id)).where(*predicates)) or 0
            rows = session.execute(
                select(HumanInputIMIdentity, is_bound.label("is_bound"))
                .where(*predicates)
                .order_by(HumanInputIMIdentity.id)
                .offset((page - 1) * limit)
                .limit(limit)
            ).all()
            return SynchronizedIMIdentityPage(
                items=tuple(
                    SynchronizedIMIdentity(
                        id=IMIdentityId(record.id),
                        provider=record.provider,
                        provider_user_id=record.provider_user_id,
                        display_name=record.display_name,
                        email=record.email,
                        binding_status=(
                            IMIdentityBindingStatus.BOUND if row_is_bound else IMIdentityBindingStatus.UNBOUND
                        ),
                    )
                    for record, row_is_bound in rows
                ),
                page=page,
                limit=limit,
                total=total,
            )

    def resolve_effective_binding(
        self,
        *,
        integration_id: IntegrationId,
        provider: IMProvider,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> BindingResolutionResult:
        """Validate Integration ownership before loading consumer-safe binding facts."""

        with self._session_maker() as session, session.begin():
            integration_record = session.scalar(
                select(HumanInputIMIntegration).where(
                    HumanInputIMIntegration.id == str(integration_id),
                    sa.or_(
                        HumanInputIMIntegration.tenant_id == str(tenant_id),
                        HumanInputIMIntegration.tenant_id.is_(None),
                    ),
                )
            )
            if integration_record is None or integration_record.provider is not provider:
                return BindingResolutionResult(BindingResolutionKind.INVALID_BINDING, None)
            integration = integration_from_record(integration_record)
            contact_record = session.scalar(
                select(HumanInputContact).where(
                    HumanInputContact.id == str(contact_id),
                    sa.or_(HumanInputContact.tenant_id == str(tenant_id), HumanInputContact.tenant_id.is_(None)),
                )
            )
            if contact_record is None:
                return BindingResolutionResult(BindingResolutionKind.NOT_AVAILABLE, None)
            contact = ContactSnapshot(contact_from_record(contact_record), True)
            identities = tuple(
                identity_from_record(record)
                for record in session.scalars(
                    select(HumanInputIMIdentity).where(
                        HumanInputIMIdentity.integration_id == str(integration_id),
                        HumanInputIMIdentity.provider == provider,
                    )
                ).all()
            )
            bindings = tuple(
                binding_from_record(record)
                for record in session.scalars(
                    select(HumanInputIMBinding).where(
                        HumanInputIMBinding.integration_id == str(integration_id),
                        HumanInputIMBinding.provider == provider,
                    )
                ).all()
            )
            return EffectiveBindingResolver.resolve(
                integration_revision=integration.revision,
                provider_tenant=integration.provider_tenant,
                tenant_id=tenant_id,
                contact=contact,
                identities=identities,
                bindings=bindings,
            )

    def append_sync_results(self, results: tuple[SyncResultFact, ...]) -> None:
        """Append diagnostic facts in their own explicit transaction."""

        with self._session_maker() as session, session.begin():
            for result in results:
                self._append_result_record(session, result)

    @staticmethod
    def _append_result_record(session: Session, result: SyncResultFact) -> None:
        session.add(sync_result_to_record(result))
