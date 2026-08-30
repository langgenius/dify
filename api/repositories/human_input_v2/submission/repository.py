"""Form-locked SQLAlchemy adapter for Human Input v2 first-success submission.

One repeatable-read transaction locks the tenant-owned Form and loads the target
grant, endpoint, and current EndUser facts. Contact and IM current-state loading
is intentionally deferred and therefore fails closed. Audit insert, unique
Submission insert, and Form transition share one savepoint so a unique-form race
becomes a stable loser result without retaining its audit.
"""

from __future__ import annotations

from contextlib import contextmanager

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.approval import (
    AuthorizationContext,
    AuthorizedSubmissionCommit,
    CurrentEndUserAuthorizationFacts,
    EndUserApprovalSubject,
    FormAuthorizationAuditEvent,
    FormAuthorizationAuditEventType,
    RetryableSubmissionPersistenceError,
    SubmissionAttemptScope,
    SubmissionCommitResult,
    SubmissionCommitStatus,
)
from core.human_input_v2.entities import HumanInputV2FormStatus
from core.human_input_v2.shared import (
    AppId,
    EndUserId,
)
from models.human_input_v2 import (
    HumanInputV2Form,
    HumanInputV2FormApproverGrant,
    HumanInputV2FormDeliveryEndpoint,
)
from models.model import EndUser
from repositories.human_input_v2.form.mappers import endpoint_from_record, form_from_record, grant_from_record

from .mappers import audit_event_to_record, submission_to_record

_POSTGRESQL_SERIALIZATION_FAILURE_SQLSTATE = "40001"


class SubmissionPersistenceError(RuntimeError):
    """A submission transaction failed and rolled back its complete write set."""


class SubmissionScopeNotFoundError(ValueError):
    """The complete tenant/form/grant/endpoint owner chain does not exist."""


class SQLAlchemySubmissionRepository:
    """Create short session-bound transactions for the atomic submission use case."""

    _session_maker: sessionmaker[Session]

    def __init__(
        self,
        session_maker: sessionmaker[Session],
    ) -> None:
        self._session_maker = session_maker

    @contextmanager
    def transaction(self, scope: SubmissionAttemptScope):
        """Commit on clean exit and translate infrastructure failures after rollback."""

        try:
            with self._session_maker() as session, session.begin():
                self._configure_snapshot_transaction(session)
                yield SQLAlchemySubmissionTransaction(session, scope)
        except SubmissionPersistenceError as error:
            if _is_postgresql_serialization_failure(error):
                raise RetryableSubmissionPersistenceError("submission transaction must be retried") from error
            raise
        except SQLAlchemyError as error:
            if _is_postgresql_serialization_failure(error):
                raise RetryableSubmissionPersistenceError("submission transaction must be retried") from error
            raise SubmissionPersistenceError("submission transaction failed") from error

    @staticmethod
    def _configure_snapshot_transaction(session: Session) -> None:
        """Establish one MVCC snapshot before the transaction's first query."""

        if session.get_bind().dialect.name in {"mysql", "postgresql"}:
            session.connection(execution_options={"isolation_level": "REPEATABLE READ"})


class SQLAlchemySubmissionTransaction:
    """Session-bound owner of one coherent load and at most one write outcome."""

    _session: Session
    _scope: SubmissionAttemptScope
    _form_record: HumanInputV2Form | None
    _context: AuthorizationContext | None

    def __init__(
        self,
        session: Session,
        scope: SubmissionAttemptScope,
    ) -> None:
        self._session = session
        self._scope = scope
        self._form_record = None
        self._context = None

    @staticmethod
    def locked_form_statement(scope: SubmissionAttemptScope) -> sa.Select[tuple[HumanInputV2Form]]:
        """Select exactly one tenant-owned Form under the first-success row lock."""

        return (
            select(HumanInputV2Form)
            .where(
                HumanInputV2Form.tenant_id == str(scope.form_ref.tenant_id),
                HumanInputV2Form.id == str(scope.form_ref.form_id),
            )
            .with_for_update()
        )

    def load_authorization_context(self, *, proof: object) -> AuthorizationContext:
        """Load all relevant current facts once through the active transaction."""

        if self._context is not None:
            return self._context
        del proof
        form_record = self._session.scalar(self.locked_form_statement(self._scope))
        if form_record is None:
            raise SubmissionScopeNotFoundError("form owner scope does not exist")
        grant_record = self._session.scalar(
            select(HumanInputV2FormApproverGrant).where(
                HumanInputV2FormApproverGrant.tenant_id == str(self._scope.form_ref.tenant_id),
                HumanInputV2FormApproverGrant.form_id == str(self._scope.form_ref.form_id),
                HumanInputV2FormApproverGrant.id == str(self._scope.approver_grant_id),
            )
        )
        if grant_record is None:
            raise SubmissionScopeNotFoundError("approver grant owner scope does not exist")
        endpoint_record = self._load_endpoint_record()
        form = form_from_record(form_record, (grant_record,))
        grant = grant_from_record(grant_record)
        endpoint = endpoint_from_record(endpoint_record) if endpoint_record is not None else None
        current_end_user = self._load_current_end_user(grant, form.app_id)
        context = AuthorizationContext(
            form=form,
            grant=grant,
            endpoint=endpoint,
            current_contact=None,
            current_end_user=current_end_user,
            current_im_binding=None,
        )
        self._form_record = form_record
        self._context = context
        return context

    def append_rejection_audit(self, event: FormAuthorizationAuditEvent) -> None:
        """Append one scoped rejection fact without changing Form lifecycle."""

        self._require_loaded_context()
        if event.event_type is not FormAuthorizationAuditEventType.SUBMISSION_REJECTED:
            raise ValueError("rejection append requires a submission_rejected event")
        self._validate_event_owner(event)
        try:
            self._session.add(audit_event_to_record(event))
            self._session.flush()
        except SQLAlchemyError as error:
            raise SubmissionPersistenceError("failed to append submission rejection audit") from error

    def commit_authorized_submission_once(
        self,
        commit: AuthorizedSubmissionCommit,
    ) -> SubmissionCommitResult:
        """Atomically insert authorized audit/submission and transition the locked Form."""

        context = self._require_loaded_context()
        form_record = self._form_record
        assert form_record is not None
        self._validate_authorized_owner(commit, context)
        if form_record.status is not HumanInputV2FormStatus.WAITING:
            return SubmissionCommitResult(SubmissionCommitStatus.ALREADY_COMPLETED, None)

        occurred_at = commit.authorized.transition.decided_at
        channel = context.endpoint.channel if context.endpoint is not None else None
        audit_event = FormAuthorizationAuditEvent(
            id=commit.authorization_audit_event_id,
            event_type=FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED,
            form_ref=self._scope.form_ref,
            approver_grant_id=self._scope.approver_grant_id,
            endpoint_id=self._scope.endpoint_id,
            channel=channel,
            reason_code=None,
            reason_message=None,
            authorization_proof=commit.authorized.proof,
            payload={"selected_action_id": commit.authorized.transition.selected_action_id},
            occurred_at=occurred_at,
            created_at=occurred_at,
            updated_at=occurred_at,
        )
        submission = commit.to_submission(
            form_ref=self._scope.form_ref,
            approver_grant_id=self._scope.approver_grant_id,
            endpoint_id=self._scope.endpoint_id,
            submitted_at=occurred_at,
        )
        try:
            with self._session.begin_nested():
                self._session.add(audit_event_to_record(audit_event))
                self._session.flush()
                self._session.add(submission_to_record(submission))
                self._session.flush()
                form_record.status = HumanInputV2FormStatus.SUBMITTED
                form_record.updated_at = occurred_at
                self._session.flush()
        except IntegrityError as error:
            if self._is_form_submission_unique_conflict(error):
                return SubmissionCommitResult(SubmissionCommitStatus.ALREADY_COMPLETED, None)
            raise SubmissionPersistenceError("authorized submission violated a persistence invariant") from error
        except SQLAlchemyError as error:
            raise SubmissionPersistenceError("failed to commit authorized submission") from error
        return SubmissionCommitResult(SubmissionCommitStatus.COMMITTED, submission)

    def _load_endpoint_record(self) -> HumanInputV2FormDeliveryEndpoint | None:
        if self._scope.endpoint_id is None:
            return None
        endpoint_record = self._session.scalar(
            select(HumanInputV2FormDeliveryEndpoint).where(
                HumanInputV2FormDeliveryEndpoint.tenant_id == str(self._scope.form_ref.tenant_id),
                HumanInputV2FormDeliveryEndpoint.form_id == str(self._scope.form_ref.form_id),
                HumanInputV2FormDeliveryEndpoint.approver_grant_id == str(self._scope.approver_grant_id),
                HumanInputV2FormDeliveryEndpoint.id == str(self._scope.endpoint_id),
            )
        )
        if endpoint_record is None:
            raise SubmissionScopeNotFoundError("delivery endpoint owner scope does not exist")
        return endpoint_record

    def _load_current_end_user(self, grant, app_id: AppId) -> CurrentEndUserAuthorizationFacts | None:
        if not isinstance(grant.subject, EndUserApprovalSubject):
            return None
        end_user_id = str(grant.subject.end_user_id)
        tenant_id = str(self._scope.form_ref.tenant_id)
        row = self._session.execute(
            select(EndUser.id, EndUser.app_id).where(
                EndUser.id == end_user_id,
                EndUser.tenant_id == tenant_id,
                EndUser.app_id == str(app_id),
            )
        ).one_or_none()
        if row is None:
            return None
        return CurrentEndUserAuthorizationFacts(
            end_user_id=EndUserId(row.id),
            app_id=AppId(row.app_id),
            workspace_available=True,
        )

    def _require_loaded_context(self) -> AuthorizationContext:
        if self._context is None:
            raise RuntimeError("authorization context must be loaded before persistence")
        return self._context

    def _validate_event_owner(self, event: FormAuthorizationAuditEvent) -> None:
        if (
            event.form_ref != self._scope.form_ref
            or event.approver_grant_id != self._scope.approver_grant_id
            or event.endpoint_id != self._scope.endpoint_id
        ):
            raise ValueError("audit event does not match the loaded owner scope")

    def _validate_authorized_owner(
        self,
        commit: AuthorizedSubmissionCommit,
        context: AuthorizationContext,
    ) -> None:
        transition = commit.authorized.transition
        if (
            transition.form_ref != self._scope.form_ref
            or transition.grant_id != self._scope.approver_grant_id
            or commit.authorized.endpoint_ref != (context.endpoint.ref if context.endpoint is not None else None)
        ):
            raise ValueError("authorized submission does not match the loaded owner scope")

    @staticmethod
    def _is_form_submission_unique_conflict(error: IntegrityError) -> bool:
        message = str(error.orig).lower()
        return "hiv2_form_submissions_form_uq" in message or "human_input_v2_form_submissions.form_id" in message


def _is_postgresql_serialization_failure(error: BaseException) -> bool:
    """Inspect SQLAlchemy and public driver exception links for SQLSTATE 40001."""

    pending: list[object] = [error]
    visited: set[int] = set()
    while pending:
        current = pending.pop()
        current_id = id(current)
        if current_id in visited:
            continue
        visited.add(current_id)
        if _structured_sqlstate(current) == _POSTGRESQL_SERIALIZATION_FAILURE_SQLSTATE:
            return True
        if isinstance(current, DBAPIError):
            pending.append(current.orig)
        if isinstance(current, BaseException):
            if current.__cause__ is not None:
                pending.append(current.__cause__)
            if current.__context__ is not None:
                pending.append(current.__context__)
    return False


def _structured_sqlstate(error: object) -> str | None:
    """Read documented psycopg/psycopg2 SQLSTATE attributes at the driver boundary."""

    for attribute_name in ("sqlstate", "pgcode"):
        raw_code = getattr(error, attribute_name, None)
        if isinstance(raw_code, str):
            return raw_code
    return None


__all__ = [
    "SQLAlchemySubmissionRepository",
    "SQLAlchemySubmissionTransaction",
    "SubmissionPersistenceError",
    "SubmissionScopeNotFoundError",
]
