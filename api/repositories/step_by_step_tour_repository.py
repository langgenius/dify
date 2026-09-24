"""SQLAlchemy repository for account Step-by-step Tour state."""

import logging
from collections.abc import Callable
from typing import Protocol, override, runtime_checkable

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from models.onboarding import AccountStepByStepTourState
from services.entities.onboarding_entities import StepByStepTourState
from services.step_by_step_tour_service import StepByStepTourStateRepository

logger = logging.getLogger(__name__)

_MYSQL_RETRYABLE_LOCK_ERRNOS = frozenset({1205, 1213})
_MAX_LOCK_ATTEMPTS = 3


@runtime_checkable
class _ErrorWithErrno(Protocol):
    @property
    def errno(self) -> object: ...


class SQLAlchemyStepByStepTourStateRepository(StepByStepTourStateRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get(self, account_id: str) -> StepByStepTourState | None:
        with self._session_factory() as session:
            model = self._get_model(account_id, session=session)
            return self._to_state(model) if model is not None else None

    @override
    def initialize(self, account_id: str, first_workspace_id: str) -> StepByStepTourState:
        """Create state with its first workspace, or atomically claim a legacy empty state."""
        return self._run_with_lock_retry(
            lambda: self._initialize_once(account_id, first_workspace_id),
        )

    def _initialize_once(self, account_id: str, first_workspace_id: str) -> StepByStepTourState:
        with self._session_factory() as session:
            model = self._get_model(account_id, session=session)
            if model is None:
                model = AccountStepByStepTourState(
                    account_id=account_id,
                    first_workspace_id=first_workspace_id,
                )
                session.add(model)
                try:
                    session.commit()
                except IntegrityError:
                    # A concurrent request inserted the account-owned row first.
                    session.rollback()
                    model = self._get_model(account_id, session=session)
                    if model is None:
                        raise
                else:
                    session.refresh(model)
                    return self._to_state(model)

            if model.first_workspace_id is None:
                stmt = (
                    update(AccountStepByStepTourState)
                    .where(
                        AccountStepByStepTourState.account_id == account_id,
                        AccountStepByStepTourState.first_workspace_id.is_(None),
                    )
                    .values(first_workspace_id=first_workspace_id)
                    .execution_options(synchronize_session=False)
                )
                session.execute(stmt)
                session.commit()
                # A competing conditional update may have won while this request waited.
                session.refresh(model)

            return self._to_state(model)

    @override
    def mutate(
        self,
        account_id: str,
        mutation: Callable[[StepByStepTourState], StepByStepTourState],
    ) -> StepByStepTourState:
        """Lock, create if needed, mutate, and persist account state in one transaction."""
        return self._run_with_lock_retry(
            lambda: self._mutate_once(account_id, mutation),
        )

    def _mutate_once(
        self,
        account_id: str,
        mutation: Callable[[StepByStepTourState], StepByStepTourState],
    ) -> StepByStepTourState:
        with self._session_factory() as session:
            # Probe without a locking read so a missing MySQL unique key does not
            # acquire a gap/next-key lock before the insert.
            model = self._get_model(account_id, session=session)
            if model is None:
                model = AccountStepByStepTourState(account_id=account_id)
                session.add(model)
                try:
                    session.flush()
                except IntegrityError:
                    # A concurrent mutation created the row. Start a new transaction,
                    # lock its committed state, and replay the pure mutation on it.
                    session.rollback()
                    model = self._get_model(account_id, session=session, lock_for_update=True)
                    if model is None:
                        raise
            else:
                model = self._get_model(account_id, session=session, lock_for_update=True)
                if model is None:
                    raise RuntimeError("Step-by-step Tour state disappeared while acquiring its lock")

            state = mutation(self._to_state(model))
            if state.account_id != account_id:
                raise ValueError("Step-by-step Tour mutation cannot change account ownership")
            # first_workspace_id is write-once and owned exclusively by initialize().
            model.skipped = state.skipped
            model.completed_task_ids = list(state.completed_task_ids)
            model.manually_enabled_workspace_ids = list(state.manually_enabled_workspace_ids)
            model.manually_disabled_workspace_ids = list(state.manually_disabled_workspace_ids)
            session.commit()
            session.refresh(model)
            return self._to_state(model)

    @staticmethod
    def _run_with_lock_retry[T](operation: Callable[[], T]) -> T:
        for attempt in range(1, _MAX_LOCK_ATTEMPTS):
            try:
                return operation()
            except OperationalError as exc:
                if not _is_retryable_mysql_lock_error(exc):
                    raise
                logger.warning(
                    "Retrying Step-by-step Tour transaction after MySQL lock failure (attempt %s/%s)",
                    attempt,
                    _MAX_LOCK_ATTEMPTS,
                )
        return operation()

    @staticmethod
    def _get_model(
        account_id: str,
        *,
        session: Session,
        lock_for_update: bool = False,
    ) -> AccountStepByStepTourState | None:
        stmt = select(AccountStepByStepTourState).where(AccountStepByStepTourState.account_id == account_id).limit(1)
        if lock_for_update:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        return session.execute(stmt).scalar_one_or_none()

    @staticmethod
    def _to_state(model: AccountStepByStepTourState) -> StepByStepTourState:
        return StepByStepTourState(
            account_id=model.account_id,
            first_workspace_id=model.first_workspace_id,
            skipped=model.skipped,
            completed_task_ids=tuple(model.completed_task_ids),
            manually_enabled_workspace_ids=tuple(model.manually_enabled_workspace_ids),
            manually_disabled_workspace_ids=tuple(model.manually_disabled_workspace_ids),
            updated_at=model.updated_at,
        )


def _is_retryable_mysql_lock_error(exc: OperationalError) -> bool:
    orig = exc.orig
    if isinstance(orig, _ErrorWithErrno) and _is_retryable_mysql_lock_error_code(orig.errno):
        return True
    if not isinstance(orig, BaseException) or not orig.args:
        return False
    return _is_retryable_mysql_lock_error_code(orig.args[0])


def _is_retryable_mysql_lock_error_code(candidate: object) -> bool:
    if isinstance(candidate, bool):
        return False
    if isinstance(candidate, int):
        code = candidate
    elif isinstance(candidate, str) and candidate.isdecimal():
        code = int(candidate)
    else:
        return False
    return code in _MYSQL_RETRYABLE_LOCK_ERRNOS
