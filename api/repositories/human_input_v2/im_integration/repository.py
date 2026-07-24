"""SQLAlchemy IM Control Plane adapter.

Configuration transitions, active-run creation, and reconciliation apply each
own their complete transaction. Integration locks serialize single-active-run
decisions. ORM records never cross this boundary, and aggregate relationships
are loaded explicitly because their model relationships use ``lazy="raise"``.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from core.human_input_v2.contact_directory import ContactSnapshot
from core.human_input_v2.entities import (
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
    BindingResolutionKind,
    BindingResolutionResult,
    ConfigurationTransition,
    ConfigurationTransitionKind,
    EffectiveBindingResolver,
    IMBinding,
    IMIdentity,
    IMIntegration,
    IMIntegrationState,
    IMSyncRun,
    IntegrationDeletion,
    IntegrationRevisionToken,
    MatchKind,
    ReconciliationAction,
    ReconciliationPlan,
    ReconciliationSnapshot,
    StaleRevision,
    SyncContactSnapshot,
    SyncIdentitySnapshot,
    SyncResultFact,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    UtcTimestamp,
    WorkspaceId,
)
from libs.uuid_utils import uuidv7
from models.account import Account, AccountStatus
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
    binding_to_record,
    identity_from_record,
    identity_to_record,
    integration_from_record,
    integration_to_record,
    sync_result_from_record,
    sync_result_to_record,
    sync_run_from_record,
    sync_run_to_record,
)


class SQLAlchemyIMControlPlaneRepository:
    """Transactional adapter for configuration, sync, and binding invariants."""

    _session_maker: sessionmaker[Session]

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def create_integration(self, integration: IMIntegration) -> IMIntegration:
        """Create the first configuration for an owner scope."""

        with self._session_maker() as session, session.begin():
            record = integration_to_record(integration)
            session.add(record)
            session.flush()
            return integration_from_record(record)

    def compare_and_swap_configuration(self, transition: ConfigurationTransition) -> IMIntegration | StaleRevision:
        """Apply a complete-token rotation or replacement in one transaction."""

        with self._session_maker() as session, session.begin():
            current = session.scalar(self._locked_integration_statement(transition.expected_revision))
            if current is None:
                return StaleRevision(
                    transition.expected_revision,
                    self._current_revision(session, transition.expected_revision.integration_id),
                )

            if transition.kind is ConfigurationTransitionKind.CREDENTIAL_ROTATION:
                self._copy_integration_values(current, transition.integration)
                session.flush()
                return integration_from_record(current)

            session.execute(
                sa.delete(HumanInputIMBinding).where(
                    HumanInputIMBinding.integration_id == str(transition.expected_revision.integration_id)
                )
            )
            session.execute(
                sa.delete(HumanInputIMIdentity).where(
                    HumanInputIMIdentity.integration_id == str(transition.expected_revision.integration_id)
                )
            )
            session.delete(current)
            session.flush()
            replacement = integration_to_record(transition.integration)
            session.add(replacement)
            session.flush()
            return integration_from_record(replacement)

    def compare_and_swap_delete(self, deletion: IntegrationDeletion | StaleRevision) -> None | StaleRevision:
        """Delete current configuration and current children under complete CAS."""

        if isinstance(deletion, StaleRevision):
            return deletion
        with self._session_maker() as session, session.begin():
            current = session.scalar(self._locked_integration_statement(deletion.expected_revision))
            if current is None:
                return StaleRevision(
                    deletion.expected_revision,
                    self._current_revision(session, deletion.expected_revision.integration_id),
                )
            integration_id = str(deletion.expected_revision.integration_id)
            session.execute(sa.delete(HumanInputIMBinding).where(HumanInputIMBinding.integration_id == integration_id))
            session.execute(
                sa.delete(HumanInputIMIdentity).where(HumanInputIMIdentity.integration_id == integration_id)
            )
            session.delete(current)
        return None

    def create_or_get_active_run(
        self,
        integration_revision: IntegrationRevisionToken,
        *,
        sync_run_id: IMSyncRunId,
        started_by_account_id: AccountId | None,
        now: UtcTimestamp,
    ) -> ActiveRunDecision:
        """Serialize trigger decisions by locking the owning Integration row."""

        with self._session_maker() as session, session.begin():
            integration = session.scalar(self._locked_integration_statement(integration_revision))
            if integration is None:
                return ActiveRunDecision(
                    kind=ActiveRunDecisionKind.STALE_REVISION,
                    run=None,
                    stale_revision=StaleRevision(
                        integration_revision,
                        self._current_revision(session, integration_revision.integration_id),
                    ),
                )
            existing = session.scalar(
                select(HumanInputIMSyncRun)
                .where(
                    HumanInputIMSyncRun.integration_id == str(integration_revision.integration_id),
                    HumanInputIMSyncRun.status.in_((IMSyncRunStatus.QUEUED, IMSyncRunStatus.RUNNING)),
                )
                .order_by(HumanInputIMSyncRun.created_at, HumanInputIMSyncRun.id)
                .limit(1)
            )
            if existing is not None:
                return ActiveRunDecision(ActiveRunDecisionKind.EXISTING_ACTIVE, sync_run_from_record(existing))
            run = IMSyncRun.create(
                sync_run_id=sync_run_id,
                integration_revision=integration_revision,
                provider=integration.provider,
                started_by_account_id=started_by_account_id,
                now=now,
            )
            record = sync_run_to_record(run)
            session.add(record)
            session.flush()
            return ActiveRunDecision(ActiveRunDecisionKind.CREATED, sync_run_from_record(record))

    def load_reconciliation_snapshot(self, sync_run_id: IMSyncRunId) -> ReconciliationSnapshot:
        """Load current identities, bindings, and owner-scoped Contact facts."""

        with self._session_maker() as session, session.begin():
            run = session.get_one(HumanInputIMSyncRun, str(sync_run_id))
            integration = session.get_one(HumanInputIMIntegration, run.integration_id)
            identity_records = session.scalars(
                select(HumanInputIMIdentity).where(
                    HumanInputIMIdentity.integration_id == run.integration_id,
                    HumanInputIMIdentity.provider == run.provider,
                )
            ).all()
            binding_records = session.scalars(
                select(HumanInputIMBinding).where(HumanInputIMBinding.integration_id == run.integration_id)
            ).all()
            contact_statement = select(HumanInputContact)
            if integration.tenant_id is not None:
                contact_statement = contact_statement.where(
                    sa.or_(
                        HumanInputContact.tenant_id == integration.tenant_id,
                        HumanInputContact.tenant_id.is_(None),
                    )
                )
            contact_records = session.scalars(contact_statement).all()
            account_ids = {record.account_id for record in contact_records if record.account_id is not None}
            unavailable_account_ids = set(
                session.scalars(
                    select(Account.id).where(
                        Account.id.in_(account_ids),
                        Account.status != AccountStatus.ACTIVE,
                    )
                ).all()
                if account_ids
                else ()
            )
            contacts = tuple(contact_from_record(record) for record in contact_records)
            return ReconciliationSnapshot(
                identities=tuple(identity_from_record(record) for record in identity_records),
                bindings=tuple(binding_from_record(record) for record in binding_records),
                contacts=tuple(
                    ContactSnapshot(
                        contact,
                        contact.account_id is None or str(contact.account_id) not in unavailable_account_ids,
                    )
                    for contact in contacts
                ),
            )

    def apply_reconciliation(self, plan: ReconciliationPlan, *, now: UtcTimestamp) -> ApplyReconciliationResult:
        """Idempotently apply one plan after rechecking its captured token."""

        with self._session_maker() as session, session.begin():
            run_record = session.scalar(
                select(HumanInputIMSyncRun).where(HumanInputIMSyncRun.id == str(plan.sync_run_id)).with_for_update()
            )
            if run_record is None:
                raise ValueError("sync run not found")
            if run_record.integration_id != str(plan.integration_revision.integration_id):
                raise ValueError("sync run integration does not match plan")

            existing_results = self._load_result_records(session, plan.sync_run_id)
            if run_record.status in (IMSyncRunStatus.SUCCEEDED, IMSyncRunStatus.FAILED):
                return ApplyReconciliationResult(
                    ApplyReconciliationStatus.ALREADY_APPLIED,
                    sync_run_from_record(run_record),
                    tuple(sync_result_from_record(record) for record in existing_results),
                )

            integration_record = session.scalar(self._locked_integration_statement(plan.integration_revision))
            if integration_record is None:
                stale_result = self._stale_result(plan, now)
                self._append_result_record(session, stale_result)
                run_record.status = IMSyncRunStatus.FAILED
                run_record.failed_count = 1
                run_record.started_at = run_record.started_at or now.value
                run_record.finished_at = now.value
                run_record.error_code = "stale_integration_revision"
                run_record.error_message = "Integration configuration changed before reconciliation apply."
                run_record.updated_at = now.value
                session.flush()
                return ApplyReconciliationResult(
                    ApplyReconciliationStatus.STALE_REVISION,
                    sync_run_from_record(run_record),
                    (stale_result,),
                )

            results: list[SyncResultFact] = []
            for action in plan.actions:
                result = self._apply_action(session, plan, action, now)
                self._append_result_record(session, result)
                results.append(result)
            for identity_id in plan.removed_identity_ids:
                removal_result = self._remove_identity(session, plan, identity_id, now)
                if removal_result is not None:
                    self._append_result_record(session, removal_result)
                    results.append(removal_result)

            run_record.status = IMSyncRunStatus.SUCCEEDED
            run_record.added_count = sum(result.result_type is IMSyncResultType.ADDED for result in results)
            run_record.not_matched_count = sum(result.result_type is IMSyncResultType.NOT_MATCHED for result in results)
            run_record.failed_count = sum(result.result_type is IMSyncResultType.FAILED for result in results)
            run_record.removed_count = sum(result.result_type is IMSyncResultType.REMOVED for result in results)
            run_record.skipped_count = sum(result.result_type is IMSyncResultType.SKIPPED for result in results)
            run_record.started_at = run_record.started_at or now.value
            run_record.finished_at = now.value
            run_record.updated_at = now.value
            session.flush()
            return ApplyReconciliationResult(
                ApplyReconciliationStatus.APPLIED,
                sync_run_from_record(run_record),
                tuple(results),
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

    def resolve_effective_binding(
        self,
        *,
        integration_id: IntegrationId,
        provider: IMProvider,
        workspace_id: WorkspaceId,
        contact_id: ContactId,
    ) -> BindingResolutionResult:
        """Load mapped facts and expose one consumer-safe effective binding."""

        state = self.load_integration_state(integration_id)
        if state.integration.provider_tenant.provider is not provider:
            return BindingResolutionResult(BindingResolutionKind.INVALID_BINDING, None)
        with self._session_maker() as session, session.begin():
            contact_record = session.scalar(
                select(HumanInputContact).where(
                    HumanInputContact.id == str(contact_id),
                    sa.or_(HumanInputContact.tenant_id == str(workspace_id), HumanInputContact.tenant_id.is_(None)),
                )
            )
            if contact_record is None:
                return BindingResolutionResult(BindingResolutionKind.NOT_AVAILABLE, None)
            contact = ContactSnapshot(contact_from_record(contact_record), True)
        return EffectiveBindingResolver.resolve(
            integration_revision=state.integration.revision,
            provider_tenant=state.integration.provider_tenant,
            workspace_id=workspace_id,
            contact=contact,
            identities=state.identities,
            bindings=state.bindings,
        )

    def append_sync_results(self, results: tuple[SyncResultFact, ...]) -> None:
        """Append diagnostic facts in their own explicit transaction."""

        with self._session_maker() as session, session.begin():
            for result in results:
                self._append_result_record(session, result)

    @staticmethod
    def _locked_integration_statement(
        revision: IntegrationRevisionToken,
    ) -> sa.Select[tuple[HumanInputIMIntegration]]:
        """Build the complete CAS predicate and row lock used by write paths."""

        return (
            select(HumanInputIMIntegration)
            .where(
                HumanInputIMIntegration.id == str(revision.integration_id),
                HumanInputIMIntegration.config_version == revision.config_version,
            )
            .with_for_update()
        )

    @staticmethod
    def _current_revision(session: Session, integration_id: IntegrationId) -> IntegrationRevisionToken | None:
        record = session.get(HumanInputIMIntegration, str(integration_id))
        if record is None:
            return None
        return IntegrationRevisionToken(IntegrationId(record.id), record.config_version)

    @staticmethod
    def _copy_integration_values(record: HumanInputIMIntegration, integration: IMIntegration) -> None:
        mapped = integration_to_record(integration)
        record.provider = mapped.provider
        record.encrypted_credentials = mapped.encrypted_credentials
        record.tenant_id = mapped.tenant_id
        record.provider_tenant_id = mapped.provider_tenant_id
        record.status = mapped.status
        record.config_version = mapped.config_version
        record.configured_by_account_id = mapped.configured_by_account_id
        record.callback_url = mapped.callback_url
        record.safe_status_reason = mapped.safe_status_reason
        record.last_checked_at = mapped.last_checked_at
        record.updated_at = mapped.updated_at

    @staticmethod
    def _load_result_records(session: Session, sync_run_id: IMSyncRunId) -> list[HumanInputIMSyncResult]:
        return list(
            session.scalars(
                select(HumanInputIMSyncResult)
                .where(HumanInputIMSyncResult.sync_run_id == str(sync_run_id))
                .order_by(HumanInputIMSyncResult.created_at, HumanInputIMSyncResult.id)
            ).all()
        )

    def _apply_action(
        self,
        session: Session,
        plan: ReconciliationPlan,
        action: ReconciliationAction,
        now: UtcTimestamp,
    ) -> SyncResultFact:
        identity_record: HumanInputIMIdentity | None = None
        binding_record: HumanInputIMBinding | None = None
        contact_record: HumanInputContact | None = None

        if action.identity_id is not None:
            identity_record = session.scalar(
                select(HumanInputIMIdentity).where(
                    HumanInputIMIdentity.id == str(action.identity_id),
                    HumanInputIMIdentity.integration_id == str(plan.integration_revision.integration_id),
                )
            )
            if identity_record is None:
                raise ValueError("matched identity no longer exists")
            self._copy_entry_to_identity(identity_record, action, plan, now)
            if action.binding_id is not None:
                binding_record = session.get(HumanInputIMBinding, str(action.binding_id))
        elif action.match_kind is MatchKind.NORMALIZED_EMAIL and action.contact_id is not None:
            identity = IMIdentity.create(
                identity_id=IMIdentityId(str(uuidv7())),
                integration_id=plan.integration_revision.integration_id,
                provider=plan.provider,
                provider_user_id=action.entry.provider_user_id,
                display_name=action.entry.display_name,
                email=action.entry.email,
                raw_payload=action.entry.raw_payload.to_mapping(),
                last_seen_sync_run_id=plan.sync_run_id,
                last_seen_at=now,
                now=now,
            )
            identity_record = identity_to_record(identity)
            session.add(identity_record)
            binding = IMBinding.create(
                binding_id=IMBindingId(str(uuidv7())),
                integration_id=plan.integration_revision.integration_id,
                scope=IMBindingScope.ORGANIZATION,
                scope_id=str(plan.integration_revision.integration_id),
                contact_id=action.contact_id,
                identity_id=identity.id,
                provider=plan.provider,
                bound_by_account_id=None,
                now=now,
            )
            binding_record = binding_to_record(binding)
            session.add(binding_record)

        if action.contact_id is not None:
            contact_record = session.get(HumanInputContact, str(action.contact_id))

        result_type = (
            IMSyncResultType.NOT_MATCHED
            if action.match_kind is MatchKind.UNMATCHED
            else IMSyncResultType.ADDED
            if action.match_kind is MatchKind.NORMALIZED_EMAIL
            else IMSyncResultType.SKIPPED
        )
        return SyncResultFact(
            id=IMSyncResultId(str(uuidv7())),
            integration_id=plan.integration_revision.integration_id,
            sync_run_id=plan.sync_run_id,
            result_type=result_type,
            provider_user_id=action.entry.provider_user_id,
            display_name=action.entry.display_name,
            email=action.entry.email,
            normalized_email=action.entry.normalized_email,
            contact_id=action.contact_id,
            identity_id=IMIdentityId(identity_record.id) if identity_record is not None else None,
            binding_id=IMBindingId(binding_record.id) if binding_record is not None else None,
            removal_reason=None,
            reason_code="existing_provider_identity" if result_type is IMSyncResultType.SKIPPED else None,
            reason_message=None,
            directory_entry_payload=action.entry.raw_payload,
            contact_snapshot=(
                SyncContactSnapshot(
                    contact_id=ContactId(contact_record.id),
                    name=contact_record.name,
                    email=contact_record.email,
                    avatar_file_id=contact_record.avatar_file_id,
                )
                if contact_record is not None
                else None
            ),
            identity_snapshot=None,
            created_at=now,
            updated_at=now,
        )

    @staticmethod
    def _copy_entry_to_identity(
        record: HumanInputIMIdentity,
        action: ReconciliationAction,
        plan: ReconciliationPlan,
        now: UtcTimestamp,
    ) -> None:
        record.provider_user_id = action.entry.provider_user_id
        record.display_name = action.entry.display_name
        record.normalized_name = action.entry.display_name.casefold() if action.entry.display_name else None
        record.email = action.entry.email
        record.normalized_email = str(action.entry.normalized_email) if action.entry.normalized_email else None
        from models.human_input_v2 import IMIdentityRawPayload

        record.raw_payload = IMIdentityRawPayload(action.entry.raw_payload.to_mapping())
        record.last_seen_sync_run_id = str(plan.sync_run_id)
        record.last_seen_at = now.value
        record.updated_at = now.value

    def _remove_identity(
        self,
        session: Session,
        plan: ReconciliationPlan,
        identity_id: IMIdentityId,
        now: UtcTimestamp,
    ) -> SyncResultFact | None:
        record = session.scalar(
            select(HumanInputIMIdentity).where(
                HumanInputIMIdentity.id == str(identity_id),
                HumanInputIMIdentity.integration_id == str(plan.integration_revision.integration_id),
            )
        )
        if record is None:
            return None
        binding = session.scalar(
            select(HumanInputIMBinding).where(
                HumanInputIMBinding.integration_id == str(plan.integration_revision.integration_id),
                HumanInputIMBinding.im_identity_id == record.id,
            )
        )
        contact_record = session.get(HumanInputContact, binding.contact_id) if binding is not None else None
        result = SyncResultFact(
            id=IMSyncResultId(str(uuidv7())),
            integration_id=plan.integration_revision.integration_id,
            sync_run_id=plan.sync_run_id,
            result_type=IMSyncResultType.REMOVED,
            provider_user_id=record.provider_user_id,
            display_name=record.display_name,
            email=record.email,
            normalized_email=NormalizedEmail(record.normalized_email) if record.normalized_email is not None else None,
            contact_id=ContactId(binding.contact_id) if binding is not None else None,
            identity_id=identity_id,
            binding_id=IMBindingId(binding.id) if binding is not None else None,
            removal_reason=IMSyncRemovalReason.NOT_PRESENT_IN_DIRECTORY,
            reason_code="not_present_in_directory",
            reason_message=None,
            directory_entry_payload=None,
            contact_snapshot=(
                SyncContactSnapshot(
                    contact_id=ContactId(contact_record.id),
                    name=contact_record.name,
                    email=contact_record.email,
                    avatar_file_id=contact_record.avatar_file_id,
                )
                if contact_record is not None
                else None
            ),
            identity_snapshot=SyncIdentitySnapshot(
                identity_id=identity_id,
                provider=record.provider,
                provider_user_id=record.provider_user_id,
                display_name=record.display_name,
                email=record.email,
            ),
            created_at=now,
            updated_at=now,
        )
        if binding is not None:
            session.delete(binding)
        session.delete(record)
        return result

    @staticmethod
    def _stale_result(plan: ReconciliationPlan, now: UtcTimestamp) -> SyncResultFact:
        return SyncResultFact(
            id=IMSyncResultId(str(uuidv7())),
            integration_id=plan.integration_revision.integration_id,
            sync_run_id=plan.sync_run_id,
            result_type=IMSyncResultType.FAILED,
            provider_user_id=None,
            display_name=None,
            email=None,
            normalized_email=None,
            contact_id=None,
            identity_id=None,
            binding_id=None,
            removal_reason=None,
            reason_code="stale_integration_revision",
            reason_message="Integration configuration changed before reconciliation apply.",
            directory_entry_payload=None,
            contact_snapshot=None,
            identity_snapshot=None,
            created_at=now,
            updated_at=now,
        )

    @staticmethod
    def _append_result_record(session: Session, result: SyncResultFact) -> None:
        session.add(sync_result_to_record(result))
