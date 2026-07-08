from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from models.account import Account, AccountStatus
from models.onboarding import AccountStepByStepTourState
from services import step_by_step_tour_service as service_module
from services.step_by_step_tour_service import StepByStepTourService


class _ScalarResult:
    def __init__(self, state: AccountStepByStepTourState | None) -> None:
        self._state = state

    def scalar_one_or_none(self) -> AccountStepByStepTourState | None:
        return self._state


class _FakeSession:
    def __init__(self, state: AccountStepByStepTourState | None = None) -> None:
        self.state = state
        self.added: list[AccountStepByStepTourState] = []
        self.commit_count = 0
        self.flush_count = 0
        self.refresh_count = 0
        self.rollback_count = 0

    def execute(self, _stmt) -> _ScalarResult:
        return _ScalarResult(self.state)

    def add(self, state: AccountStepByStepTourState) -> None:
        self.state = state
        self.added.append(state)

    def flush(self) -> None:
        self.flush_count += 1

    def commit(self) -> None:
        self.commit_count += 1

    def refresh(self, state: AccountStepByStepTourState) -> None:
        self.refresh_count += 1
        state.updated_at = datetime(2026, 6, 28, tzinfo=UTC)

    def rollback(self) -> None:
        self.rollback_count += 1


class _RaceInsertSession(_FakeSession):
    def __init__(self, state_after_rollback: AccountStepByStepTourState) -> None:
        super().__init__(state=None)
        self.state_after_rollback = state_after_rollback

    def flush(self) -> None:
        self.flush_count += 1
        raise IntegrityError("insert", {}, Exception("duplicate"))

    def rollback(self) -> None:
        super().rollback()
        self.state = self.state_after_rollback


def _account(*, initialized_at: datetime | None = None, created_at: datetime | None = None) -> Account:
    account = Account(name="User", email="user@example.com", status=AccountStatus.ACTIVE)
    account.id = "account-1"
    account.initialized_at = initialized_at
    account.created_at = created_at or datetime(2026, 6, 28)
    return account


def _state() -> AccountStepByStepTourState:
    state = AccountStepByStepTourState(account_id="account-1")
    state.updated_at = datetime(2026, 6, 28, tzinfo=UTC)
    return state


def _set_tour_config(monkeypatch: pytest.MonkeyPatch, *, enabled: bool, rollout_started_at: datetime | None) -> None:
    monkeypatch.setattr(service_module.dify_config, "ENABLE_STEP_BY_STEP_TOUR", enabled)
    monkeypatch.setattr(service_module.dify_config, "STEP_BY_STEP_TOUR_ROLLOUT_STARTED_AT", rollout_started_at)


def test_get_state_creates_state_and_records_first_workspace_for_eligible_account(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_tour_config(monkeypatch, enabled=True, rollout_started_at=datetime(2026, 6, 1))
    session = _FakeSession()

    result = StepByStepTourService.get_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-1",
        session=session,
    )

    assert result["first_workspace_id"] == "workspace-1"
    assert result["completed_task_ids"] == []
    assert len(session.added) == 1
    assert session.added[0].account_id == "account-1"
    assert session.commit_count == 1
    assert session.refresh_count == 1


def test_is_eligible_does_not_depend_on_cloud_edition(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_tour_config(monkeypatch, enabled=True, rollout_started_at=datetime(2026, 6, 1))
    monkeypatch.setattr(service_module.dify_config, "EDITION", "SELF_HOSTED")

    result = StepByStepTourService.is_eligible(_account(initialized_at=datetime(2026, 6, 28)))

    assert result is True


def test_get_state_does_not_create_state_for_ineligible_account_without_existing_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_tour_config(monkeypatch, enabled=True, rollout_started_at=datetime(2026, 6, 1))
    session = _FakeSession()

    result = StepByStepTourService.get_state(
        account=_account(initialized_at=datetime(2026, 5, 31)),
        current_tenant_id="workspace-1",
        session=session,
    )

    assert result == {
        "first_workspace_id": None,
        "skipped": False,
        "completed_task_ids": [],
        "manually_enabled_workspace_ids": [],
        "manually_disabled_workspace_ids": [],
        "updated_at": None,
    }
    assert session.added == []
    assert session.commit_count == 0


def test_patch_state_persists_even_when_account_is_not_eligible(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_tour_config(monkeypatch, enabled=False, rollout_started_at=datetime(2026, 6, 1))
    session = _FakeSession()

    result = StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-2",
        patch={"action": "enable_current_workspace"},
        session=session,
    )

    assert result["skipped"] is False
    assert result["manually_enabled_workspace_ids"] == ["workspace-2"]
    assert result["manually_disabled_workspace_ids"] == []
    assert len(session.added) == 1
    assert session.commit_count == 1


def test_patch_state_skip_action_sets_skipped_and_removes_current_workspace_enable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_tour_config(monkeypatch, enabled=False, rollout_started_at=datetime(2026, 6, 1))
    state = _state()
    state.manually_enabled_workspace_ids = ["workspace-1", "workspace-2"]
    session = _FakeSession(state=state)

    result = StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-1",
        patch={"action": "skip"},
        session=session,
    )

    assert result["skipped"] is True
    assert result["manually_enabled_workspace_ids"] == ["workspace-2"]
    assert result["manually_disabled_workspace_ids"] == []
    assert session.added == []
    assert session.commit_count == 1


def test_patch_state_disable_action_moves_current_workspace_to_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_tour_config(monkeypatch, enabled=False, rollout_started_at=datetime(2026, 6, 1))
    state = _state()
    state.manually_enabled_workspace_ids = ["workspace-1", "workspace-2"]
    session = _FakeSession(state=state)

    result = StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-1",
        patch={"action": "disable_current_workspace"},
        session=session,
    )

    assert result["manually_enabled_workspace_ids"] == ["workspace-2"]
    assert result["manually_disabled_workspace_ids"] == ["workspace-1"]
    assert session.commit_count == 1


def test_patch_state_complete_and_uncomplete_task(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_tour_config(monkeypatch, enabled=False, rollout_started_at=datetime(2026, 6, 1))
    state = _state()
    state.completed_task_ids = ["home"]
    session = _FakeSession(state=state)

    StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-1",
        patch={"action": "complete_task", "task_id": "studio"},
        session=session,
    )
    result = StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-1",
        patch={"action": "uncomplete_task", "task_id": "home"},
        session=session,
    )

    assert result["completed_task_ids"] == ["studio"]


def test_patch_state_recovers_when_concurrent_request_created_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_tour_config(monkeypatch, enabled=False, rollout_started_at=datetime(2026, 6, 1))
    existing_state = _state()
    existing_state.manually_enabled_workspace_ids = ["workspace-1"]
    session = _RaceInsertSession(state_after_rollback=existing_state)

    result = StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-2",
        patch={"action": "enable_current_workspace"},
        session=session,
    )

    assert result["manually_enabled_workspace_ids"] == ["workspace-1", "workspace-2"]
    assert session.flush_count == 1
    assert session.rollback_count == 1
    assert session.commit_count == 1
