"""
Integration tests for Conversation.status_count and Site.generate_code model properties.

Migrated from unit_tests/models/test_app_models.py TestConversationStatusCount and
test_site_generate_code, replacing db.session.scalars mocks with real PostgreSQL queries.
"""

from collections.abc import Generator
from uuid import uuid4

import pytest
from graphon.enums import WorkflowExecutionStatus
from sqlalchemy.orm import Session

from models.enums import ConversationFromSource, InvokeFrom
from models.model import App, AppMode, Conversation, Message, Site
from models.workflow import Workflow, WorkflowRun, WorkflowRunTriggeredFrom, WorkflowType


class TestConversationStatusCount:
    """Integration tests for Conversation.status_count property."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        """Automatically rollback session changes after each test."""
        yield
        db_session_with_containers.rollback()

    def _create_app(self, db_session: Session, tenant_id: str, created_by: str) -> App:
        app = App(
            tenant_id=tenant_id,
            name=f"App {uuid4()}",
            mode=AppMode.ADVANCED_CHAT,
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

    def _create_conversation(self, db_session: Session, app: App) -> Conversation:
        conversation = Conversation(
            app_id=app.id,
            mode=app.mode,
            name=f"Conversation {uuid4()}",
            summary="",
            inputs={},
            introduction="",
            system_instruction="",
            system_instruction_tokens=0,
            status="normal",
            invoke_from=InvokeFrom.WEB_APP,
            from_source=ConversationFromSource.API,
            dialogue_count=0,
            is_deleted=False,
        )
        conversation.inputs = {}
        db_session.add(conversation)
        db_session.flush()
        return conversation

    def _create_workflow(self, db_session: Session, app: App, created_by: str) -> Workflow:
        workflow = Workflow(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.CHAT,
            version="draft",
            graph="{}",
            created_by=created_by,
        )
        workflow._features = "{}"
        db_session.add(workflow)
        db_session.flush()
        return workflow

    def _create_workflow_run(
        self, db_session: Session, app: App, workflow: Workflow, status: WorkflowExecutionStatus, created_by: str
    ) -> WorkflowRun:
        run = WorkflowRun(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            type=WorkflowType.CHAT,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="draft",
            status=status,
            created_by_role="account",
            created_by=created_by,
        )
        db_session.add(run)
        db_session.flush()
        return run

    def _create_message(
        self, db_session: Session, app: App, conversation: Conversation, workflow_run_id: str | None = None
    ) -> Message:
        message = Message(
            app_id=app.id,
            conversation_id=conversation.id,
            _inputs={},
            query="Test query",
            message={"role": "user", "content": "Test query"},
            answer="Test answer",
            model_provider="openai",
            model_id="gpt-4",
            message_tokens=10,
            message_unit_price=0,
            answer_tokens=10,
            answer_unit_price=0,
            total_price=0,
            currency="USD",
            from_source=ConversationFromSource.API,
            invoke_from=InvokeFrom.WEB_APP,
            workflow_run_id=workflow_run_id,
        )
        db_session.add(message)
        db_session.flush()
        return message

    def test_status_count_returns_none_when_no_messages(self, db_session_with_containers: Session) -> None:
        """status_count returns None when conversation has no messages with workflow_run_id."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        app = self._create_app(db_session_with_containers, tenant_id, created_by)
        conversation = self._create_conversation(db_session_with_containers, app)

        result = conversation.status_count

        assert result is None

    def test_status_count_returns_none_when_messages_have_no_workflow_run_id(
        self, db_session_with_containers: Session
    ) -> None:
        """status_count returns None when messages exist but none have workflow_run_id."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        app = self._create_app(db_session_with_containers, tenant_id, created_by)
        conversation = self._create_conversation(db_session_with_containers, app)
        self._create_message(db_session_with_containers, app, conversation, workflow_run_id=None)

        result = conversation.status_count

        assert result is None

    def test_status_count_counts_succeeded_workflow_run(self, db_session_with_containers: Session) -> None:
        """status_count correctly counts succeeded workflow runs."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        app = self._create_app(db_session_with_containers, tenant_id, created_by)
        conversation = self._create_conversation(db_session_with_containers, app)
        workflow = self._create_workflow(db_session_with_containers, app, created_by)
        run = self._create_workflow_run(
            db_session_with_containers, app, workflow, WorkflowExecutionStatus.SUCCEEDED, created_by
        )
        self._create_message(db_session_with_containers, app, conversation, workflow_run_id=run.id)

        result = conversation.status_count

        assert result is not None
        assert result["success"] == 1
        assert result["failed"] == 0
        assert result["partial_success"] == 0
        assert result["paused"] == 0

    def test_status_count_counts_failed_workflow_run(self, db_session_with_containers: Session) -> None:
        """status_count correctly counts failed workflow runs."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        app = self._create_app(db_session_with_containers, tenant_id, created_by)
        conversation = self._create_conversation(db_session_with_containers, app)
        workflow = self._create_workflow(db_session_with_containers, app, created_by)
        run = self._create_workflow_run(
            db_session_with_containers, app, workflow, WorkflowExecutionStatus.FAILED, created_by
        )
        self._create_message(db_session_with_containers, app, conversation, workflow_run_id=run.id)

        result = conversation.status_count

        assert result is not None
        assert result["success"] == 0
        assert result["failed"] == 1
        assert result["partial_success"] == 0
        assert result["paused"] == 0

    def test_status_count_counts_paused_workflow_run(self, db_session_with_containers: Session) -> None:
        """status_count correctly counts paused workflow runs."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        app = self._create_app(db_session_with_containers, tenant_id, created_by)
        conversation = self._create_conversation(db_session_with_containers, app)
        workflow = self._create_workflow(db_session_with_containers, app, created_by)
        run = self._create_workflow_run(
            db_session_with_containers, app, workflow, WorkflowExecutionStatus.PAUSED, created_by
        )
        self._create_message(db_session_with_containers, app, conversation, workflow_run_id=run.id)

        result = conversation.status_count

        assert result is not None
        assert result["success"] == 0
        assert result["failed"] == 0
        assert result["partial_success"] == 0
        assert result["paused"] == 1

    def test_status_count_multiple_statuses(self, db_session_with_containers: Session) -> None:
        """status_count counts multiple workflow runs with different statuses."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        app = self._create_app(db_session_with_containers, tenant_id, created_by)
        conversation = self._create_conversation(db_session_with_containers, app)
        workflow = self._create_workflow(db_session_with_containers, app, created_by)

        for status in [
            WorkflowExecutionStatus.SUCCEEDED,
            WorkflowExecutionStatus.FAILED,
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
            WorkflowExecutionStatus.PAUSED,
        ]:
            run = self._create_workflow_run(db_session_with_containers, app, workflow, status, created_by)
            self._create_message(db_session_with_containers, app, conversation, workflow_run_id=run.id)

        result = conversation.status_count

        assert result is not None
        assert result["success"] == 1
        assert result["failed"] == 1
        assert result["partial_success"] == 1
        assert result["paused"] == 1

    def test_status_count_filters_workflow_runs_by_app_id(self, db_session_with_containers: Session) -> None:
        """status_count excludes workflow runs belonging to a different app."""
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        app = self._create_app(db_session_with_containers, tenant_id, created_by)
        other_app = self._create_app(db_session_with_containers, tenant_id, created_by)
        conversation = self._create_conversation(db_session_with_containers, app)
        workflow = self._create_workflow(db_session_with_containers, other_app, created_by)

        # Workflow run belongs to other_app, not app
        other_run = self._create_workflow_run(
            db_session_with_containers, other_app, workflow, WorkflowExecutionStatus.SUCCEEDED, created_by
        )
        # Message references that run but is in a conversation under app
        self._create_message(db_session_with_containers, app, conversation, workflow_run_id=other_run.id)

        result = conversation.status_count

        # The run should be excluded because app_id filter doesn't match
        assert result is not None
        assert result["success"] == 0


class TestSiteGenerateCode:
    """Integration tests for Site.generate_code static method."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        """Automatically rollback session changes after each test."""
        yield
        db_session_with_containers.rollback()

    def test_generate_code_returns_string_of_correct_length(self, db_session_with_containers: Session) -> None:
        """Site.generate_code returns a code string of the requested length."""
        code = Site.generate_code(8)

        assert isinstance(code, str)
        assert len(code) == 8

    def test_generate_code_avoids_duplicates(self, db_session_with_containers: Session) -> None:
        """Site.generate_code returns a code not already in use."""
        tenant_id = str(uuid4())
        app = App(
            tenant_id=tenant_id,
            name="Test App",
            mode=AppMode.CHAT,
            enable_site=True,
            enable_api=False,
            is_demo=False,
            is_public=False,
            is_universal=False,
            created_by=str(uuid4()),
            updated_by=str(uuid4()),
        )
        db_session_with_containers.add(app)
        db_session_with_containers.flush()

        site = Site(
            app_id=app.id,
            title="Test Site",
            default_language="en-US",
            customize_token_strategy="not_allow",
        )
        # Set an explicit code so generate_code must avoid it
        site.code = "AAAAAAAA"
        db_session_with_containers.add(site)
        db_session_with_containers.flush()

        code = Site.generate_code(8)

        assert isinstance(code, str)
        assert len(code) == 8
        assert code != site.code
