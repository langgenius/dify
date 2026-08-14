"""Regression coverage for ``models.trigger.WorkflowTriggerLog`` account accessors.

Ensures the ``@property``→session-parameter refactor preserves the role-based dispatch:
``created_by_account`` looks up an Account only when role is ACCOUNT; ``created_by_end_user``
looks up an EndUser only when role is END_USER.
"""

from unittest.mock import MagicMock

from models.enums import CreatorUserRole, WorkflowTriggerStatus
from models.trigger import WorkflowTriggerLog


def _log(role: CreatorUserRole, created_by: str = "00000000-0000-0000-0000-000000000abc") -> WorkflowTriggerLog:
    """Construct a WorkflowTriggerLog without touching the database."""
    return WorkflowTriggerLog(
        tenant_id="00000000-0000-0000-0000-000000000001",
        app_id="00000000-0000-0000-0000-000000000002",
        workflow_id="00000000-0000-0000-0000-000000000003",
        workflow_run_id=None,
        root_node_id=None,
        trigger_metadata="{}",
        trigger_type="manual",
        trigger_data="{}",
        inputs="{}",
        outputs=None,
        status=WorkflowTriggerStatus.SUCCEEDED,
        error=None,
        queue_name="default",
        celery_task_id=None,
        created_by_role=role,
        created_by=created_by,
    )


class TestCreatedByAccount:
    def test_returns_account_lookup_when_role_is_account(self) -> None:
        log = _log(CreatorUserRole.ACCOUNT)
        session = MagicMock()
        sentinel = object()
        session.get.return_value = sentinel

        result = log.created_by_account(session=session)

        assert result is sentinel
        session.get.assert_called_once()

    def test_returns_none_when_role_is_end_user(self) -> None:
        log = _log(CreatorUserRole.END_USER)
        session = MagicMock()

        assert log.created_by_account(session=session) is None
        session.get.assert_not_called()


class TestCreatedByEndUser:
    def test_returns_end_user_lookup_when_role_is_end_user(self) -> None:
        log = _log(CreatorUserRole.END_USER)
        session = MagicMock()
        sentinel = object()
        session.get.return_value = sentinel

        result = log.created_by_end_user(session=session)

        assert result is sentinel
        session.get.assert_called_once()

    def test_returns_none_when_role_is_account(self) -> None:
        log = _log(CreatorUserRole.ACCOUNT)
        session = MagicMock()

        assert log.created_by_end_user(session=session) is None
        session.get.assert_not_called()
