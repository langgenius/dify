"""
Integration tests for WorkflowNodeExecutionModel.created_by_account and .created_by_end_user.

Migrated from unit_tests/models/test_workflow_trigger_log.py, replacing
monkeypatch.setattr(db.session, "scalar", ...) with real Account/EndUser rows
persisted in PostgreSQL so the db.session.get() call executes against the DB.
"""

from collections.abc import Generator
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models.account import Account
from models.enums import CreatorUserRole
from models.model import App, AppMode, EndUser
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom


class TestWorkflowNodeExecutionModelCreatedBy:
    """Integration tests for WorkflowNodeExecutionModel creator lookup properties."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        """Automatically rollback session changes after each test."""
        yield
        db_session_with_containers.rollback()

    def _create_account(self, db_session: Session) -> Account:
        account = Account(
            name="Test Account",
            email=f"test_{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        db_session.add(account)
        db_session.flush()
        return account

    def _create_end_user(self, db_session: Session, tenant_id: str, app_id: str) -> EndUser:
        end_user = EndUser(
            tenant_id=tenant_id,
            app_id=app_id,
            type="service_api",
            external_user_id=f"ext-{uuid4()}",
            name="End User",
            session_id=f"session-{uuid4()}",
        )
        end_user.is_anonymous = False
        db_session.add(end_user)
        db_session.flush()
        return end_user

    def _create_app(self, db_session: Session, tenant_id: str, created_by: str) -> App:
        app = App(
            tenant_id=tenant_id,
            name=f"App {uuid4()}",
            mode=AppMode.WORKFLOW,
            enable_site=False,
            enable_api=True,
            is_demo=False,
            is_public=False,
            is_universal=False,
            created_by=created_by,
            updated_by=created_by,
        )
        db_session.add(app)
        db_session.flush()
        return app

    def _make_execution(
        self, tenant_id: str, app_id: str, created_by_role: str, created_by: str
    ) -> WorkflowNodeExecutionModel:
        return WorkflowNodeExecutionModel(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=str(uuid4()),
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            workflow_run_id=None,
            index=1,
            predecessor_node_id=None,
            node_execution_id=None,
            node_id="n1",
            node_type="start",
            title="Start",
            inputs=None,
            process_data=None,
            outputs=None,
            status="succeeded",
            error=None,
            elapsed_time=0.0,
            execution_metadata=None,
            created_by_role=created_by_role,
            created_by=created_by,
        )

    def test_created_by_account_returns_account_when_role_is_account(self, db_session_with_containers: Session) -> None:
        """created_by_account returns the Account row when role is ACCOUNT."""
        account = self._create_account(db_session_with_containers)
        app = self._create_app(db_session_with_containers, str(uuid4()), account.id)

        execution = self._make_execution(
            tenant_id=app.tenant_id,
            app_id=app.id,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=account.id,
        )

        result = execution.created_by_account

        assert result is not None
        assert result.id == account.id

    def test_created_by_account_returns_none_when_role_is_end_user(self, db_session_with_containers: Session) -> None:
        """created_by_account returns None when role is END_USER, even if an Account exists."""
        account = self._create_account(db_session_with_containers)
        app = self._create_app(db_session_with_containers, str(uuid4()), account.id)

        execution = self._make_execution(
            tenant_id=app.tenant_id,
            app_id=app.id,
            created_by_role=CreatorUserRole.END_USER.value,
            created_by=account.id,
        )

        result = execution.created_by_account

        assert result is None

    def test_created_by_end_user_returns_end_user_when_role_is_end_user(
        self, db_session_with_containers: Session
    ) -> None:
        """created_by_end_user returns the EndUser row when role is END_USER."""
        account = self._create_account(db_session_with_containers)
        tenant_id = str(uuid4())
        app = self._create_app(db_session_with_containers, tenant_id, account.id)
        end_user = self._create_end_user(db_session_with_containers, tenant_id, app.id)

        execution = self._make_execution(
            tenant_id=tenant_id,
            app_id=app.id,
            created_by_role=CreatorUserRole.END_USER.value,
            created_by=end_user.id,
        )

        result = execution.created_by_end_user

        assert result is not None
        assert result.id == end_user.id

    def test_created_by_end_user_returns_none_when_role_is_account(self, db_session_with_containers: Session) -> None:
        """created_by_end_user returns None when role is ACCOUNT, even if an EndUser exists."""
        account = self._create_account(db_session_with_containers)
        tenant_id = str(uuid4())
        app = self._create_app(db_session_with_containers, tenant_id, account.id)
        end_user = self._create_end_user(db_session_with_containers, tenant_id, app.id)

        execution = self._make_execution(
            tenant_id=tenant_id,
            app_id=app.id,
            created_by_role=CreatorUserRole.ACCOUNT.value,
            created_by=end_user.id,
        )

        result = execution.created_by_end_user

        assert result is None
