"""Channel-bound reconciliation Service with an explicit Session transaction."""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from typing import Protocol

import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider, IMSyncRemovalReason, IMSyncResultType, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    BlockedReconciliation,
    ContactEmailMatchState,
    CreateIMBinding,
    CurrentIMIdentityState,
    DeleteIMBinding,
    ExistingIMIdentityRef,
    IMBindingChangeSnapshot,
    IMIdentityChangeSnapshot,
    IMIdentityUpsertKind,
    IMReconciliationChange,
    IMReconciliationOperation,
    IMReconciliationSubjectKind,
    IMSyncRun,
    NewIMIdentityRef,
    ReconciliationPlan,
    ReplaceIMBinding,
    SyncContactSnapshot,
    SyncIdentitySnapshot,
    SyncResultFact,
)
from core.human_input_v2.im_integration.adapters import IMProviderAdapter
from core.human_input_v2.im_integration.adapters.entities import DirectoryReadFailure, ProviderUserId
from core.human_input_v2.shared import (
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMReconciliationChangeId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
)
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import HumanInputIMChannel, HumanInputIMSyncRun
from repositories.human_input_v2.contact import Contact, ContactType
from repositories.human_input_v2.im_binding_repository import IMBindingAssignment
from repositories.human_input_v2.im_channel_repository import IMChannel
from repositories.human_input_v2.im_identity_repository import IMIdentity, IMIdentityObservation, OpaqueProviderPayload
from repositories.human_input_v2.im_integration.mappers import (
    reconciliation_change_to_record,
    sync_result_to_record,
    sync_run_from_record,
)
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from services.human_input_v2.im_credential_codec import IMCredentialError

from .reconciliation import generate_reconciliation_plan
from .service import IMSyncRunNotFoundError

logger = logging.getLogger(__name__)

_CONTACT_PAGE_LIMIT = 500


class IMSyncRetryableError(RuntimeError):
    """A transient synchronization failure requires worker redelivery."""


class _ReconciliationPreconditionError(Exception):
    pass


class _StaleChannelRevisionError(Exception):
    pass


class _ReconciliationAlreadyTerminalError(Exception):
    def __init__(self, run: IMSyncRun) -> None:
        super().__init__(run.status.value)
        self.run = run


class BoundContactReader(Protocol):
    """Contact reads whose owner was selected before reconciliation composition."""

    def list_contacts(self, page: int, limit: int) -> Sequence[Contact]: ...

    def get_contact(self, contact_id: ContactId) -> Contact | None: ...


type BoundContactReaderFactory = Callable[[Session], BoundContactReader]
type IMChannelAdapterFactory = Callable[[IMChannel], IMProviderAdapter]


class IMChannelReconciliationService:
    """Load, plan, and apply one sync against a constructor-bound trusted Channel."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        channel: IMChannel,
        adapter_factory: IMChannelAdapterFactory,
        contact_reader_factory: BoundContactReaderFactory,
        *,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
    ) -> None:
        self._session_factory = session_factory
        self._channel = channel
        self._adapter_factory = adapter_factory
        self._contact_reader_factory = contact_reader_factory
        self._clock = clock

    def reconcile(self, sync_run_id: IMSyncRunId) -> IMSyncRun:
        adapter: IMProviderAdapter | None = None
        try:
            run = self._require_run(sync_run_id)
            if not self._run_matches_channel(run):
                raise IMSyncRunNotFoundError("IM synchronization run was not found")
            if not run.is_active:
                return run
            try:
                adapter = self._adapter_factory(self._channel)
            except IMCredentialError:
                logger.warning("IM Channel credentials are unavailable, sync_run_id=%s", sync_run_id)
                return self._persist_failure(
                    sync_run_id,
                    "directory_read_failed",
                    "IM credential configuration is unavailable.",
                )
            try:
                directory = adapter.directory.read_directory()
            except Exception:
                logger.exception("IM Contact directory read raised unexpectedly, sync_run_id=%s", sync_run_id)
                return self._persist_failure(
                    sync_run_id,
                    "directory_read_failed",
                    "Provider directory could not be read.",
                )
            if isinstance(directory, DirectoryReadFailure):
                logger.warning("IM Contact directory read failed, sync_run_id=%s", sync_run_id)
                return self._persist_failure(
                    sync_run_id,
                    "directory_read_failed",
                    "Provider directory could not be read.",
                )
            try:
                with self._session_factory() as session, session.begin():
                    run_record = self._require_active_run_record(session, sync_run_id)
                    identities = SQLAlchemyIMIdentityRepository(session, self._channel.id)
                    bindings = SQLAlchemyIMBindingRepository(session, self._channel.id)
                    contacts = self._load_contacts(self._contact_reader_factory(session))
                    plan_or_block = generate_reconciliation_plan(
                        sync_run_from_record(run_record),
                        directory.entries,
                        identities.list_all(),
                        bindings.list_all(),
                        self._contact_states(contacts),
                    )
                    if isinstance(plan_or_block, BlockedReconciliation):
                        blocker_codes = ",".join(blocker.code.value for blocker in plan_or_block.blockers)
                        self._fail_run_record(
                            session,
                            run_record,
                            "plan_blocked",
                            f"Reconciliation input was blocked: {blocker_codes}.",
                            self._clock(),
                        )
                    else:
                        self._apply_plan(session, run_record, plan_or_block, contacts, identities, bindings)
            except _ReconciliationAlreadyTerminalError as terminal:
                return terminal.run
            except _StaleChannelRevisionError:
                return self._persist_failure(
                    sync_run_id,
                    "stale_revision",
                    "IM Channel revision changed before reconciliation apply.",
                )
            except _ReconciliationPreconditionError:
                return self._persist_failure(
                    sync_run_id,
                    "precondition_failed",
                    "IM reconciliation precondition changed.",
                )
            except IMSyncRunNotFoundError:
                raise
            except Exception:
                logger.exception("IM Contact reconciliation failed, sync_run_id=%s", sync_run_id)
                return self._persist_failure(
                    sync_run_id,
                    "unexpected_apply_failure",
                    "IM reconciliation could not be applied.",
                )
            return self._require_run(sync_run_id)
        finally:
            if adapter is not None:
                try:
                    adapter.close()
                except Exception:
                    logger.exception("IM Provider adapter close failed, sync_run_id=%s", sync_run_id)

    def _apply_plan(
        self,
        session: Session,
        run_record: HumanInputIMSyncRun,
        plan: ReconciliationPlan,
        contacts: tuple[Contact, ...],
        identities: SQLAlchemyIMIdentityRepository,
        bindings: SQLAlchemyIMBindingRepository,
    ) -> None:
        now = self._clock()
        initial_identities = {identity.id: identity for identity in identities.list_all()}
        identity_ids: dict[NewIMIdentityRef, IMIdentityId] = {}
        binding_ids: dict[tuple[IMIdentityId, ContactId], IMBindingId] = {}
        changes: list[IMReconciliationChange] = []
        for upsert in plan.identity_upserts:
            observation = IMIdentityObservation(
                provider_user_id=str(upsert.entry.provider_user_id),
                display_name=upsert.entry.display_name,
                email=upsert.entry.email,
                raw_payload=OpaqueProviderPayload({}),
                sync_run_id=plan.run.sync_run_id,
                observed_at=now,
            )
            if isinstance(upsert.identity_ref, NewIMIdentityRef):
                identity_id = IMIdentityId(str(uuidv7()))
                persisted_identity = identities.create(identity_id, observation)
                identity_ids[upsert.identity_ref] = identity_id
            else:
                identity_id = upsert.identity_ref.identity_id
                persisted_identity = identities.update(identity_id, observation)
            before_snapshot = (
                self._identity_snapshot_from_state(upsert.before, self._channel.provider)
                if upsert.before is not None
                else None
            )
            changes.append(
                IMReconciliationChange(
                    id=IMReconciliationChangeId(str(uuidv7())),
                    integration_id=IntegrationId(str(self._channel.id)),
                    sync_run_id=plan.run.sync_run_id,
                    operation_key=upsert.operation_key,
                    subject_kind=IMReconciliationSubjectKind.IDENTITY,
                    operation={
                        IMIdentityUpsertKind.CREATE: IMReconciliationOperation.CREATE,
                        IMIdentityUpsertKind.UPDATE: IMReconciliationOperation.UPDATE,
                        IMIdentityUpsertKind.REFRESH: IMReconciliationOperation.REFRESH,
                    }[upsert.kind],
                    reason_code="directory_identity_observed",
                    identity_id=identity_id,
                    binding_id=None,
                    contact_id=None,
                    before=before_snapshot,
                    after=self._identity_snapshot(persisted_identity, self._channel.provider),
                    committed_at=now,
                )
            )

        contact_by_id = {contact.id: contact for contact in contacts}
        for mutation in plan.binding_mutations:
            if isinstance(mutation, CreateIMBinding):
                self._require_contact_precondition(contact_by_id, mutation.contact_precondition)
                identity_id = self._resolve_identity(mutation.identity_ref, identity_ids)
                created_binding = bindings.create(
                    IMBindingAssignment(mutation.contact_id, identity_id, now),
                    bound_by_account_id=None,
                )
                binding_ids[(identity_id, mutation.contact_id)] = created_binding.id
                created_after_snapshot = self._binding_snapshot(
                    created_binding.id,
                    created_binding.identity_id,
                    created_binding.contact_id,
                )
                changes.append(
                    self._binding_change(
                        plan,
                        mutation.operation_key,
                        IMReconciliationOperation.CREATE,
                        mutation.reason.value,
                        created_after_snapshot,
                        before=None,
                        after=created_after_snapshot,
                        now=now,
                    )
                )
            elif isinstance(mutation, ReplaceIMBinding):
                self._require_contact_precondition(contact_by_id, mutation.contact_precondition)
                identity_id = self._resolve_identity(mutation.next_identity_ref, identity_ids)
                replaced_binding = bindings.replace(
                    mutation.before.binding_id,
                    expected_identity_id=mutation.before.identity_id,
                    next_identity_id=identity_id,
                    bound_by_account_id=None,
                    updated_at=now,
                )
                if replaced_binding is None:
                    raise _ReconciliationPreconditionError
                binding_ids[(identity_id, mutation.before.contact_id)] = replaced_binding.id
                replaced_before_snapshot = self._binding_snapshot(
                    mutation.before.binding_id,
                    mutation.before.identity_id,
                    mutation.before.contact_id,
                )
                replaced_after_snapshot = self._binding_snapshot(
                    replaced_binding.id,
                    replaced_binding.identity_id,
                    replaced_binding.contact_id,
                )
                changes.append(
                    self._binding_change(
                        plan,
                        mutation.operation_key,
                        IMReconciliationOperation.REPLACE,
                        mutation.reason.value,
                        replaced_after_snapshot,
                        before=replaced_before_snapshot,
                        after=replaced_after_snapshot,
                        now=now,
                    )
                )
            elif isinstance(mutation, DeleteIMBinding):
                current_binding = bindings.get(mutation.before.binding_id)
                if (
                    current_binding is None
                    or current_binding.identity_id != mutation.before.identity_id
                    or current_binding.contact_id != mutation.before.contact_id
                ):
                    raise _ReconciliationPreconditionError
                bindings.delete(
                    mutation.before.binding_id,
                    expected_identity_id=mutation.before.identity_id,
                )
                deleted_before_snapshot = self._binding_snapshot(
                    mutation.before.binding_id,
                    mutation.before.identity_id,
                    mutation.before.contact_id,
                )
                changes.append(
                    self._binding_change(
                        plan,
                        mutation.operation_key,
                        IMReconciliationOperation.DELETE,
                        mutation.reason.value,
                        deleted_before_snapshot,
                        before=deleted_before_snapshot,
                        after=None,
                        now=now,
                    )
                )
        for deletion in plan.identity_deletions:
            current_identity = identities.get(deletion.before.identity_id)
            if current_identity is None or not self._identity_matches_state(current_identity, deletion.before):
                raise _ReconciliationPreconditionError
            identities.delete(deletion.before.identity_id)
            changes.append(
                IMReconciliationChange(
                    id=IMReconciliationChangeId(str(uuidv7())),
                    integration_id=IntegrationId(str(self._channel.id)),
                    sync_run_id=plan.run.sync_run_id,
                    operation_key=deletion.operation_key,
                    subject_kind=IMReconciliationSubjectKind.IDENTITY,
                    operation=IMReconciliationOperation.DELETE,
                    reason_code=deletion.reason.value,
                    identity_id=deletion.before.identity_id,
                    binding_id=None,
                    contact_id=None,
                    before=self._identity_snapshot_from_state(deletion.before, self._channel.provider),
                    after=None,
                    committed_at=now,
                )
            )

        results = self._materialize_results(
            plan,
            contacts,
            identities,
            initial_identities,
            identity_ids,
            binding_ids,
            now,
        )
        for result in results:
            session.add(sync_result_to_record(result))
        for change in changes:
            session.add(reconciliation_change_to_record(change))
        run_record.status = IMSyncRunStatus.SUCCEEDED
        run_record.added_count = sum(result.result_type is IMSyncResultType.ADDED for result in results)
        run_record.not_matched_count = sum(result.result_type is IMSyncResultType.NOT_MATCHED for result in results)
        run_record.failed_count = sum(result.result_type is IMSyncResultType.FAILED for result in results)
        run_record.removed_count = sum(result.result_type is IMSyncResultType.REMOVED for result in results)
        run_record.skipped_count = sum(result.result_type is IMSyncResultType.SKIPPED for result in results)
        run_record.started_at = run_record.started_at or now
        run_record.finished_at = now
        run_record.updated_at = now
        session.flush()

    def _materialize_results(
        self,
        plan: ReconciliationPlan,
        contacts: tuple[Contact, ...],
        identities: SQLAlchemyIMIdentityRepository,
        initial_identities: dict[IMIdentityId, IMIdentity],
        new_identity_ids: dict[NewIMIdentityRef, IMIdentityId],
        new_binding_ids: dict[tuple[IMIdentityId, ContactId], IMBindingId],
        now: NaiveDatetime,
    ) -> tuple[SyncResultFact, ...]:
        contacts_by_id = {contact.id: contact for contact in contacts}
        upserts_by_provider_user_id = {upsert.entry.provider_user_id: upsert for upsert in plan.identity_upserts}
        removal_reason_by_binding_id: dict[IMBindingId, IMSyncRemovalReason] = {
            mutation.before.binding_id: mutation.removal_reason
            for mutation in plan.binding_mutations
            if isinstance(mutation, ReplaceIMBinding | DeleteIMBinding)
        }
        results: list[SyncResultFact] = []
        for planned in plan.sync_results:
            identity_id = (
                self._resolve_identity(planned.identity_ref, new_identity_ids)
                if planned.identity_ref is not None
                else None
            )
            identity = identities.get(identity_id) if identity_id is not None else None
            if identity is None and identity_id is not None:
                identity = initial_identities.get(identity_id)
            contact = contacts_by_id.get(planned.contact_id) if planned.contact_id is not None else None
            upsert = (
                upserts_by_provider_user_id.get(planned.provider_user_id)
                if planned.provider_user_id is not None
                else None
            )
            binding_id = planned.binding_id
            if binding_id is None and identity_id is not None and planned.contact_id is not None:
                binding_id = new_binding_ids.get((identity_id, planned.contact_id))
            results.append(
                SyncResultFact(
                    id=IMSyncResultId(str(uuidv7())),
                    integration_id=IntegrationId(str(self._channel.id)),
                    sync_run_id=plan.run.sync_run_id,
                    operation_key=planned.operation_key,
                    result_type=planned.result_type,
                    provider_user_id=str(planned.provider_user_id) if planned.provider_user_id else None,
                    display_name=upsert.entry.display_name if upsert else None,
                    email=upsert.entry.email if upsert else None,
                    normalized_email=_normalized_email(upsert.entry.email) if upsert else None,
                    contact_id=planned.contact_id,
                    identity_id=identity_id,
                    binding_id=binding_id,
                    removal_reason=(
                        removal_reason_by_binding_id.get(planned.binding_id) if planned.binding_id is not None else None
                    ),
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
                            identity.id,
                            self._channel.provider,
                            identity.provider_user_id,
                            identity.display_name,
                            identity.email,
                        )
                        if identity is not None
                        else None
                    ),
                    created_at=now,
                    updated_at=now,
                )
            )
        return tuple(results)

    @staticmethod
    def _identity_snapshot(identity: IMIdentity, provider: IMProvider) -> IMIdentityChangeSnapshot:
        return IMIdentityChangeSnapshot(
            identity_id=identity.id,
            provider=provider,
            provider_user_id=ProviderUserId(identity.provider_user_id),
            display_name=identity.display_name,
            email=identity.email,
            normalized_email=_normalized_email(identity.email),
            last_seen_sync_run_id=identity.last_seen_sync_run_id,
        )

    @staticmethod
    def _identity_snapshot_from_state(
        identity: CurrentIMIdentityState,
        provider: IMProvider,
    ) -> IMIdentityChangeSnapshot:
        return IMIdentityChangeSnapshot(
            identity_id=identity.identity_id,
            provider=provider,
            provider_user_id=identity.provider_user_id,
            display_name=identity.display_name,
            email=identity.email,
            normalized_email=identity.normalized_email,
            last_seen_sync_run_id=identity.last_seen_sync_run_id,
        )

    @staticmethod
    def _identity_matches_state(identity: IMIdentity, expected: CurrentIMIdentityState) -> bool:
        return (
            identity.provider_user_id == expected.provider_user_id
            and identity.display_name == expected.display_name
            and identity.email == expected.email
            and _normalized_email(identity.email) == expected.normalized_email
            and identity.last_seen_sync_run_id == expected.last_seen_sync_run_id
        )

    @staticmethod
    def _binding_snapshot(
        binding_id: IMBindingId,
        identity_id: IMIdentityId,
        contact_id: ContactId,
    ) -> IMBindingChangeSnapshot:
        return IMBindingChangeSnapshot(binding_id, identity_id, contact_id)

    @staticmethod
    def _binding_change(
        plan: ReconciliationPlan,
        operation_key: str,
        operation: IMReconciliationOperation,
        reason_code: str,
        subject: IMBindingChangeSnapshot,
        *,
        before: IMBindingChangeSnapshot | None,
        after: IMBindingChangeSnapshot | None,
        now: NaiveDatetime,
    ) -> IMReconciliationChange:
        return IMReconciliationChange(
            id=IMReconciliationChangeId(str(uuidv7())),
            integration_id=IntegrationId(plan.run.channel_revision.channel_id),
            sync_run_id=plan.run.sync_run_id,
            operation_key=operation_key,
            subject_kind=IMReconciliationSubjectKind.BINDING,
            operation=operation,
            reason_code=reason_code,
            identity_id=subject.identity_id,
            binding_id=subject.binding_id,
            contact_id=subject.contact_id,
            before=before,
            after=after,
            committed_at=now,
        )

    def _persist_failure(self, sync_run_id: IMSyncRunId, code: str, message: str) -> IMSyncRun:
        try:
            with self._session_factory() as session, session.begin():
                record = self._lock_active_run(session, sync_run_id)
                self._fail_run_record(session, record, code, message, self._clock())
        except _ReconciliationAlreadyTerminalError as terminal:
            return terminal.run
        return self._require_run(sync_run_id)

    def _fail_run_record(
        self,
        session: Session,
        record: HumanInputIMSyncRun,
        code: str,
        message: str,
        now: NaiveDatetime,
    ) -> None:
        diagnostic = SyncResultFact(
            id=IMSyncResultId(str(uuidv7())),
            integration_id=IntegrationId(record.integration_id),
            sync_run_id=IMSyncRunId(record.id),
            operation_key=f"diagnostic:{code}",
            result_type=IMSyncResultType.FAILED,
            provider_user_id=None,
            display_name=None,
            email=None,
            normalized_email=None,
            contact_id=None,
            identity_id=None,
            binding_id=None,
            removal_reason=None,
            reason_code=code,
            reason_message=message,
            directory_entry_payload=None,
            contact_snapshot=None,
            identity_snapshot=None,
            created_at=now,
            updated_at=now,
        )
        session.add(sync_result_to_record(diagnostic))
        record.status = IMSyncRunStatus.FAILED
        record.failed_count = 1
        record.started_at = record.started_at or now
        record.finished_at = now
        record.error_code = code
        record.error_message = message
        record.updated_at = now
        session.flush([record])

    def _require_run(self, sync_run_id: IMSyncRunId) -> IMSyncRun:
        with self._session_factory() as session:
            record = session.get(HumanInputIMSyncRun, str(sync_run_id))
            if record is None:
                raise IMSyncRunNotFoundError("IM synchronization run was not found")
            return sync_run_from_record(record)

    def _require_active_run_record(self, session: Session, sync_run_id: IMSyncRunId) -> HumanInputIMSyncRun:
        if not self._lock_current_channel(session):
            raise _StaleChannelRevisionError
        return self._lock_active_run(session, sync_run_id)

    def _lock_current_channel(self, session: Session) -> bool:
        result = session.execute(
            sa.update(HumanInputIMChannel)
            .where(
                HumanInputIMChannel.id == str(self._channel.id),
                HumanInputIMChannel.config_version == self._channel.config_version,
                HumanInputIMChannel.provider == self._channel.provider,
            )
            .values(updated_at=HumanInputIMChannel.updated_at)
            .execution_options(autoflush=False, synchronize_session=False)
        )
        if not isinstance(result, CursorResult):
            raise TypeError("conditional IM Channel guard did not return a cursor result")
        return result.rowcount == 1

    def _lock_active_run(self, session: Session, sync_run_id: IMSyncRunId) -> HumanInputIMSyncRun:
        predicates = (
            HumanInputIMSyncRun.id == str(sync_run_id),
            HumanInputIMSyncRun.integration_id == str(self._channel.id),
            HumanInputIMSyncRun.integration_config_version == self._channel.config_version,
            HumanInputIMSyncRun.provider == self._channel.provider,
        )
        result = session.execute(
            sa.update(HumanInputIMSyncRun)
            .where(
                *predicates,
                HumanInputIMSyncRun.status.in_((IMSyncRunStatus.QUEUED, IMSyncRunStatus.RUNNING)),
            )
            .values(updated_at=HumanInputIMSyncRun.updated_at)
            .execution_options(autoflush=False, synchronize_session=False)
        )
        if not isinstance(result, CursorResult):
            raise TypeError("conditional IM sync-run guard did not return a cursor result")
        record = session.scalar(sa.select(HumanInputIMSyncRun).where(*predicates).execution_options(autoflush=False))
        if record is None:
            raise IMSyncRunNotFoundError("IM synchronization run was not found")
        if result.rowcount == 1:
            return record
        run = sync_run_from_record(record)
        if not run.is_active:
            raise _ReconciliationAlreadyTerminalError(run)
        raise _ReconciliationPreconditionError("active IM synchronization run could not be guarded")

    def _run_matches_channel(self, run: IMSyncRun) -> bool:
        return (
            run.channel_revision.channel_id == str(self._channel.id)
            and run.channel_revision.config_version == self._channel.config_version
            and run.provider is self._channel.provider
        )

    @staticmethod
    def _load_contacts(reader: BoundContactReader) -> tuple[Contact, ...]:
        contacts: list[Contact] = []
        page = 1
        while True:
            current_page = tuple(reader.list_contacts(page, _CONTACT_PAGE_LIMIT))
            contacts.extend(current_page)
            if len(current_page) < _CONTACT_PAGE_LIMIT:
                return tuple(contacts)
            page += 1

    @staticmethod
    def _contact_states(contacts: tuple[Contact, ...]) -> tuple[ContactEmailMatchState, ...]:
        return tuple(
            ContactEmailMatchState(
                contact.id,
                contact.name,
                contact.email,
                NormalizedEmail(contact.email),
                contact.avatar_file_id,
            )
            for contact in contacts
            if contact.type is not ContactType.EXTERNAL and contact.email is not None
        )

    @staticmethod
    def _require_contact_precondition(
        contacts_by_id: dict[ContactId, Contact],
        expected: ContactEmailMatchState,
    ) -> None:
        contact = contacts_by_id.get(expected.contact_id)
        if (
            contact is None
            or contact.type is ContactType.EXTERNAL
            or contact.name != expected.display_name
            or contact.email != expected.email
            or contact.avatar_file_id != expected.avatar_file_id
        ):
            raise _ReconciliationPreconditionError

    @staticmethod
    def _resolve_identity(
        identity_ref: ExistingIMIdentityRef | NewIMIdentityRef,
        new_identity_ids: dict[NewIMIdentityRef, IMIdentityId],
    ) -> IMIdentityId:
        if isinstance(identity_ref, ExistingIMIdentityRef):
            return identity_ref.identity_id
        identity_id = new_identity_ids.get(identity_ref)
        if identity_id is None:
            raise _ReconciliationPreconditionError
        return identity_id


def _normalized_email(email: str | None) -> NormalizedEmail | None:
    if email is None:
        return None
    try:
        return NormalizedEmail(email)
    except ValueError:
        return None


__all__ = [
    "BoundContactReader",
    "BoundContactReaderFactory",
    "IMChannelAdapterFactory",
    "IMChannelReconciliationService",
    "IMSyncRetryableError",
]
