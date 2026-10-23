"""Regression coverage for ``models.trigger.WorkflowTriggerLog`` account accessors.

Ensures the ``@property``→session-parameter refactor preserves the role-based dispatch:
``created_by_account`` looks up an Account only when role is ACCOUNT; ``created_by_end_user``
looks up an EndUser only when role is END_USER.

Both accessors are exercised against the real ``sqlite_session`` fixture (a genuine
SQLAlchemy ``Session`` bound to a pristine full-schema SQLite database) so the assertions
cover actual query behaviour rather than a mock's recorded call.
"""

from sqlalchemy.orm import Session

from models.account import Account
from models.enums import CreatorUserRole, EndUserType, WorkflowTriggerStatus
from models.model import EndUser
from models.trigger import WorkflowTriggerLog


def _log(role: CreatorUserRole, created_by: str) -> WorkflowTriggerLog:
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
    def test_returns_account_lookup_when_role_is_account(self, sqlite_session: Session) -> None:
        account = Account(name="Test Account", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.flush()
        log = _log(CreatorUserRole.ACCOUNT, created_by=account.id)

        result = log.created_by_account(session=sqlite_session)

        assert result is not None
        assert result.id == account.id

    def test_returns_none_when_role_is_end_user(self, sqlite_session: Session) -> None:
        account = Account(name="Test Account", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.flush()
        log = _log(CreatorUserRole.END_USER, created_by=account.id)

        assert log.created_by_account(session=sqlite_session) is None


class TestCreatedByEndUser:
    def test_returns_end_user_lookup_when_role_is_end_user(self, sqlite_session: Session) -> None:
        end_user = EndUser(
            tenant_id="00000000-0000-0000-0000-000000000001",
            type=EndUserType.BROWSER,
            session_id="session-1",
        )
        sqlite_session.add(end_user)
        sqlite_session.flush()
        log = _log(CreatorUserRole.END_USER, created_by=end_user.id)

        result = log.created_by_end_user(session=sqlite_session)

        assert result is not None
        assert result.id == end_user.id

    def test_returns_none_when_role_is_account(self, sqlite_session: Session) -> None:
        end_user = EndUser(
            tenant_id="00000000-0000-0000-0000-000000000001",
            type=EndUserType.BROWSER,
            session_id="session-1",
        )
        sqlite_session.add(end_user)
        sqlite_session.flush()
        log = _log(CreatorUserRole.ACCOUNT, created_by=end_user.id)

        assert log.created_by_end_user(session=sqlite_session) is None
