from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from unittest.mock import Mock

import pytest

from machinery.context import RequestContext
from services.account_ports import AccountRepository
from services.entities.account_entities import AccountSnapshot
from services.entities.onboarding_entities import StepByStepTourPatch, StepByStepTourResult, StepByStepTourState
from services.step_by_step_tour_service import StepByStepTourService


def _context(*, workspace_id: str = "workspace-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=workspace_id,
    )


class StateRepositoryStub:
    def __init__(self, state: StepByStepTourState | None = None) -> None:
        self.state = state
        self.get_account_ids: list[str] = []
        self.initialize_calls: list[tuple[str, str]] = []
        self.mutation_account_ids: list[str] = []

    def get(self, account_id: str) -> StepByStepTourState | None:
        self.get_account_ids.append(account_id)
        return self.state

    def initialize(self, account_id: str, first_workspace_id: str) -> StepByStepTourState:
        self.initialize_calls.append((account_id, first_workspace_id))
        if self.state is None:
            self.state = StepByStepTourState(account_id=account_id, first_workspace_id=first_workspace_id)
        elif self.state.first_workspace_id is None:
            self.state = replace(self.state, first_workspace_id=first_workspace_id)
        return self.state

    def mutate(
        self,
        account_id: str,
        mutation: Callable[[StepByStepTourState], StepByStepTourState],
    ) -> StepByStepTourState:
        self.mutation_account_ids.append(account_id)
        if self.state is None:
            self.state = StepByStepTourState(account_id=account_id)
        self.state = mutation(self.state)
        return self.state


def _account(*, started_at: datetime = datetime(2026, 6, 28)) -> AccountSnapshot:
    return AccountSnapshot(
        id="account-1",
        name="Account",
        email="account@example.com",
        avatar=None,
        is_password_set=False,
        interface_language="en-US",
        interface_theme="light",
        timezone="UTC",
        last_login_at=None,
        last_login_ip=None,
        status="active",
        initialized_at=started_at,
        created_at=started_at,
    )


def _accounts(account: AccountSnapshot | None) -> Mock:
    accounts = Mock(spec=AccountRepository)
    accounts.get.return_value = account
    return accounts


def _service(
    *,
    states: StateRepositoryStub,
    account: AccountSnapshot | None = None,
    enabled: bool = True,
    rollout_started_at: datetime | None = datetime(2026, 6, 1),
) -> StepByStepTourService:
    return StepByStepTourService(
        accounts=_accounts(account or _account()),
        states=states,
        enabled=enabled,
        rollout_started_at=rollout_started_at,
    )


def test_get_state_creates_state_and_records_first_workspace_for_eligible_account() -> None:
    states = StateRepositoryStub()

    result = _service(states=states).get_state(_context())

    assert result.first_workspace_id == "workspace-1"
    assert states.get_account_ids == []
    assert states.initialize_calls == [("account-1", "workspace-1")]
    assert states.mutation_account_ids == []


def test_get_state_returns_existing_state_without_rewriting_first_workspace() -> None:
    state = StepByStepTourState(account_id="account-1", first_workspace_id="workspace-original")
    states = StateRepositoryStub(state)

    result = _service(states=states).get_state(_context(workspace_id="workspace-current"))

    assert result.first_workspace_id == "workspace-original"
    assert states.initialize_calls == [("account-1", "workspace-current")]
    assert states.mutation_account_ids == []


def test_get_state_does_not_create_state_for_ineligible_account() -> None:
    states = StateRepositoryStub()
    service = _service(states=states, account=_account(started_at=datetime(2026, 5, 31)))

    result = service.get_state(_context())

    assert result == StepByStepTourResult()
    assert states.get_account_ids == ["account-1"]
    assert states.mutation_account_ids == []


def test_get_state_does_not_create_state_when_tour_is_disabled() -> None:
    states = StateRepositoryStub()

    result = _service(states=states, enabled=False).get_state(_context())

    assert result == StepByStepTourResult()
    assert states.get_account_ids == ["account-1"]


def test_patch_state_persists_even_when_tour_is_disabled() -> None:
    states = StateRepositoryStub()
    service = _service(states=states, enabled=False)

    result = service.patch_state(_context(workspace_id="workspace-2"), StepByStepTourPatch("enable_current_workspace"))

    assert result.manually_enabled_workspace_ids == ("workspace-2",)
    assert states.mutation_account_ids == ["account-1"]


def test_patch_state_skip_removes_current_workspace_enable() -> None:
    states = StateRepositoryStub(
        StepByStepTourState(
            account_id="account-1",
            manually_enabled_workspace_ids=("workspace-1", "workspace-2"),
        )
    )

    result = _service(states=states).patch_state(_context(), StepByStepTourPatch("skip"))

    assert result.skipped is True
    assert result.manually_enabled_workspace_ids == ("workspace-2",)


def test_patch_state_disable_moves_current_workspace_to_disabled() -> None:
    states = StateRepositoryStub(
        StepByStepTourState(
            account_id="account-1",
            manually_enabled_workspace_ids=("workspace-1", "workspace-2"),
        )
    )

    result = _service(states=states).patch_state(
        _context(),
        StepByStepTourPatch("disable_current_workspace"),
    )

    assert result.manually_enabled_workspace_ids == ("workspace-2",)
    assert result.manually_disabled_workspace_ids == ("workspace-1",)


def test_patch_state_complete_and_uncomplete_task() -> None:
    states = StateRepositoryStub(StepByStepTourState(account_id="account-1", completed_task_ids=("home",)))
    service = _service(states=states)

    service.patch_state(_context(), StepByStepTourPatch("complete_task", "studio"))
    result = service.patch_state(_context(), StepByStepTourPatch("uncomplete_task", "home"))

    assert result.completed_task_ids == ("studio",)


def test_rejects_unsupported_task_id() -> None:
    with pytest.raises(ValueError, match="Unsupported task_id"):
        StepByStepTourService._require_task_id("unknown")


def test_get_state_rejects_unknown_admitted_account() -> None:
    states = StateRepositoryStub()
    service = StepByStepTourService(
        accounts=_accounts(None),
        states=states,
        enabled=True,
        rollout_started_at=datetime(2026, 6, 1),
    )

    with pytest.raises(RuntimeError, match="unknown account"):
        service.get_state(_context())
