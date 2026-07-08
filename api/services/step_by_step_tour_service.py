"""Account-level Step-by-step Tour persistence."""

from datetime import datetime
from typing import NotRequired, TypedDict

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, scoped_session

from configs import dify_config
from libs.datetime_utils import ensure_naive_utc
from models.account import Account
from models.onboarding import AccountStepByStepTourState

STEP_BY_STEP_TOUR_TASK_IDS = frozenset(("home", "studio", "knowledge", "integration"))


class StepByStepTourStateResponse(TypedDict):
    first_workspace_id: str | None
    skipped: bool
    completed_task_ids: list[str]
    manually_enabled_workspace_ids: list[str]
    manually_disabled_workspace_ids: list[str]
    updated_at: datetime | None


class StepByStepTourPatch(TypedDict):
    action: str
    task_id: NotRequired[str | None]


class StepByStepTourService:
    """Coordinate persisted tour state with account eligibility rules."""

    @classmethod
    def get_state(
        cls,
        *,
        account: Account,
        current_tenant_id: str,
        session: Session | scoped_session,
    ) -> StepByStepTourStateResponse:
        eligible = cls.is_eligible(account)
        state = cls._get_state(account.id, session=session)

        if eligible:
            state = cls._ensure_state(account.id, session=session, state=state)
            if state.first_workspace_id is None:
                state.first_workspace_id = current_tenant_id
                session.commit()
                session.refresh(state)

        return cls._build_response(state=state)

    @classmethod
    def patch_state(
        cls,
        *,
        account: Account,
        current_tenant_id: str,
        patch: StepByStepTourPatch,
        session: Session | scoped_session,
    ) -> StepByStepTourStateResponse:
        state = cls._ensure_state(account.id, session=session, state=None)
        cls._apply_action(
            state=state,
            action=patch["action"],
            task_id=patch.get("task_id"),
            current_tenant_id=current_tenant_id,
        )

        session.commit()
        session.refresh(state)
        return cls._build_response(state=state)

    @classmethod
    def is_eligible(cls, account: Account) -> bool:
        if not dify_config.ENABLE_STEP_BY_STEP_TOUR:
            return False

        rollout_started_at = dify_config.STEP_BY_STEP_TOUR_ROLLOUT_STARTED_AT
        if rollout_started_at is None:
            return False

        account_started_at = account.initialized_at or account.created_at
        if account_started_at is None:
            return False

        return ensure_naive_utc(account_started_at) >= ensure_naive_utc(rollout_started_at)

    @classmethod
    def _get_state(
        cls,
        account_id: str,
        *,
        session: Session | scoped_session,
    ) -> AccountStepByStepTourState | None:
        stmt = select(AccountStepByStepTourState).where(AccountStepByStepTourState.account_id == account_id).limit(1)
        return session.execute(stmt).scalar_one_or_none()

    @classmethod
    def _ensure_state(
        cls,
        account_id: str,
        *,
        session: Session | scoped_session,
        state: AccountStepByStepTourState | None,
    ) -> AccountStepByStepTourState:
        if state is None:
            state = cls._get_state(account_id, session=session)
        if state is not None:
            return state

        state = AccountStepByStepTourState(account_id=account_id)
        session.add(state)
        try:
            session.flush()
        except IntegrityError:
            # Another tab/device can create the account row between our read and insert.
            session.rollback()
            state = cls._get_state(account_id, session=session)
            if state is None:
                raise
        return state

    @classmethod
    def _apply_action(
        cls,
        *,
        state: AccountStepByStepTourState,
        action: str,
        task_id: str | None,
        current_tenant_id: str,
    ) -> None:
        match action:
            case "skip":
                state.skipped = True
                state.manually_enabled_workspace_ids = cls._remove_id(
                    state.manually_enabled_workspace_ids,
                    current_tenant_id,
                )
            case "complete_task":
                if task_id is None:
                    raise ValueError("task_id is required")
                cls._validate_task_id(task_id)
                state.completed_task_ids = cls._add_id(state.completed_task_ids, task_id)
            case "uncomplete_task":
                if task_id is None:
                    raise ValueError("task_id is required")
                cls._validate_task_id(task_id)
                state.completed_task_ids = cls._remove_id(state.completed_task_ids, task_id)
            case "enable_current_workspace":
                state.skipped = False
                state.manually_enabled_workspace_ids = cls._add_id(
                    state.manually_enabled_workspace_ids,
                    current_tenant_id,
                )
                state.manually_disabled_workspace_ids = cls._remove_id(
                    state.manually_disabled_workspace_ids,
                    current_tenant_id,
                )
            case "disable_current_workspace":
                state.manually_enabled_workspace_ids = cls._remove_id(
                    state.manually_enabled_workspace_ids,
                    current_tenant_id,
                )
                state.manually_disabled_workspace_ids = cls._add_id(
                    state.manually_disabled_workspace_ids,
                    current_tenant_id,
                )
            case _:
                raise ValueError(f"Unsupported action: {action}")

    @classmethod
    def _build_response(
        cls,
        *,
        state: AccountStepByStepTourState | None,
    ) -> StepByStepTourStateResponse:
        if state is None:
            return {
                "first_workspace_id": None,
                "skipped": False,
                "completed_task_ids": [],
                "manually_enabled_workspace_ids": [],
                "manually_disabled_workspace_ids": [],
                "updated_at": None,
            }

        return {
            "first_workspace_id": state.first_workspace_id,
            "skipped": state.skipped,
            "completed_task_ids": cls._normalize_ids(state.completed_task_ids),
            "manually_enabled_workspace_ids": cls._normalize_ids(state.manually_enabled_workspace_ids),
            "manually_disabled_workspace_ids": cls._normalize_ids(state.manually_disabled_workspace_ids),
            "updated_at": getattr(state, "updated_at", None),
        }

    @staticmethod
    def _validate_task_id(task_id: str) -> None:
        if task_id not in STEP_BY_STEP_TOUR_TASK_IDS:
            raise ValueError(f"Unsupported task_id: {task_id}")

    @classmethod
    def _add_id(cls, values: list[str], value: str) -> list[str]:
        normalized = cls._normalize_ids(values)
        if value in normalized:
            return normalized
        return [*normalized, value]

    @classmethod
    def _remove_id(cls, values: list[str], value: str) -> list[str]:
        return [item for item in cls._normalize_ids(values) if item != value]

    @staticmethod
    def _normalize_ids(values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            if value not in normalized:
                normalized.append(value)
        return normalized
