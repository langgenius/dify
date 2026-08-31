from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from models.account import Account, AccountStatus
from models.onboarding import AccountStepByStepTourState
from services.step_by_step_tour_service import StepByStepTourService
from tests.unit_tests.config_override import apply_config_overrides


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


def _persist_state(session: Session, state: AccountStepByStepTourState) -> None:
    session.add(state)
    session.commit()


def _load_state(session: Session) -> AccountStepByStepTourState | None:
    return session.scalar(
        select(AccountStepByStepTourState).where(AccountStepByStepTourState.account_id == "account-1")
    )


def _set_tour_config(monkeypatch: pytest.MonkeyPatch, *, enabled: bool, rollout_started_at: datetime | None) -> None:
    apply_config_overrides(
        monkeypatch,
        ENABLE_STEP_BY_STEP_TOUR=enabled,
        STEP_BY_STEP_TOUR_ROLLOUT_STARTED_AT=rollout_started_at,
    )


def test_get_state_creates_state_and_records_first_workspace_for_eligible_account(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _set_tour_config(monkeypatch, enabled=True, rollout_started_at=datetime(2026, 6, 1))

    result = StepByStepTourService.get_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-1",
        session=sqlite_session,
    )

    assert result["first_workspace_id"] == "workspace-1"
    assert result["completed_task_ids"] == []
    with sqlite_session_factory() as observer:
        persisted = _load_state(observer)
        assert persisted is not None
        assert persisted.account_id == "account-1"
        assert persisted.first_workspace_id == "workspace-1"


def test_is_eligible_does_not_depend_on_cloud_edition(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_tour_config(monkeypatch, enabled=True, rollout_started_at=datetime(2026, 6, 1))
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)

    result = StepByStepTourService.is_eligible(_account(initialized_at=datetime(2026, 6, 28)))

    assert result is True


def test_get_state_does_not_create_state_for_ineligible_account_without_existing_state(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _set_tour_config(monkeypatch, enabled=True, rollout_started_at=datetime(2026, 6, 1))

    result = StepByStepTourService.get_state(
        account=_account(initialized_at=datetime(2026, 5, 31)),
        current_tenant_id="workspace-1",
        session=sqlite_session,
    )

    assert result == {
        "first_workspace_id": None,
        "skipped": False,
        "completed_task_ids": [],
        "manually_enabled_workspace_ids": [],
        "manually_disabled_workspace_ids": [],
        "updated_at": None,
    }
    with sqlite_session_factory() as observer:
        assert _load_state(observer) is None


def test_patch_state_persists_even_when_account_is_not_eligible(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _set_tour_config(monkeypatch, enabled=False, rollout_started_at=datetime(2026, 6, 1))

    result = StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-2",
        patch={"action": "enable_current_workspace"},
        session=sqlite_session,
    )

    assert result["skipped"] is False
    assert result["manually_enabled_workspace_ids"] == ["workspace-2"]
    assert result["manually_disabled_workspace_ids"] == []
    with sqlite_session_factory() as observer:
        persisted = _load_state(observer)
        assert persisted is not None
        assert persisted.manually_enabled_workspace_ids == ["workspace-2"]


def test_patch_state_skip_action_sets_skipped_and_removes_current_workspace_enable(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _set_tour_config(monkeypatch, enabled=False, rollout_started_at=datetime(2026, 6, 1))
    state = _state()
    state.manually_enabled_workspace_ids = ["workspace-1", "workspace-2"]
    _persist_state(sqlite_session, state)

    result = StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-1",
        patch={"action": "skip"},
        session=sqlite_session,
    )

    assert result["skipped"] is True
    assert result["manually_enabled_workspace_ids"] == ["workspace-2"]
    assert result["manually_disabled_workspace_ids"] == []
    assert _load_state(sqlite_session) is state


def test_patch_state_disable_action_moves_current_workspace_to_disabled(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _set_tour_config(monkeypatch, enabled=False, rollout_started_at=datetime(2026, 6, 1))
    state = _state()
    state.manually_enabled_workspace_ids = ["workspace-1", "workspace-2"]
    _persist_state(sqlite_session, state)

    result = StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-1",
        patch={"action": "disable_current_workspace"},
        session=sqlite_session,
    )

    assert result["manually_enabled_workspace_ids"] == ["workspace-2"]
    assert result["manually_disabled_workspace_ids"] == ["workspace-1"]
    assert _load_state(sqlite_session) is state


def test_patch_state_complete_and_uncomplete_task(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    _set_tour_config(monkeypatch, enabled=False, rollout_started_at=datetime(2026, 6, 1))
    state = _state()
    state.completed_task_ids = ["home"]
    _persist_state(sqlite_session, state)

    StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-1",
        patch={"action": "complete_task", "task_id": "studio"},
        session=sqlite_session,
    )
    result = StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-1",
        patch={"action": "uncomplete_task", "task_id": "home"},
        session=sqlite_session,
    )

    assert result["completed_task_ids"] == ["studio"]


def test_patch_state_recovers_when_concurrent_request_created_state(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _set_tour_config(monkeypatch, enabled=False, rollout_started_at=datetime(2026, 6, 1))
    existing_state = _state()
    existing_state.manually_enabled_workspace_ids = ["workspace-1"]
    lifecycle_events: list[str] = []

    @event.listens_for(sqlite_session, "before_flush", once=True)
    def add_conflicting_pending_state(session: Session, _flush_context, _instances) -> None:
        lifecycle_events.append("before_flush")
        session.add(AccountStepByStepTourState(account_id="account-1"))

    @event.listens_for(sqlite_session, "after_soft_rollback", once=True)
    def persist_winning_request(_session: Session, _previous_transaction) -> None:
        lifecycle_events.append("after_soft_rollback")
        with sqlite_session_factory() as winner:
            winner.add(existing_state)
            winner.commit()

    result = StepByStepTourService.patch_state(
        account=_account(initialized_at=datetime(2026, 6, 28)),
        current_tenant_id="workspace-2",
        patch={"action": "enable_current_workspace"},
        session=sqlite_session,
    )

    assert result["manually_enabled_workspace_ids"] == ["workspace-1", "workspace-2"]
    assert lifecycle_events == ["before_flush", "after_soft_rollback"]
    with sqlite_session_factory() as observer:
        persisted = _load_state(observer)
        assert persisted is not None
        assert persisted.manually_enabled_workspace_ids == ["workspace-1", "workspace-2"]
