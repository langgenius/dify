"""Guarded SQLAlchemy unit of work and conditional IM reconciliation executor."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from types import TracebackType
from typing import Protocol

import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact import Contact, ContactQuery, ContactType
from core.human_input_v2.entities import (
    HumanInputContactType,
    IMBindingScope,
    IMProvider,
    IMSyncRemovalReason,
    IMSyncResultType,
    IMSyncRunStatus,
)
from core.human_input_v2.im_integration import (
    ActiveRunDecision,
    ActiveRunDecisionKind,
    ApplyReconciliationResult,
    ApplyReconciliationStatus,
    ConfigurationTransition,
    ConfigurationTransitionKind,
    ContactEmailMatchState,
    ContactIMBindingView,
    CreateIMBinding,
    CurrentIMBindingState,
    CurrentIMIdentityState,
    DeleteIMBinding,
    ExistingIMIdentityRef,
    IMBinding,
    IMBindingChangeSnapshot,
    IMBindingCommandError,
    IMBindingCommandErrorCode,
    IMIdentityChangeSnapshot,
    IMIdentityUpsert,
    IMIdentityUpsertKind,
    IMIntegration,
    IMIntegrationAlreadyExistsError,
    IMReconciliationChange,
    IMReconciliationOperation,
    IMReconciliationSubjectKind,
    IMSyncRun,
    IntegrationDeletion,
    IntegrationRevisionToken,
    NewIMIdentityRef,
    ReconciliationInput,
    ReconciliationPlan,
    ReconciliationRunRef,
    ReplaceIMBinding,
    ResolvedReconciliationWarning,
    StaleRevision,
    SyncContactSnapshot,
    SyncIdentitySnapshot,
    SyncResultFact,
)
from core.human_input_v2.im_integration.adapters.entities import DirectoryEntry, ProviderUserId
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    IMBindingId,
    IMIdentityId,
    IMReconciliationChangeId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)
from libs.uuid_utils import uuidv7
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
    IMIdentityRawPayload,
)
from repositories.human_input_v2.contact import SQLAlchemyContactIMBindingRepository, SQLAlchemyContactRepository
from repositories.human_input_v2.organization_write_unit_of_work import (
    OwnedOrganizationWriteLock,
    SQLAlchemyOrganizationWriteUnitOfWork,
)

from .mappers import (
    binding_from_record,
    binding_to_record,
    integration_from_record,
    integration_to_record,
    reconciliation_change_to_record,
    sync_result_to_record,
    sync_run_from_record,
    sync_run_to_record,
)


class _PreconditionFailedError(RuntimeError):
    pass


class DeploymentContactReader(Protocol):
    """EE-provided deployment Contact read capability."""

    def list_contacts(self, page: int, limit: int) -> Sequence[Contact]: ...

    def get_contact(self, contact_id: ContactId) -> Contact | None: ...


class SQLAlchemyOrganizationIMWriteUnitOfWork:
    """Expose reconciliation-protected mutations only while lock and transaction are active."""

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        write_lock: OwnedOrganizationWriteLock,
        deployment_contact_reader_factory: Callable[[Session], DeploymentContactReader] | None = None,
    ) -> None:
        self._write_lock = write_lock
        self._session_unit_of_work = SQLAlchemyOrganizationWriteUnitOfWork(session_maker, write_lock)
        self._deployment_contact_reader_factory = deployment_contact_reader_factory
        self._protected_repository: SQLAlchemySessionBoundIMRepository | None = None

    @property
    def protected_repository(self) -> SQLAlchemySessionBoundIMRepository:
        if self._protected_repository is None:
            raise RuntimeError("protected repository requires an active guarded unit of work")
        return self._protected_repository

    def __enter__(self) -> SQLAlchemySessionBoundIMRepository:
        session = self._session_unit_of_work.__enter__()
        deployment_contacts = (
            self._deployment_contact_reader_factory(session)
            if self._deployment_contact_reader_factory is not None
            else None
        )
        self._protected_repository = SQLAlchemySessionBoundIMRepository(
            session,
            self._write_lock,
            deployment_contacts,
        )
        return self._protected_repository

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        try:
            self._session_unit_of_work.__exit__(exception_type, exception, traceback)
        finally:
            self._protected_repository = None


class SQLAlchemySessionBoundIMRepository:
    """Protected mutation surface bound to an already locked caller Session."""

    def __init__(
        self,
        session: Session,
        write_lock: OwnedOrganizationWriteLock,
        deployment_contacts: DeploymentContactReader | None = None,
    ) -> None:
        self._session = session
        self._write_lock = write_lock
        self._deployment_contacts = deployment_contacts
        self._contact_repository = SQLAlchemyContactRepository(session)
        self._contact_im_binding_repository = SQLAlchemyContactIMBindingRepository(session)

    def create_integration(
        self,
        integration: IMIntegration,
        *,
        organization_scope: DirectoryScope,
    ) -> IMIntegration:
        """Create one owner-scoped Integration inside the guarded transaction."""

        self._write_lock.ensure_owned()
        self._ensure_scope_matches_tenant_id(organization_scope, integration.tenant_id)
        owner_predicate = (
            HumanInputIMIntegration.tenant_id.is_(None)
            if integration.tenant_id is None
            else HumanInputIMIntegration.tenant_id == str(integration.tenant_id)
        )
        existing_id = self._session.scalar(select(HumanInputIMIntegration.id).where(owner_predicate).limit(1))
        if existing_id is not None:
            raise IMIntegrationAlreadyExistsError
        record = integration_to_record(integration)
        self._session.add(record)
        self._session.flush()
        return integration_from_record(record)

    def compare_and_swap_configuration(
        self,
        transition: ConfigurationTransition,
        *,
        organization_scope: DirectoryScope,
    ) -> IMIntegration | StaleRevision:
        """Persist one aggregate-decided configuration transition under the Organization guard."""

        self._write_lock.ensure_owned()
        self._ensure_scope_matches_tenant_id(organization_scope, transition.integration.tenant_id)
        current_record = self._session.scalar(
            select(HumanInputIMIntegration).where(
                HumanInputIMIntegration.id == str(transition.expected_revision.integration_id),
                HumanInputIMIntegration.config_version == transition.expected_revision.config_version,
            )
        )
        if current_record is None:
            return StaleRevision(
                transition.expected_revision,
                self._current_revision(transition.expected_revision.integration_id),
            )
        self._ensure_scope_owns_record(organization_scope, current_record)
        if transition.kind is ConfigurationTransitionKind.CREDENTIAL_ROTATION:
            self._copy_integration_values(current_record, transition.integration)
            self._session.flush()
            return integration_from_record(current_record)

        integration_id = str(transition.expected_revision.integration_id)
        self._session.execute(
            sa.delete(HumanInputIMBinding).where(HumanInputIMBinding.integration_id == integration_id)
        )
        self._session.execute(
            sa.delete(HumanInputIMIdentity).where(HumanInputIMIdentity.integration_id == integration_id)
        )
        self._session.delete(current_record)
        self._session.flush()
        replacement_record = integration_to_record(transition.integration)
        self._session.add(replacement_record)
        self._session.flush()
        return integration_from_record(replacement_record)

    def compare_and_swap_delete(
        self,
        deletion: IntegrationDeletion,
        *,
        organization_scope: DirectoryScope,
    ) -> None | StaleRevision:
        """Delete current configuration and children under the guarded exact-revision CAS."""

        self._write_lock.ensure_owned()
        current_record = self._session.scalar(
            select(HumanInputIMIntegration).where(
                HumanInputIMIntegration.id == str(deletion.expected_revision.integration_id),
                HumanInputIMIntegration.config_version == deletion.expected_revision.config_version,
            )
        )
        if current_record is None:
            return StaleRevision(
                deletion.expected_revision,
                self._current_revision(deletion.expected_revision.integration_id),
            )
        self._ensure_scope_owns_record(organization_scope, current_record)
        integration_id = str(deletion.expected_revision.integration_id)
        if deletion.invalidation.invalidate_bindings:
            self._session.execute(
                sa.delete(HumanInputIMBinding).where(HumanInputIMBinding.integration_id == integration_id)
            )
        if deletion.invalidation.invalidate_identities:
            self._session.execute(
                sa.delete(HumanInputIMIdentity).where(HumanInputIMIdentity.integration_id == integration_id)
            )
        self._session.delete(current_record)
        self._session.flush()
        return None

    def create_or_get_active_run(
        self,
        integration_revision: IntegrationRevisionToken,
        *,
        organization_scope: DirectoryScope,
        sync_run_id: IMSyncRunId,
        started_by_account_id: AccountId | None,
        now: NaiveDatetime,
    ) -> ActiveRunDecision:
        """Create at most one active run inside the guarded transaction."""

        self._write_lock.ensure_owned()
        integration_record = self._session.scalar(
            select(HumanInputIMIntegration).where(
                HumanInputIMIntegration.id == str(integration_revision.integration_id),
                HumanInputIMIntegration.config_version == integration_revision.config_version,
            )
        )
        if integration_record is None:
            current_record = self._session.get(
                HumanInputIMIntegration,
                str(integration_revision.integration_id),
            )
            current_revision = (
                IntegrationRevisionToken(IntegrationId(current_record.id), current_record.config_version)
                if current_record is not None
                else None
            )
            return ActiveRunDecision(
                kind=ActiveRunDecisionKind.STALE_REVISION,
                run=None,
                stale_revision=StaleRevision(integration_revision, current_revision),
            )
        self._ensure_scope_owns_record(organization_scope, integration_record)
        existing_record = self._session.scalar(
            select(HumanInputIMSyncRun)
            .where(
                HumanInputIMSyncRun.integration_id == str(integration_revision.integration_id),
                HumanInputIMSyncRun.status.in_((IMSyncRunStatus.QUEUED, IMSyncRunStatus.RUNNING)),
            )
            .order_by(HumanInputIMSyncRun.created_at, HumanInputIMSyncRun.id)
            .limit(1)
        )
        if existing_record is not None:
            return ActiveRunDecision(
                ActiveRunDecisionKind.EXISTING_ACTIVE,
                sync_run_from_record(existing_record),
            )
        run = IMSyncRun.create(
            sync_run_id=sync_run_id,
            integration_revision=integration_revision,
            provider=integration_record.provider,
            started_by_account_id=started_by_account_id,
            now=now,
        )
        run_record = sync_run_to_record(run)
        self._session.add(run_record)
        self._session.flush()
        return ActiveRunDecision(ActiveRunDecisionKind.CREATED, sync_run_from_record(run_record))

    def _current_revision(self, integration_id: IntegrationId) -> IntegrationRevisionToken | None:
        record = self._session.get(HumanInputIMIntegration, str(integration_id))
        if record is None:
            return None
        return IntegrationRevisionToken(IntegrationId(record.id), record.config_version)

    @staticmethod
    def _ensure_scope_matches_tenant_id(
        organization_scope: DirectoryScope,
        tenant_id: TenantId | None,
    ) -> None:
        if isinstance(organization_scope, WorkspaceScope):
            if tenant_id != organization_scope.id:
                raise ValueError("Organization write scope does not match IM Integration owner")
            return
        if isinstance(organization_scope, DeploymentScope):
            if tenant_id is not None:
                raise ValueError("Organization write scope does not match IM Integration owner")
            return
        raise TypeError("unsupported Organization write scope")

    @staticmethod
    def _ensure_scope_owns_record(
        organization_scope: DirectoryScope,
        integration_record: HumanInputIMIntegration,
    ) -> None:
        persisted_tenant_id = (
            TenantId(integration_record.tenant_id) if integration_record.tenant_id is not None else None
        )
        SQLAlchemySessionBoundIMRepository._ensure_scope_matches_tenant_id(
            organization_scope,
            persisted_tenant_id,
        )

    @staticmethod
    def _copy_integration_values(record: HumanInputIMIntegration, integration: IMIntegration) -> None:
        mapped = integration_to_record(integration)
        record.provider = mapped.provider
        record.encrypted_credentials = mapped.encrypted_credentials
        record.tenant_id = mapped.tenant_id
        record.provider_tenant_id = mapped.provider_tenant_id
        record.app_identifier = mapped.app_identifier
        record.status = mapped.status
        record.config_version = mapped.config_version
        record.configured_by_account_id = mapped.configured_by_account_id
        record.callback_url = mapped.callback_url
        record.safe_status_reason = mapped.safe_status_reason
        record.last_checked_at = mapped.last_checked_at
        record.updated_at = mapped.updated_at

    def create_organization_binding(
        self,
        *,
        organization_scope: DirectoryScope,
        integration_id: IntegrationId,
        contact_id: ContactId,
        identity_id: IMIdentityId,
        binding_id: IMBindingId,
        bound_by_account_id: AccountId | None,
        now: NaiveDatetime,
    ) -> IMBinding:
        """Create one Organization binding after validating every owner endpoint."""

        self._write_lock.ensure_owned()
        integration = self._require_owned_integration(organization_scope, integration_id)
        self._require_integration_identity(integration, identity_id)
        self._require_organization_contact(organization_scope, contact_id)
        existing = self._session.scalar(
            select(HumanInputIMBinding).where(
                HumanInputIMBinding.scope == IMBindingScope.ORGANIZATION,
                HumanInputIMBinding.scope_id == str(integration_id),
                HumanInputIMBinding.provider == integration.provider,
                sa.or_(
                    HumanInputIMBinding.contact_id == str(contact_id),
                    HumanInputIMBinding.im_identity_id == str(identity_id),
                ),
            )
        )
        if existing is not None:
            if existing.contact_id == str(contact_id) and existing.im_identity_id == str(identity_id):
                return binding_from_record(existing)
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.BINDING_CONFLICT,
                "IM binding conflicts with an existing scope binding",
            )
        binding = IMBinding.create(
            binding_id=binding_id,
            integration_id=integration_id,
            scope=IMBindingScope.ORGANIZATION,
            scope_id=str(integration_id),
            contact_id=contact_id,
            identity_id=identity_id,
            provider=integration.provider,
            bound_by_account_id=bound_by_account_id,
            now=now,
        )
        record = binding_to_record(binding)
        self._session.add(record)
        self._session.flush()
        return binding_from_record(record)

    def delete_organization_binding(
        self,
        *,
        organization_scope: DirectoryScope,
        integration_id: IntegrationId,
        contact_id: ContactId,
        binding_id: IMBindingId,
    ) -> None:
        """Delete only the selected Organization-scoped binding."""

        self._write_lock.ensure_owned()
        integration = self._require_owned_integration(organization_scope, integration_id)
        self._require_organization_contact(organization_scope, contact_id)
        record = self._session.scalar(
            select(HumanInputIMBinding).where(
                HumanInputIMBinding.id == str(binding_id),
                HumanInputIMBinding.integration_id == str(integration_id),
                HumanInputIMBinding.provider == integration.provider,
                HumanInputIMBinding.scope == IMBindingScope.ORGANIZATION,
                HumanInputIMBinding.scope_id == str(integration_id),
                HumanInputIMBinding.contact_id == str(contact_id),
            )
        )
        if record is None:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.BINDING_NOT_FOUND,
                "Organization IM binding was not found",
            )
        self._session.delete(record)
        self._session.flush()

    def set_workspace_override(
        self,
        *,
        organization_scope: DirectoryScope,
        tenant_id: TenantId,
        integration_id: IntegrationId,
        contact_id: ContactId,
        identity_id: IMIdentityId,
        binding_id: IMBindingId,
        bound_by_account_id: AccountId | None,
        now: NaiveDatetime,
    ) -> IMBinding:
        """Create or replace one workspace override without touching Organization state."""

        self._write_lock.ensure_owned()
        integration = self._require_owned_integration(organization_scope, integration_id)
        self._ensure_workspace_belongs_to_scope(organization_scope, tenant_id)
        self._require_integration_identity(integration, identity_id)
        self._require_contact_available_in_workspace(tenant_id, contact_id)
        identity_binding = self._session.scalar(
            select(HumanInputIMBinding).where(
                HumanInputIMBinding.scope == IMBindingScope.WORKSPACE,
                HumanInputIMBinding.scope_id == str(tenant_id),
                HumanInputIMBinding.provider == integration.provider,
                HumanInputIMBinding.im_identity_id == str(identity_id),
                HumanInputIMBinding.contact_id != str(contact_id),
            )
        )
        if identity_binding is not None:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.BINDING_CONFLICT,
                "IM binding conflicts with an existing scope binding",
            )
        existing = self._session.scalar(
            select(HumanInputIMBinding).where(
                HumanInputIMBinding.scope == IMBindingScope.WORKSPACE,
                HumanInputIMBinding.scope_id == str(tenant_id),
                HumanInputIMBinding.provider == integration.provider,
                HumanInputIMBinding.contact_id == str(contact_id),
            )
        )
        if existing is not None:
            existing.integration_id = str(integration_id)
            existing.im_identity_id = str(identity_id)
            existing.bound_by_account_id = str(bound_by_account_id) if bound_by_account_id is not None else None
            existing.updated_at = now
            self._session.flush()
            return binding_from_record(existing)
        binding = IMBinding.create(
            binding_id=binding_id,
            integration_id=integration_id,
            scope=IMBindingScope.WORKSPACE,
            scope_id=str(tenant_id),
            contact_id=contact_id,
            identity_id=identity_id,
            provider=integration.provider,
            bound_by_account_id=bound_by_account_id,
            now=now,
        )
        record = binding_to_record(binding)
        self._session.add(record)
        self._session.flush()
        return binding_from_record(record)

    def reset_workspace_override(
        self,
        *,
        organization_scope: DirectoryScope,
        tenant_id: TenantId,
        integration_id: IntegrationId,
        contact_id: ContactId,
    ) -> None:
        """Remove only the workspace override so Organization resolution resumes."""

        self._write_lock.ensure_owned()
        integration = self._require_owned_integration(organization_scope, integration_id)
        self._ensure_workspace_belongs_to_scope(organization_scope, tenant_id)
        self._require_contact_available_in_workspace(tenant_id, contact_id)
        record = self._session.scalar(
            select(HumanInputIMBinding).where(
                HumanInputIMBinding.integration_id == str(integration_id),
                HumanInputIMBinding.provider == integration.provider,
                HumanInputIMBinding.scope == IMBindingScope.WORKSPACE,
                HumanInputIMBinding.scope_id == str(tenant_id),
                HumanInputIMBinding.contact_id == str(contact_id),
            )
        )
        if record is None:
            return
        self._session.delete(record)
        self._session.flush()

    def require_current_integration(self, organization_scope: DirectoryScope) -> IMIntegration:
        """Load the current owner-scoped Integration inside the guarded transaction."""

        self._write_lock.ensure_owned()
        if isinstance(organization_scope, WorkspaceScope):
            owner_predicate = HumanInputIMIntegration.tenant_id == str(organization_scope.id)
        elif isinstance(organization_scope, DeploymentScope):
            owner_predicate = HumanInputIMIntegration.tenant_id.is_(None)
        else:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.INVALID_SCOPE,
                "Unsupported Organization scope",
            )
        record = self._session.scalar(select(HumanInputIMIntegration).where(owner_predicate).limit(1))
        if record is None:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.INTEGRATION_NOT_CONFIGURED,
                "Organization has no IM Integration",
            )
        return integration_from_record(record)

    def load_contact_im_binding_view(
        self,
        *,
        tenant_id: TenantId,
        integration_id: IntegrationId,
        contact_id: ContactId,
    ) -> ContactIMBindingView:
        """Project the current effective binding after a protected mutation."""

        self._write_lock.ensure_owned()
        contact = self._require_contact_available_in_workspace(tenant_id, contact_id)
        binding_values = self._contact_im_binding_repository.get_im_bindings(tenant_id, (contact_id,))
        effective_binding = None
        for binding_value in binding_values:
            binding_record = self._session.get(HumanInputIMBinding, str(binding_value.id))
            if binding_record is not None and binding_record.integration_id == str(integration_id):
                effective_binding = binding_record
                break
        return ContactIMBindingView(
            id=ContactId(contact.id),
            type=HumanInputContactType(contact.type.value),
            name=contact.name,
            email=contact.email,
            avatar_file_id=contact.avatar_file_id,
            im_bindings=(binding_from_record(effective_binding),) if effective_binding is not None else (),
            created_at=contact.created_at,
        )

    def _require_owned_integration(
        self,
        organization_scope: DirectoryScope,
        integration_id: IntegrationId,
    ) -> HumanInputIMIntegration:
        integration = self._session.get(HumanInputIMIntegration, str(integration_id))
        if integration is None:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.INTEGRATION_NOT_CONFIGURED,
                "Organization has no IM Integration",
            )
        try:
            self._ensure_scope_owns_record(organization_scope, integration)
        except ValueError as error:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.INTEGRATION_NOT_CONFIGURED,
                "Organization has no IM Integration",
            ) from error
        return integration

    def _require_integration_identity(
        self,
        integration: HumanInputIMIntegration,
        identity_id: IMIdentityId,
    ) -> HumanInputIMIdentity:
        identity = self._session.get(HumanInputIMIdentity, str(identity_id))
        if (
            identity is None
            or identity.integration_id != integration.id
            or identity.provider is not integration.provider
        ):
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.IDENTITY_NOT_FOUND,
                "IM identity was not found for the current Integration",
            )
        return identity

    def _require_organization_contact(
        self,
        organization_scope: DirectoryScope,
        contact_id: ContactId,
    ) -> None:
        if isinstance(organization_scope, WorkspaceScope):
            contact = self._contact_repository.get_contacts_by_id(organization_scope.id, contact_id)
            valid = contact is not None and contact.type is ContactType.WORKSPACE
        elif isinstance(organization_scope, DeploymentScope):
            valid = self._require_deployment_contacts().get_contact(contact_id) is not None
        else:
            raise TypeError("unsupported Organization write scope")
        if not valid:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.CONTACT_NOT_FOUND,
                "Contact was not found in the current Organization",
            )

    @staticmethod
    def _ensure_workspace_belongs_to_scope(
        organization_scope: DirectoryScope,
        tenant_id: TenantId,
    ) -> None:
        if isinstance(organization_scope, WorkspaceScope) and tenant_id != organization_scope.id:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.INVALID_SCOPE,
                "Workspace override does not belong to the Organization scope",
            )
        if not isinstance(organization_scope, WorkspaceScope | DeploymentScope):
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.INVALID_SCOPE,
                "Unsupported Organization scope",
            )

    def _require_contact_available_in_workspace(
        self,
        tenant_id: TenantId,
        contact_id: ContactId,
    ) -> Contact:
        contact = self._contact_repository.get_contacts_by_id(tenant_id, contact_id)
        if contact is None or contact.type is ContactType.EXTERNAL:
            raise IMBindingCommandError(
                IMBindingCommandErrorCode.CONTACT_NOT_FOUND,
                "Contact was not found in the current workspace",
            )
        return contact

    def load_reconciliation_input(
        self,
        run: ReconciliationRunRef,
        directory_entries: tuple[DirectoryEntry, ...],
        contact_scope: DirectoryScope,
    ) -> ReconciliationInput:
        """Load one complete scope-resolved planner input without row locks."""

        self._write_lock.ensure_owned()
        run_record = self._session.get(HumanInputIMSyncRun, str(run.sync_run_id))
        if run_record is None:
            raise ValueError("sync run not found")
        if (
            run_record.integration_id != str(run.integration_revision.integration_id)
            or run_record.integration_config_version != run.integration_revision.config_version
            or run_record.provider is not run.provider
        ):
            raise ValueError("sync run capture does not match reconciliation input")
        integration_record = self._session.get(
            HumanInputIMIntegration,
            str(run.integration_revision.integration_id),
        )
        if integration_record is None:
            raise ValueError("IM Integration not found")
        if isinstance(contact_scope, WorkspaceScope):
            if integration_record.tenant_id != str(contact_scope.id):
                raise ValueError("Contact scope does not own IM Integration")
        elif isinstance(contact_scope, DeploymentScope):
            if integration_record.tenant_id is not None:
                raise ValueError("Contact scope does not own IM Integration")
        else:
            raise TypeError("unsupported Contact scope")

        identity_records = self._session.scalars(
            select(HumanInputIMIdentity)
            .where(
                HumanInputIMIdentity.integration_id == str(run.integration_revision.integration_id),
                HumanInputIMIdentity.provider == run.provider,
            )
            .order_by(HumanInputIMIdentity.id)
        ).all()
        identity_ids = tuple(record.id for record in identity_records)
        binding_records = (
            self._session.scalars(
                select(HumanInputIMBinding)
                .where(HumanInputIMBinding.im_identity_id.in_(identity_ids))
                .order_by(HumanInputIMBinding.id)
            ).all()
            if identity_ids
            else ()
        )
        contacts = self._load_contacts_for_email_matching(contact_scope)
        contact_states: list[ContactEmailMatchState] = []
        for contact in contacts:
            if contact.email is None:
                continue
            contact_states.append(
                ContactEmailMatchState(
                    contact.id,
                    contact.name,
                    contact.email,
                    NormalizedEmail(contact.email),
                    contact.avatar_file_id,
                )
            )
        return ReconciliationInput(
            run=run,
            directory_entries=directory_entries,
            current_identities=tuple(
                CurrentIMIdentityState(
                    IMIdentityId(record.id),
                    ProviderUserId(record.provider_user_id),
                    record.display_name,
                    record.email,
                    NormalizedEmail(record.normalized_email) if record.normalized_email else None,
                    IMSyncRunId(record.last_seen_sync_run_id) if record.last_seen_sync_run_id else None,
                )
                for record in identity_records
            ),
            current_bindings=tuple(
                CurrentIMBindingState(
                    IMBindingId(record.id),
                    IMIdentityId(record.im_identity_id),
                    ContactId(record.contact_id),
                )
                for record in binding_records
            ),
            reconciled_binding_ids=frozenset(
                IMBindingId(record.id) for record in binding_records if record.scope is IMBindingScope.ORGANIZATION
            ),
            contacts_for_email_matching=tuple(contact_states),
        )

    def _load_contacts_for_email_matching(
        self,
        contact_scope: DirectoryScope,
    ) -> tuple[Contact, ...]:
        contacts: list[Contact] = []
        page = 1
        page_limit = 500
        if isinstance(contact_scope, WorkspaceScope):
            for contact_type in (ContactType.WORKSPACE, ContactType.PLATFORM):
                page = 1
                while True:
                    contact_page = self._contact_repository.list_contact(
                        contact_scope.id,
                        page,
                        page_limit,
                        ContactQuery(contact_type=contact_type),
                    )
                    contacts.extend(contact_page.items)
                    if len(contact_page.items) < page_limit:
                        break
                    page += 1
            return tuple(contacts)
        if isinstance(contact_scope, DeploymentScope):
            while True:
                deployment_page = self._require_deployment_contacts().list_contacts(page, page_limit)
                contacts.extend(contact for contact in deployment_page if contact.email is not None)
                if len(deployment_page) < page_limit:
                    break
                page += 1
            return tuple(contacts)
        raise TypeError("unsupported Contact scope")

    def apply_plan(self, plan: ReconciliationPlan, *, now: NaiveDatetime) -> ApplyReconciliationResult:
        self._write_lock.ensure_owned()
        run_record = self._session.get(HumanInputIMSyncRun, str(plan.run.sync_run_id))
        if run_record is None:
            raise ValueError("sync run not found")
        if run_record.status in (IMSyncRunStatus.SUCCEEDED, IMSyncRunStatus.FAILED):
            return self._terminal_result(plan.run.sync_run_id, run_record)
        if (
            run_record.integration_id != str(plan.run.integration_revision.integration_id)
            or run_record.integration_config_version != plan.run.integration_revision.config_version
            or run_record.provider is not plan.run.provider
        ):
            return self._fail_run(run_record, plan.run.sync_run_id, ApplyReconciliationStatus.STALE_REVISION, now)
        integration = self._session.scalar(
            select(HumanInputIMIntegration).where(
                HumanInputIMIntegration.id == str(plan.run.integration_revision.integration_id),
                HumanInputIMIntegration.config_version == plan.run.integration_revision.config_version,
                HumanInputIMIntegration.provider == plan.run.provider,
            )
        )
        if integration is None:
            return self._fail_run(run_record, plan.run.sync_run_id, ApplyReconciliationStatus.STALE_REVISION, now)

        changes: list[IMReconciliationChange] = []
        identity_id_by_new_ref: dict[NewIMIdentityRef, IMIdentityId] = {}
        binding_id_by_identity_contact: dict[tuple[IMIdentityId, ContactId], IMBindingId] = {}
        try:
            with self._session.begin_nested():
                for upsert in plan.identity_upserts:
                    self._apply_identity_upsert(plan, upsert, now, identity_id_by_new_ref, changes)
                self._write_lock.ensure_owned()
                for mutation in plan.binding_mutations:
                    self._apply_binding_mutation(
                        plan,
                        mutation,
                        integration.tenant_id,
                        now,
                        identity_id_by_new_ref,
                        binding_id_by_identity_contact,
                        changes,
                    )
                for deletion in plan.identity_deletions:
                    self._delete_identity(
                        plan,
                        deletion.before,
                        deletion.operation_key,
                        deletion.reason.value,
                        now,
                        changes,
                    )
                sync_results = self._materialize_results(
                    plan,
                    now,
                    integration.tenant_id,
                    identity_id_by_new_ref,
                    binding_id_by_identity_contact,
                )
                for change in changes:
                    self._session.add(reconciliation_change_to_record(change))
                for sync_result in sync_results:
                    self._session.add(sync_result_to_record(sync_result))
                self._session.flush()
        except _PreconditionFailedError:
            return self._fail_run(
                run_record,
                plan.run.sync_run_id,
                ApplyReconciliationStatus.PRECONDITION_FAILED,
                now,
            )

        run_record.status = IMSyncRunStatus.SUCCEEDED
        run_record.added_count = sum(result.result_type is IMSyncResultType.ADDED for result in sync_results)
        run_record.not_matched_count = sum(
            result.result_type is IMSyncResultType.NOT_MATCHED for result in sync_results
        )
        run_record.failed_count = sum(result.result_type is IMSyncResultType.FAILED for result in sync_results)
        run_record.removed_count = sum(result.result_type is IMSyncResultType.REMOVED for result in sync_results)
        run_record.skipped_count = sum(result.result_type is IMSyncResultType.SKIPPED for result in sync_results)
        run_record.started_at = run_record.started_at or now
        run_record.finished_at = now
        run_record.updated_at = now
        warnings = tuple(
            ResolvedReconciliationWarning(
                warning_key=warning.warning_key,
                reason=warning.reason,
                identity_ids=tuple(
                    self._resolve_identity_ref(identity_ref, identity_id_by_new_ref)
                    for identity_ref in warning.identity_refs
                ),
                contact_ids=warning.contact_ids,
            )
            for warning in plan.warnings
        )
        return ApplyReconciliationResult(
            ApplyReconciliationStatus.APPLIED,
            plan.run.sync_run_id,
            now,
            len(sync_results),
            len(changes),
            warnings,
        )

    def fail_run(
        self,
        sync_run_id: IMSyncRunId,
        status: ApplyReconciliationStatus,
        *,
        now: NaiveDatetime,
        message: str,
    ) -> ApplyReconciliationResult:
        """Persist one terminal diagnostic without mutating reconciliation current state."""

        self._write_lock.ensure_owned()
        run_record = self._session.get(HumanInputIMSyncRun, str(sync_run_id))
        if run_record is None:
            raise ValueError("sync run not found")
        if run_record.status in (IMSyncRunStatus.SUCCEEDED, IMSyncRunStatus.FAILED):
            return self._terminal_result(sync_run_id, run_record)
        return self._fail_run(run_record, sync_run_id, status, now, message=message)

    def _apply_identity_upsert(
        self,
        plan: ReconciliationPlan,
        upsert: IMIdentityUpsert,
        now: NaiveDatetime,
        identity_id_by_new_ref: dict[NewIMIdentityRef, IMIdentityId],
        changes: list[IMReconciliationChange],
    ) -> None:
        if upsert.kind is IMIdentityUpsertKind.CREATE:
            if not isinstance(upsert.identity_ref, NewIMIdentityRef):
                raise _PreconditionFailedError("identity create reference is invalid")
            identity_id = IMIdentityId(str(uuidv7()))
            identity_id_by_new_ref[upsert.identity_ref] = identity_id
            record = HumanInputIMIdentity(
                integration_id=str(plan.run.integration_revision.integration_id),
                provider=plan.run.provider,
                provider_user_id=str(upsert.entry.provider_user_id),
                display_name=upsert.entry.display_name,
                normalized_name=upsert.entry.display_name.casefold() if upsert.entry.display_name else None,
                email=upsert.entry.email,
                normalized_email=str(upsert.normalized_email) if upsert.normalized_email else None,
                raw_payload=IMIdentityRawPayload({}),
                last_seen_sync_run_id=str(plan.run.sync_run_id),
                last_seen_at=now,
            )
            record.id = str(identity_id)
            self._session.add(record)
            after = self._identity_snapshot_from_record(record)
            self._append_identity_change(
                plan,
                upsert.operation_key,
                upsert.kind,
                upsert,
                identity_id,
                None,
                after,
                now,
                changes,
            )
            return

        if not isinstance(upsert.identity_ref, ExistingIMIdentityRef) or upsert.before is None:
            raise _PreconditionFailedError("identity update reference is invalid")
        before = upsert.before
        statement = (
            sa.update(HumanInputIMIdentity)
            .where(
                HumanInputIMIdentity.id == str(before.identity_id),
                HumanInputIMIdentity.integration_id == str(plan.run.integration_revision.integration_id),
                HumanInputIMIdentity.provider_user_id == str(before.provider_user_id),
                _nullable_equal(HumanInputIMIdentity.display_name, before.display_name),
                _nullable_equal(HumanInputIMIdentity.email, before.email),
                _nullable_equal(
                    HumanInputIMIdentity.normalized_email,
                    str(before.normalized_email) if before.normalized_email else None,
                ),
            )
            .values(
                display_name=upsert.entry.display_name,
                normalized_name=upsert.entry.display_name.casefold() if upsert.entry.display_name else None,
                email=upsert.entry.email,
                normalized_email=str(upsert.normalized_email) if upsert.normalized_email else None,
                last_seen_sync_run_id=str(plan.run.sync_run_id),
                last_seen_at=now,
                updated_at=now,
            )
        )
        if self._session.connection().execute(statement).rowcount != 1:
            raise _PreconditionFailedError("identity precondition changed")
        record = self._session.get_one(HumanInputIMIdentity, str(before.identity_id))
        self._session.refresh(record)
        after = self._identity_snapshot_from_record(record)
        self._append_identity_change(
            plan,
            upsert.operation_key,
            upsert.kind,
            upsert,
            before.identity_id,
            self._identity_snapshot_from_state(before, plan.run.provider),
            after,
            now,
            changes,
        )

    def _apply_binding_mutation(
        self,
        plan: ReconciliationPlan,
        mutation: CreateIMBinding | ReplaceIMBinding | DeleteIMBinding,
        integration_tenant_id: str | None,
        now: NaiveDatetime,
        identity_id_by_new_ref: dict[NewIMIdentityRef, IMIdentityId],
        binding_id_by_identity_contact: dict[tuple[IMIdentityId, ContactId], IMBindingId],
        changes: list[IMReconciliationChange],
    ) -> None:
        if isinstance(mutation, CreateIMBinding):
            identity_id = self._resolve_identity_ref(mutation.identity_ref, identity_id_by_new_ref)
            self._require_contact_precondition(mutation.contact_precondition, integration_tenant_id)
            occupied = self._session.scalar(
                select(HumanInputIMBinding.id).where(
                    HumanInputIMBinding.integration_id == str(plan.run.integration_revision.integration_id),
                    HumanInputIMBinding.scope == IMBindingScope.ORGANIZATION,
                    sa.or_(
                        HumanInputIMBinding.contact_id == str(mutation.contact_id),
                        HumanInputIMBinding.im_identity_id == str(identity_id),
                    ),
                )
            )
            if occupied is not None:
                raise _PreconditionFailedError("automatic binding target is occupied")
            binding_id = IMBindingId(str(uuidv7()))
            record = HumanInputIMBinding(
                integration_id=str(plan.run.integration_revision.integration_id),
                scope=IMBindingScope.ORGANIZATION,
                scope_id=str(plan.run.integration_revision.integration_id),
                contact_id=str(mutation.contact_id),
                im_identity_id=str(identity_id),
                provider=plan.run.provider,
                bound_by_account_id=None,
            )
            record.id = str(binding_id)
            self._session.add(record)
            binding_id_by_identity_contact[(identity_id, mutation.contact_id)] = binding_id
            after = IMBindingChangeSnapshot(binding_id, identity_id, mutation.contact_id)
            changes.append(
                self._binding_change(
                    plan,
                    mutation.operation_key,
                    IMReconciliationOperation.CREATE,
                    mutation.reason.value,
                    after,
                    None,
                    after,
                    now,
                )
            )
            return
        before = mutation.before
        before_snapshot = IMBindingChangeSnapshot(before.binding_id, before.identity_id, before.contact_id)
        if isinstance(mutation, ReplaceIMBinding):
            next_identity_id = self._resolve_identity_ref(mutation.next_identity_ref, identity_id_by_new_ref)
            self._require_contact_precondition(mutation.contact_precondition, integration_tenant_id)
            replacement_statement = (
                sa.update(HumanInputIMBinding)
                .where(
                    HumanInputIMBinding.id == str(before.binding_id),
                    HumanInputIMBinding.integration_id == str(plan.run.integration_revision.integration_id),
                    HumanInputIMBinding.im_identity_id == str(before.identity_id),
                    HumanInputIMBinding.contact_id == str(before.contact_id),
                )
                .values(im_identity_id=str(next_identity_id), updated_at=now)
            )
            if self._session.connection().execute(replacement_statement).rowcount != 1:
                raise _PreconditionFailedError("IM binding replacement precondition changed")
            after_snapshot = IMBindingChangeSnapshot(before.binding_id, next_identity_id, before.contact_id)
            binding_id_by_identity_contact[(next_identity_id, before.contact_id)] = before.binding_id
            changes.append(
                self._binding_change(
                    plan,
                    mutation.operation_key,
                    IMReconciliationOperation.REPLACE,
                    mutation.reason.value,
                    after_snapshot,
                    before_snapshot,
                    after_snapshot,
                    now,
                )
            )
            return
        deletion_statement = sa.delete(HumanInputIMBinding).where(
            HumanInputIMBinding.id == str(before.binding_id),
            HumanInputIMBinding.integration_id == str(plan.run.integration_revision.integration_id),
            HumanInputIMBinding.im_identity_id == str(before.identity_id),
            HumanInputIMBinding.contact_id == str(before.contact_id),
        )
        if self._session.connection().execute(deletion_statement).rowcount != 1:
            raise _PreconditionFailedError("IM binding deletion precondition changed")
        changes.append(
            self._binding_change(
                plan,
                mutation.operation_key,
                IMReconciliationOperation.DELETE,
                mutation.reason.value,
                before_snapshot,
                before_snapshot,
                None,
                now,
            )
        )

    def _delete_identity(
        self,
        plan: ReconciliationPlan,
        before: CurrentIMIdentityState,
        operation_key: str,
        reason_code: str,
        now: NaiveDatetime,
        changes: list[IMReconciliationChange],
    ) -> None:
        referencing_binding = self._session.scalar(
            select(HumanInputIMBinding.id).where(HumanInputIMBinding.im_identity_id == str(before.identity_id)).limit(1)
        )
        if referencing_binding is not None:
            raise _PreconditionFailedError("identity is still referenced by an IM binding")
        statement = sa.delete(HumanInputIMIdentity).where(
            HumanInputIMIdentity.id == str(before.identity_id),
            HumanInputIMIdentity.integration_id == str(plan.run.integration_revision.integration_id),
            HumanInputIMIdentity.provider_user_id == str(before.provider_user_id),
            _nullable_equal(HumanInputIMIdentity.display_name, before.display_name),
            _nullable_equal(HumanInputIMIdentity.email, before.email),
            _nullable_equal(
                HumanInputIMIdentity.normalized_email,
                str(before.normalized_email) if before.normalized_email else None,
            ),
        )
        if self._session.connection().execute(statement).rowcount != 1:
            raise _PreconditionFailedError("identity deletion precondition changed")
        before_snapshot = self._identity_snapshot_from_state(before, plan.run.provider)
        changes.append(
            IMReconciliationChange(
                IMReconciliationChangeId(str(uuidv7())),
                plan.run.integration_revision.integration_id,
                plan.run.sync_run_id,
                operation_key,
                IMReconciliationSubjectKind.IDENTITY,
                IMReconciliationOperation.DELETE,
                reason_code,
                before.identity_id,
                None,
                None,
                before_snapshot,
                None,
                now,
            )
        )

    def _materialize_results(
        self,
        plan: ReconciliationPlan,
        now: NaiveDatetime,
        integration_tenant_id: str | None,
        identity_id_by_new_ref: dict[NewIMIdentityRef, IMIdentityId],
        binding_id_by_identity_contact: dict[tuple[IMIdentityId, ContactId], IMBindingId],
    ) -> tuple[SyncResultFact, ...]:
        results: list[SyncResultFact] = []
        upsert_by_provider_id = {upsert.entry.provider_user_id: upsert for upsert in plan.identity_upserts}
        removal_reason_by_binding_id: dict[IMBindingId, IMSyncRemovalReason] = {
            mutation.before.binding_id: mutation.removal_reason
            for mutation in plan.binding_mutations
            if isinstance(mutation, ReplaceIMBinding | DeleteIMBinding)
        }
        for planned in plan.sync_results:
            identity_id = (
                self._resolve_identity_ref(planned.identity_ref, identity_id_by_new_ref)
                if planned.identity_ref is not None
                else None
            )
            upsert = upsert_by_provider_id.get(planned.provider_user_id) if planned.provider_user_id else None
            identity_record = (
                self._session.get(HumanInputIMIdentity, str(identity_id)) if identity_id is not None else None
            )
            contact = (
                self._load_sync_result_contact(planned.contact_id, integration_tenant_id)
                if planned.contact_id is not None
                else None
            )
            binding_id = planned.binding_id
            if binding_id is None and identity_id is not None and planned.contact_id is not None:
                binding_id = binding_id_by_identity_contact.get((identity_id, planned.contact_id))
            removal_reason = (
                removal_reason_by_binding_id.get(planned.binding_id) if planned.binding_id is not None else None
            )
            results.append(
                SyncResultFact(
                    id=IMSyncResultId(str(uuidv7())),
                    integration_id=plan.run.integration_revision.integration_id,
                    sync_run_id=plan.run.sync_run_id,
                    operation_key=planned.operation_key,
                    result_type=planned.result_type,
                    provider_user_id=str(planned.provider_user_id) if planned.provider_user_id else None,
                    display_name=upsert.entry.display_name if upsert is not None else None,
                    email=upsert.entry.email if upsert is not None else None,
                    normalized_email=upsert.normalized_email if upsert is not None else None,
                    contact_id=planned.contact_id,
                    identity_id=identity_id,
                    binding_id=binding_id,
                    removal_reason=removal_reason,
                    reason_code=planned.reason_code,
                    reason_message=None,
                    directory_entry_payload=None,
                    contact_snapshot=(
                        SyncContactSnapshot(
                            contact.id,
                            contact.name,
                            contact.email,
                            contact.avatar_file_id,
                            contact.created_at,
                        )
                        if contact is not None
                        else None
                    ),
                    identity_snapshot=(
                        SyncIdentitySnapshot(
                            identity_id,
                            identity_record.provider,
                            identity_record.provider_user_id,
                            identity_record.display_name,
                            identity_record.email,
                        )
                        if identity_record is not None and identity_id is not None
                        else None
                    ),
                    created_at=now,
                    updated_at=now,
                )
            )
        return tuple(results)

    def _load_sync_result_contact(
        self,
        contact_id: ContactId,
        integration_tenant_id: str | None,
    ) -> Contact | None:
        if integration_tenant_id is not None:
            return self._contact_repository.get_contacts_by_id(TenantId(integration_tenant_id), contact_id)
        return self._require_deployment_contacts().get_contact(contact_id)

    def _append_identity_change(
        self,
        plan: ReconciliationPlan,
        operation_key: str,
        kind: IMIdentityUpsertKind,
        upsert: IMIdentityUpsert,
        identity_id: IMIdentityId,
        before: IMIdentityChangeSnapshot | None,
        after: IMIdentityChangeSnapshot,
        now: NaiveDatetime,
        changes: list[IMReconciliationChange],
    ) -> None:
        operation = {
            IMIdentityUpsertKind.CREATE: IMReconciliationOperation.CREATE,
            IMIdentityUpsertKind.UPDATE: IMReconciliationOperation.UPDATE,
            IMIdentityUpsertKind.REFRESH: IMReconciliationOperation.REFRESH,
        }[kind]
        changes.append(
            IMReconciliationChange(
                IMReconciliationChangeId(str(uuidv7())),
                plan.run.integration_revision.integration_id,
                plan.run.sync_run_id,
                operation_key,
                IMReconciliationSubjectKind.IDENTITY,
                operation,
                "directory_identity_observed",
                identity_id,
                None,
                None,
                before,
                after,
                now,
            )
        )

    @staticmethod
    def _binding_change(
        plan: ReconciliationPlan,
        operation_key: str,
        operation: IMReconciliationOperation,
        reason_code: str,
        subject_snapshot: IMBindingChangeSnapshot,
        before: IMBindingChangeSnapshot | None,
        after: IMBindingChangeSnapshot | None,
        now: NaiveDatetime,
    ) -> IMReconciliationChange:
        return IMReconciliationChange(
            IMReconciliationChangeId(str(uuidv7())),
            plan.run.integration_revision.integration_id,
            plan.run.sync_run_id,
            operation_key,
            IMReconciliationSubjectKind.BINDING,
            operation,
            reason_code,
            subject_snapshot.identity_id,
            subject_snapshot.binding_id,
            subject_snapshot.contact_id,
            before,
            after,
            now,
        )

    @staticmethod
    def _identity_snapshot_from_state(
        state: CurrentIMIdentityState,
        provider: IMProvider,
    ) -> IMIdentityChangeSnapshot:
        return IMIdentityChangeSnapshot(
            state.identity_id,
            provider,
            state.provider_user_id,
            state.display_name,
            state.email,
            state.normalized_email,
            state.last_seen_sync_run_id,
        )

    @staticmethod
    def _identity_snapshot_from_record(record: HumanInputIMIdentity) -> IMIdentityChangeSnapshot:
        return IMIdentityChangeSnapshot(
            IMIdentityId(record.id),
            record.provider,
            ProviderUserId(record.provider_user_id),
            record.display_name,
            record.email,
            NormalizedEmail(record.normalized_email) if record.normalized_email else None,
            IMSyncRunId(record.last_seen_sync_run_id) if record.last_seen_sync_run_id else None,
        )

    def _require_contact_precondition(
        self,
        precondition: ContactEmailMatchState,
        integration_tenant_id: str | None,
    ) -> None:
        if integration_tenant_id is None:
            contact = self._require_deployment_contacts().get_contact(precondition.contact_id)
        else:
            contact = self._contact_repository.get_contacts_by_id(
                TenantId(integration_tenant_id),
                precondition.contact_id,
            )
        if (
            contact is None
            or contact.type is ContactType.EXTERNAL
            or contact.name != precondition.display_name
            or contact.email != precondition.email
            or contact.email is None
            or NormalizedEmail(contact.email) != precondition.normalized_email
            or contact.avatar_file_id != precondition.avatar_file_id
        ):
            raise _PreconditionFailedError("automatic binding Contact precondition changed")

    def _require_deployment_contacts(self) -> DeploymentContactReader:
        if self._deployment_contacts is None:
            raise RuntimeError("Deployment Contact reads require the Enterprise composition boundary")
        return self._deployment_contacts

    @staticmethod
    def _resolve_identity_ref(
        identity_ref: ExistingIMIdentityRef | NewIMIdentityRef,
        identity_id_by_new_ref: dict[NewIMIdentityRef, IMIdentityId],
    ) -> IMIdentityId:
        if isinstance(identity_ref, ExistingIMIdentityRef):
            return identity_ref.identity_id
        identity_id = identity_id_by_new_ref.get(identity_ref)
        if identity_id is None:
            raise _PreconditionFailedError("new identity reference was not resolved")
        return identity_id

    def _terminal_result(
        self,
        sync_run_id: IMSyncRunId,
        run_record: HumanInputIMSyncRun,
    ) -> ApplyReconciliationResult:
        result_count = (
            self._session.scalar(
                select(sa.func.count(HumanInputIMSyncResult.id)).where(
                    HumanInputIMSyncResult.sync_run_id == str(sync_run_id)
                )
            )
            or 0
        )
        change_count = (
            self._session.scalar(
                select(sa.func.count(HumanInputIMReconciliationChange.id)).where(
                    HumanInputIMReconciliationChange.sync_run_id == str(sync_run_id)
                )
            )
            or 0
        )
        status = ApplyReconciliationStatus.ALREADY_APPLIED
        if run_record.status is IMSyncRunStatus.FAILED:
            for failed_status in (
                ApplyReconciliationStatus.STALE_REVISION,
                ApplyReconciliationStatus.LOCK_UNAVAILABLE,
                ApplyReconciliationStatus.LOCK_LOST,
                ApplyReconciliationStatus.PRECONDITION_FAILED,
                ApplyReconciliationStatus.DIRECTORY_READ_FAILED,
                ApplyReconciliationStatus.PLAN_BLOCKED,
                ApplyReconciliationStatus.UNEXPECTED_APPLY_FAILURE,
            ):
                if run_record.error_code == failed_status.value:
                    status = failed_status
                    break
        return ApplyReconciliationResult(
            status,
            sync_run_id,
            run_record.finished_at,
            result_count,
            change_count,
            (),
        )

    def _fail_run(
        self,
        run_record: HumanInputIMSyncRun,
        sync_run_id: IMSyncRunId,
        status: ApplyReconciliationStatus,
        now: NaiveDatetime,
        *,
        message: str | None = None,
    ) -> ApplyReconciliationResult:
        diagnostic_message = message or f"IM reconciliation ended with {status.value}."
        diagnostic = SyncResultFact(
            id=IMSyncResultId(str(uuidv7())),
            integration_id=IntegrationId(run_record.integration_id),
            sync_run_id=sync_run_id,
            operation_key=f"diagnostic:{status.value}",
            result_type=IMSyncResultType.FAILED,
            provider_user_id=None,
            display_name=None,
            email=None,
            normalized_email=None,
            contact_id=None,
            identity_id=None,
            binding_id=None,
            removal_reason=None,
            reason_code=status.value,
            reason_message=diagnostic_message,
            directory_entry_payload=None,
            contact_snapshot=None,
            identity_snapshot=None,
            created_at=now,
            updated_at=now,
        )
        self._session.add(sync_result_to_record(diagnostic))
        run_record.status = IMSyncRunStatus.FAILED
        run_record.failed_count = 1
        run_record.started_at = run_record.started_at or now
        run_record.finished_at = now
        run_record.error_code = status.value
        run_record.error_message = diagnostic_message
        run_record.updated_at = now
        return ApplyReconciliationResult(status, sync_run_id, now, 1, 0, ())


def create_session_bound_reconciliation_repository(
    session: Session,
    write_lock: OwnedOrganizationWriteLock,
    deployment_contacts: DeploymentContactReader | None = None,
) -> SQLAlchemySessionBoundIMRepository:
    """Bind reconciliation repositories to the caller-owned Session."""

    return SQLAlchemySessionBoundIMRepository(session, write_lock, deployment_contacts)


def _nullable_equal(column, value: str | None):
    return column.is_(None) if value is None else column == value
