"""Application service for account-level Step-by-step Tour use cases."""

from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from typing import Protocol, get_args

from libs.datetime_utils import ensure_naive_utc
from machinery.context import RequestContext
from services.account_ports import AccountRepository
from services.entities.onboarding_entities import (
    StepByStepTourPatch,
    StepByStepTourResult,
    StepByStepTourState,
    StepByStepTourTaskId,
)

_TASK_IDS: frozenset[str] = frozenset(get_args(StepByStepTourTaskId))


class StepByStepTourStateRepository(Protocol):
    def get(self, account_id: str) -> StepByStepTourState | None: ...

    def initialize(self, account_id: str, first_workspace_id: str) -> StepByStepTourState: ...

    def mutate(
        self,
        account_id: str,
        mutation: Callable[[StepByStepTourState], StepByStepTourState],
    ) -> StepByStepTourState: ...


class StepByStepTourService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        states: StepByStepTourStateRepository,
        enabled: bool,
        rollout_started_at: datetime | None,
    ) -> None:
        self._accounts = accounts
        self._states = states
        self._enabled = enabled
        self._rollout_started_at = rollout_started_at

    def get_state(self, context: RequestContext) -> StepByStepTourResult:
        workspace_id = self._require_workspace(context)
        account = self._accounts.get(context.account_id)
        if account is None:
            raise RuntimeError("Console account admission resolved an unknown account")

        if not self._is_eligible(account.initialized_at or account.created_at):
            return self._to_result(self._states.get(context.account_id))

        return self._to_result(self._states.initialize(context.account_id, workspace_id))

    def patch_state(self, context: RequestContext, patch: StepByStepTourPatch) -> StepByStepTourResult:
        workspace_id = self._require_workspace(context)
        state = self._states.mutate(
            context.account_id,
            lambda current: self._apply_action(current, patch=patch, workspace_id=workspace_id),
        )
        return self._to_result(state)

    def _is_eligible(self, account_started_at: datetime) -> bool:
        if not self._enabled or self._rollout_started_at is None:
            return False
        return ensure_naive_utc(account_started_at) >= ensure_naive_utc(self._rollout_started_at)

    @classmethod
    def _apply_action(
        cls,
        state: StepByStepTourState,
        *,
        patch: StepByStepTourPatch,
        workspace_id: str,
    ) -> StepByStepTourState:
        match patch.action:
            case "skip":
                return replace(
                    state,
                    skipped=True,
                    manually_enabled_workspace_ids=cls._remove_id(
                        state.manually_enabled_workspace_ids,
                        workspace_id,
                    ),
                )
            case "complete_task":
                task_id = cls._require_task_id(patch.task_id)
                return replace(state, completed_task_ids=cls._add_id(state.completed_task_ids, task_id))
            case "uncomplete_task":
                task_id = cls._require_task_id(patch.task_id)
                return replace(state, completed_task_ids=cls._remove_id(state.completed_task_ids, task_id))
            case "enable_current_workspace":
                return replace(
                    state,
                    skipped=False,
                    manually_enabled_workspace_ids=cls._add_id(
                        state.manually_enabled_workspace_ids,
                        workspace_id,
                    ),
                    manually_disabled_workspace_ids=cls._remove_id(
                        state.manually_disabled_workspace_ids,
                        workspace_id,
                    ),
                )
            case "disable_current_workspace":
                return replace(
                    state,
                    manually_enabled_workspace_ids=cls._remove_id(
                        state.manually_enabled_workspace_ids,
                        workspace_id,
                    ),
                    manually_disabled_workspace_ids=cls._add_id(
                        state.manually_disabled_workspace_ids,
                        workspace_id,
                    ),
                )
            case _:
                raise ValueError(f"Unsupported action: {patch.action}")

    @staticmethod
    def _require_workspace(context: RequestContext) -> str:
        if context.active_workspace_id is None:
            raise RuntimeError("Console account admission did not resolve an active workspace")
        return context.active_workspace_id

    @staticmethod
    def _require_task_id(task_id: str | None) -> str:
        if task_id is None:
            raise ValueError("task_id is required")
        if task_id not in _TASK_IDS:
            raise ValueError(f"Unsupported task_id: {task_id}")
        return task_id

    @classmethod
    def _add_id(cls, values: tuple[str, ...], value: str) -> tuple[str, ...]:
        normalized = cls._normalize_ids(values)
        return normalized if value in normalized else (*normalized, value)

    @classmethod
    def _remove_id(cls, values: tuple[str, ...], value: str) -> tuple[str, ...]:
        return tuple(item for item in cls._normalize_ids(values) if item != value)

    @staticmethod
    def _normalize_ids(values: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(dict.fromkeys(values))

    @staticmethod
    def _to_result(state: StepByStepTourState | None) -> StepByStepTourResult:
        if state is None:
            return StepByStepTourResult()
        return StepByStepTourResult(
            first_workspace_id=state.first_workspace_id,
            skipped=state.skipped,
            completed_task_ids=tuple(dict.fromkeys(state.completed_task_ids)),
            manually_enabled_workspace_ids=tuple(dict.fromkeys(state.manually_enabled_workspace_ids)),
            manually_disabled_workspace_ids=tuple(dict.fromkeys(state.manually_disabled_workspace_ids)),
            updated_at=state.updated_at,
        )
