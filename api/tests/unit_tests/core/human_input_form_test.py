"""
Tests for HumanInputForm domain model and repository.
"""

import json
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from core.repositories.sqlalchemy_human_input_form_repository import SQLAlchemyHumanInputFormRepository
from core.workflow.entities.human_input_form import HumanInputForm, HumanInputFormStatus


class TestHumanInputForm:
    """Test cases for HumanInputForm domain model."""

    def test_create_form(self):
        """Test creating a new form."""
        form = HumanInputForm.create(
            id_="test-form-id",
            workflow_run_id="test-workflow-run",
            form_definition={"inputs": [], "user_actions": [{"id": "submit", "title": "Submit"}]},
            rendered_content="<form>Test form</form>",
        )

        assert form.id_ == "test-form-id"
        assert form.workflow_run_id == "test-workflow-run"
        assert form.status == HumanInputFormStatus.WAITING
        assert form.can_be_submitted
        assert not form.is_submitted
        assert not form.is_expired
        assert form.is_waiting

    def test_submit_form(self):
        """Test submitting a form."""
        form = HumanInputForm.create(
            id_="test-form-id",
            workflow_run_id="test-workflow-run",
            form_definition={"inputs": [], "user_actions": [{"id": "submit", "title": "Submit"}]},
            rendered_content="<form>Test form</form>",
        )

        form.submit(
            data={"field1": "value1"},
            action="submit",
            submission_user_id="user123",
        )

        assert form.is_submitted
        assert not form.can_be_submitted
        assert form.status == HumanInputFormStatus.SUBMITTED
        assert form.submission is not None
        assert form.submission.data == {"field1": "value1"}
        assert form.submission.action == "submit"
        assert form.submission.submission_user_id == "user123"

    def test_submit_form_invalid_action(self):
        """Test submitting a form with invalid action."""
        form = HumanInputForm.create(
            id_="test-form-id",
            workflow_run_id="test-workflow-run",
            form_definition={"inputs": [], "user_actions": [{"id": "submit", "title": "Submit"}]},
            rendered_content="<form>Test form</form>",
        )

        with pytest.raises(ValueError, match="Invalid action: invalid_action"):
            form.submit(data={}, action="invalid_action")

    def test_submit_expired_form(self):
        """Test submitting an expired form should fail."""
        form = HumanInputForm.create(
            id_="test-form-id",
            workflow_run_id="test-workflow-run",
            form_definition={"inputs": [], "user_actions": [{"id": "submit", "title": "Submit"}]},
            rendered_content="<form>Test form</form>",
        )
        form.expire()

        with pytest.raises(ValueError, match="Form cannot be submitted in status: expired"):
            form.submit(data={}, action="submit")

    def test_expire_form(self):
        """Test expiring a form."""
        form = HumanInputForm.create(
            id_="test-form-id",
            workflow_run_id="test-workflow-run",
            form_definition={"inputs": [], "user_actions": [{"id": "submit", "title": "Submit"}]},
            rendered_content="<form>Test form</form>",
        )

        form.expire()
        assert form.is_expired
        assert not form.can_be_submitted
        assert form.status == HumanInputFormStatus.EXPIRED

    def test_expire_already_submitted_form(self):
        """Test expiring an already submitted form should fail."""
        form = HumanInputForm.create(
            id_="test-form-id",
            workflow_run_id="test-workflow-run",
            form_definition={"inputs": [], "user_actions": [{"id": "submit", "title": "Submit"}]},
            rendered_content="<form>Test form</form>",
        )
        form.submit(data={}, action="submit")

        with pytest.raises(ValueError, match="Form cannot be expired in status: submitted"):
            form.expire()

    def test_get_form_definition_for_display(self):
        """Test getting form definition for display."""
        form_definition = {
            "inputs": [{"type": "text", "name": "field1"}],
            "user_actions": [{"id": "submit", "title": "Submit"}],
        }
        form = HumanInputForm.create(
            id_="test-form-id",
            workflow_run_id="test-workflow-run",
            form_definition=form_definition,
            rendered_content="<form>Test form</form>",
        )

        result = form.get_form_definition_for_display()

        assert result["form_content"] == "<form>Test form</form>"
        assert result["inputs"] == form_definition["inputs"]
        assert result["user_actions"] == form_definition["user_actions"]
        assert "site" not in result

    def test_get_form_definition_for_display_with_site_info(self):
        """Test getting form definition for display with site info."""
        form = HumanInputForm.create(
            id_="test-form-id",
            workflow_run_id="test-workflow-run",
            form_definition={"inputs": [], "user_actions": []},
            rendered_content="<form>Test form</form>",
        )

        result = form.get_form_definition_for_display(include_site_info=True)

        assert "site" in result
        assert result["site"]["title"] == "Workflow Form"

    def test_get_form_definition_expired_form(self):
        """Test getting form definition for expired form should fail."""
        form = HumanInputForm.create(
            id_="test-form-id",
            workflow_run_id="test-workflow-run",
            form_definition={"inputs": [], "user_actions": []},
            rendered_content="<form>Test form</form>",
        )
        form.expire()

        with pytest.raises(ValueError, match="Form has expired"):
            form.get_form_definition_for_display()

    def test_get_form_definition_submitted_form(self):
        """Test getting form definition for submitted form should fail."""
        form = HumanInputForm.create(
            id_="test-form-id",
            workflow_run_id="test-workflow-run",
            form_definition={"inputs": [], "user_actions": [{"id": "submit", "title": "Submit"}]},
            rendered_content="<form>Test form</form>",
        )
        form.submit(data={}, action="submit")

        with pytest.raises(ValueError, match="Form has already been submitted"):
            form.get_form_definition_for_display()


class TestSQLAlchemyHumanInputFormRepository:
    """Test cases for SQLAlchemyHumanInputFormRepository."""

    @pytest.fixture
    def mock_session_factory(self):
        """Create a mock session factory."""
        session = MagicMock()
        session_factory = MagicMock()
        session_factory.return_value.__enter__.return_value = session
        session_factory.return_value.__exit__.return_value = None
        return session_factory

    @pytest.fixture
    def mock_user(self):
        """Create a mock user."""
        user = MagicMock()
        user.current_tenant_id = "test-tenant-id"
        user.id = "test-user-id"
        return user

    @pytest.fixture
    def repository(self, mock_session_factory, mock_user):
        """Create a repository instance."""
        return SQLAlchemyHumanInputFormRepository(
            session_factory=mock_session_factory,
            user=mock_user,
            app_id="test-app-id",
        )

    def test_to_domain_model(self, repository):
        """Test converting DB model to domain model."""
        from models.human_input import (
            HumanInputForm as DBForm,
        )
        from models.human_input import (
            HumanInputFormStatus as DBStatus,
        )
        from models.human_input import (
            HumanInputSubmissionType as DBSubmissionType,
        )

        db_form = DBForm()
        db_form.id = "test-id"
        db_form.workflow_run_id = "test-workflow"
        db_form.form_definition = json.dumps({"inputs": [], "user_actions": []})
        db_form.rendered_content = "<form>Test</form>"
        db_form.status = DBStatus.WAITING
        db_form.web_app_token = "test-token"
        db_form.created_at = datetime.utcnow()
        db_form.submitted_data = json.dumps({"field": "value"})
        db_form.submitted_at = datetime.utcnow()
        db_form.submission_type = DBSubmissionType.web_form
        db_form.submission_user_id = "user123"

        domain_form = repository._to_domain_model(db_form)

        assert domain_form.id_ == "test-id"
        assert domain_form.workflow_run_id == "test-workflow"
        assert domain_form.form_definition == {"inputs": [], "user_actions": []}
        assert domain_form.rendered_content == "<form>Test</form>"
        assert domain_form.status == HumanInputFormStatus.WAITING
        assert domain_form.web_app_token == "test-token"
        assert domain_form.submission is not None
        assert domain_form.submission.data == {"field": "value"}
        assert domain_form.submission.submission_user_id == "user123"

    def test_to_db_model(self, repository):
        """Test converting domain model to DB model."""
        from models.human_input import (
            HumanInputFormStatus as DBStatus,
        )

        domain_form = HumanInputForm.create(
            id_="test-id",
            workflow_run_id="test-workflow",
            form_definition={"inputs": [], "user_actions": []},
            rendered_content="<form>Test</form>",
            web_app_token="test-token",
        )

        db_form = repository._to_db_model(domain_form)

        assert db_form.id == "test-id"
        assert db_form.tenant_id == "test-tenant-id"
        assert db_form.app_id == "test-app-id"
        assert db_form.workflow_run_id == "test-workflow"
        assert json.loads(db_form.form_definition) == {"inputs": [], "user_actions": []}
        assert db_form.rendered_content == "<form>Test</form>"
        assert db_form.status == DBStatus.WAITING
        assert db_form.web_app_token == "test-token"

    def test_save(self, repository, mock_session_factory):
        """Test saving a form."""
        session = mock_session_factory.return_value.__enter__.return_value
        domain_form = HumanInputForm.create(
            id_="test-id",
            workflow_run_id="test-workflow",
            form_definition={"inputs": []},
            rendered_content="<form>Test</form>",
        )

        repository.save(domain_form)

        session.merge.assert_called_once()
        session.commit.assert_called_once()

    def test_get_by_id(self, repository, mock_session_factory):
        """Test getting a form by ID."""
        session = mock_session_factory.return_value.__enter__.return_value
        mock_db_form = MagicMock()
        mock_db_form.id = "test-id"
        session.scalar.return_value = mock_db_form

        with patch.object(repository, "_to_domain_model") as mock_convert:
            domain_form = HumanInputForm.create(
                id_="test-id",
                workflow_run_id="test-workflow",
                form_definition={"inputs": []},
                rendered_content="<form>Test</form>",
            )
            mock_convert.return_value = domain_form

            result = repository.get_by_id("test-id")

            assert result == domain_form
            session.scalar.assert_called_once()
            mock_convert.assert_called_once_with(mock_db_form)

    def test_get_by_id_not_found(self, repository, mock_session_factory):
        """Test getting a non-existent form by ID."""
        session = mock_session_factory.return_value.__enter__.return_value
        session.scalar.return_value = None

        with pytest.raises(ValueError, match="Human input form not found: test-id"):
            repository.get_by_id("test-id")

    def test_mark_expired_forms(self, repository, mock_session_factory):
        """Test marking expired forms."""
        session = mock_session_factory.return_value.__enter__.return_value
        mock_forms = [MagicMock(), MagicMock(), MagicMock()]
        session.scalars.return_value.all.return_value = mock_forms

        result = repository.mark_expired_forms(expiry_hours=24)

        assert result == 3
        for form in mock_forms:
            assert hasattr(form, "status")
        session.commit.assert_called_once()
