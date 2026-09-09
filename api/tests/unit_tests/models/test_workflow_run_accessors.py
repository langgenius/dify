"""Regression coverage for ``WorkflowRun`` account accessors.

Ensures the ``@property``→session-parameter refactor preserves the role-based dispatch:
``created_by_account`` looks up an Account only when role is ACCOUNT; ``created_by_end_user``
looks up an EndUser only when role is END_USER. Also covers the session-carrying response
sources used by the console endpoints that validate the run detail / pagination responses
with ``from_attributes=True``.
"""

from types import SimpleNamespace
from uuid import uuid4

from sqlalchemy.orm import Session

from fields.workflow_run_fields import workflow_run_pagination_response_source, workflow_run_response_source
from models.account import Account
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import EndUser
from models.workflow import WorkflowRun


def _run(role: CreatorUserRole, created_by: str) -> WorkflowRun:
    """Construct a WorkflowRun without touching the database."""
    return WorkflowRun(
        id=str(uuid4()),
        tenant_id="00000000-0000-0000-0000-000000000001",
        app_id="00000000-0000-0000-0000-000000000002",
        workflow_id=str(uuid4()),
        type="workflow",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1.0",
        status="succeeded",
        created_by_role=role,
        created_by=created_by,
    )


class TestCreatedByAccount:
    def test_returns_account_lookup_when_role_is_account(self, sqlite_session: Session) -> None:
        account = Account(name="Test Account", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.flush()
        run = _run(CreatorUserRole.ACCOUNT, created_by=account.id)

        result = run.created_by_account(session=sqlite_session)

        assert result is not None
        assert result.id == account.id

    def test_returns_none_when_role_is_end_user(self, sqlite_session: Session) -> None:
        account = Account(name="Test Account", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.flush()
        run = _run(CreatorUserRole.END_USER, created_by=account.id)

        assert run.created_by_account(session=sqlite_session) is None


class TestCreatedByEndUser:
    def test_returns_end_user_lookup_when_role_is_end_user(self, sqlite_session: Session) -> None:
        end_user = EndUser(
            tenant_id="00000000-0000-0000-0000-000000000001",
            type=EndUserType.BROWSER,
            session_id="session-1",
        )
        sqlite_session.add(end_user)
        sqlite_session.flush()
        run = _run(CreatorUserRole.END_USER, created_by=end_user.id)

        result = run.created_by_end_user(session=sqlite_session)

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
        run = _run(CreatorUserRole.ACCOUNT, created_by=end_user.id)

        assert run.created_by_end_user(session=sqlite_session) is None


class TestWorkflowRunResponseSources:
    def test_detail_source_resolves_accessors_and_proxies_other_attributes(self, sqlite_session: Session) -> None:
        account = Account(name="Test Account", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.flush()
        run = _run(CreatorUserRole.ACCOUNT, created_by=account.id)

        source = workflow_run_response_source(run, session=sqlite_session)

        resolved = source.created_by_account
        assert resolved is not None
        assert resolved.id == account.id
        assert source.created_by_end_user is None
        assert source.version == "1.0"

    def test_pagination_source_wraps_each_run(self, sqlite_session: Session) -> None:
        account = Account(name="Test Account", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.flush()
        runs = [_run(CreatorUserRole.ACCOUNT, created_by=account.id) for _ in range(2)]
        pagination = SimpleNamespace(data=runs, limit=20, has_more=False)

        payload = workflow_run_pagination_response_source(pagination, session=sqlite_session)

        assert payload["limit"] == 20
        assert payload["has_more"] is False
        assert [item.created_by_account.id for item in payload["data"]] == [account.id, account.id]
