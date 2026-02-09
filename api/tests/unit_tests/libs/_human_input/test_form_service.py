"""
Unit tests for FormService.
"""

from datetime import datetime, timedelta

import pytest

from core.workflow.nodes.human_input.entities import (
    FormInput,
    UserAction,
)
from core.workflow.nodes.human_input.enums import (
    FormInputType,
    TimeoutUnit,
)
from libs.datetime_utils import naive_utc_now

from .support import (
    FormAlreadySubmittedError,
    FormExpiredError,
    FormNotFoundError,
    FormService,
    FormSubmissionData,
    InMemoryFormRepository,
    InvalidFormDataError,
)


class TestFormService:
    """Test FormService functionality."""

    @pytest.fixture
    def repository(self):
        """Create in-memory repository for testing."""
        return InMemoryFormRepository()

    @pytest.fixture
    def form_service(self, repository):
        """Create FormService with in-memory repository."""
        return FormService(repository)

    @pytest.fixture
    def sample_form_data(self):
        """Create sample form data."""
        return {
            "form_id": "form-123",
            "workflow_run_id": "run-456",
            "node_id": "node-789",
            "tenant_id": "tenant-abc",
            "app_id": "app-def",
            "form_content": "# Test Form\n\nInput: {{#$output.input#}}",
            "inputs": [FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="input", default=None)],
            "user_actions": [UserAction(id="submit", title="Submit")],
            "timeout": 1,
            "timeout_unit": TimeoutUnit.HOUR,
            "form_token": "token-xyz",
        }

    def test_create_form(self, form_service, sample_form_data):
        """Test form creation."""
        form = form_service.create_form(**sample_form_data)

        assert form.form_id == "form-123"
        assert form.workflow_run_id == "run-456"
        assert form.node_id == "node-789"
        assert form.tenant_id == "tenant-abc"
        assert form.app_id == "app-def"
        assert form.form_token == "token-xyz"
        assert form.timeout == 1
        assert form.timeout_unit == TimeoutUnit.HOUR
        assert form.expires_at is not None
        assert not form.is_expired
        assert not form.is_submitted

    def test_get_form_by_id(self, form_service, sample_form_data):
        """Test getting form by ID."""
        # Create form first
        created_form = form_service.create_form(**sample_form_data)

        # Retrieve form
        retrieved_form = form_service.get_form_by_id("form-123")

        assert retrieved_form.form_id == created_form.form_id
        assert retrieved_form.workflow_run_id == created_form.workflow_run_id

    def test_get_form_by_id_not_found(self, form_service):
        """Test getting non-existent form by ID."""
        with pytest.raises(FormNotFoundError) as exc_info:
            form_service.get_form_by_id("non-existent-form")

        assert exc_info.value.error_code == "form_not_found"

    def test_get_form_by_token(self, form_service, sample_form_data):
        """Test getting form by token."""
        # Create form first
        created_form = form_service.create_form(**sample_form_data)

        # Retrieve form by token
        retrieved_form = form_service.get_form_by_token("token-xyz")

        assert retrieved_form.form_id == created_form.form_id
        assert retrieved_form.form_token == "token-xyz"

    def test_get_form_by_token_not_found(self, form_service):
        """Test getting non-existent form by token."""
        with pytest.raises(FormNotFoundError) as exc_info:
            form_service.get_form_by_token("non-existent-token")

        assert exc_info.value.error_code == "form_not_found"

    def test_get_form_definition_by_id(self, form_service, sample_form_data):
        """Test getting form definition by ID."""
        # Create form first
        form_service.create_form(**sample_form_data)

        # Get form definition
        definition = form_service.get_form_definition("form-123", is_token=False)

        assert "form_content" in definition
        assert "inputs" in definition
        assert definition["form_content"] == "# Test Form\n\nInput: {{#$output.input#}}"
        assert len(definition["inputs"]) == 1
        assert "site" not in definition  # Should not include site info for ID-based access

    def test_get_form_definition_by_token(self, form_service, sample_form_data):
        """Test getting form definition by token."""
        # Create form first
        form_service.create_form(**sample_form_data)

        # Get form definition
        definition = form_service.get_form_definition("token-xyz", is_token=True)

        assert "form_content" in definition
        assert "inputs" in definition
        assert "site" in definition  # Should include site info for token-based access

    def test_get_form_definition_expired_form(self, form_service, sample_form_data):
        """Test getting definition for expired form."""
        # Create form with past expiry
        form_service.create_form(**sample_form_data)

        # Manually expire the form by modifying expiry time
        form = form_service.get_form_by_id("form-123")
        form.expires_at = datetime.utcnow() - timedelta(hours=1)
        form_service.repository.save(form)

        # Should raise FormExpiredError
        with pytest.raises(FormExpiredError) as exc_info:
            form_service.get_form_definition("form-123", is_token=False)

        assert exc_info.value.error_code == "human_input_form_expired"

    def test_get_form_definition_submitted_form(self, form_service, sample_form_data):
        """Test getting definition for already submitted form."""
        # Create form first
        form_service.create_form(**sample_form_data)

        # Submit the form
        submission_data = FormSubmissionData(form_id="form-123", inputs={"input": "test value"}, action="submit")
        form_service.submit_form("form-123", submission_data, is_token=False)

        # Should raise FormAlreadySubmittedError
        with pytest.raises(FormAlreadySubmittedError) as exc_info:
            form_service.get_form_definition("form-123", is_token=False)

        assert exc_info.value.error_code == "human_input_form_submitted"

    def test_submit_form_success(self, form_service, sample_form_data):
        """Test successful form submission."""
        # Create form first
        form_service.create_form(**sample_form_data)

        # Submit form
        submission_data = FormSubmissionData(form_id="form-123", inputs={"input": "test value"}, action="submit")

        # Should not raise any exception
        form_service.submit_form("form-123", submission_data, is_token=False)

        # Verify form is marked as submitted
        form = form_service.get_form_by_id("form-123")
        assert form.is_submitted
        assert form.submitted_data == {"input": "test value"}
        assert form.submitted_action == "submit"
        assert form.submitted_at is not None

    def test_submit_form_missing_inputs(self, form_service, sample_form_data):
        """Test form submission with missing inputs."""
        # Create form first
        form_service.create_form(**sample_form_data)

        # Submit form with missing required input
        submission_data = FormSubmissionData(
            form_id="form-123",
            inputs={},  # Missing required "input" field
            action="submit",
        )

        with pytest.raises(InvalidFormDataError) as exc_info:
            form_service.submit_form("form-123", submission_data, is_token=False)

        assert "Missing required inputs" in exc_info.value.message
        assert "input" in exc_info.value.message

    def test_submit_form_invalid_action(self, form_service, sample_form_data):
        """Test form submission with invalid action."""
        # Create form first
        form_service.create_form(**sample_form_data)

        # Submit form with invalid action
        submission_data = FormSubmissionData(
            form_id="form-123",
            inputs={"input": "test value"},
            action="invalid_action",  # Not in the allowed actions
        )

        with pytest.raises(InvalidFormDataError) as exc_info:
            form_service.submit_form("form-123", submission_data, is_token=False)

        assert "Invalid action" in exc_info.value.message
        assert "invalid_action" in exc_info.value.message

    def test_submit_form_expired(self, form_service, sample_form_data):
        """Test submitting expired form."""
        # Create form first
        form_service.create_form(**sample_form_data)

        # Manually expire the form
        form = form_service.get_form_by_id("form-123")
        form.expires_at = datetime.utcnow() - timedelta(hours=1)
        form_service.repository.save(form)

        # Try to submit expired form
        submission_data = FormSubmissionData(form_id="form-123", inputs={"input": "test value"}, action="submit")

        with pytest.raises(FormExpiredError) as exc_info:
            form_service.submit_form("form-123", submission_data, is_token=False)

        assert exc_info.value.error_code == "human_input_form_expired"

    def test_submit_form_already_submitted(self, form_service, sample_form_data):
        """Test submitting form that's already submitted."""
        # Create and submit form first
        form_service.create_form(**sample_form_data)

        submission_data = FormSubmissionData(form_id="form-123", inputs={"input": "first submission"}, action="submit")
        form_service.submit_form("form-123", submission_data, is_token=False)

        # Try to submit again
        second_submission = FormSubmissionData(
            form_id="form-123", inputs={"input": "second submission"}, action="submit"
        )

        with pytest.raises(FormAlreadySubmittedError) as exc_info:
            form_service.submit_form("form-123", second_submission, is_token=False)

        assert exc_info.value.error_code == "human_input_form_submitted"

    def test_cleanup_expired_forms(self, form_service, sample_form_data):
        """Test cleanup of expired forms."""
        # Create multiple forms
        for i in range(3):
            data = sample_form_data.copy()
            data["form_id"] = f"form-{i}"
            data["form_token"] = f"token-{i}"
            form_service.create_form(**data)

        # Manually expire some forms
        for i in range(2):  # Expire first 2 forms
            form = form_service.get_form_by_id(f"form-{i}")
            form.expires_at = naive_utc_now() - timedelta(hours=1)
            form_service.repository.save(form)

        # Clean up expired forms
        cleaned_count = form_service.cleanup_expired_forms()

        assert cleaned_count == 2

        # Verify expired forms are gone
        with pytest.raises(FormNotFoundError):
            form_service.get_form_by_id("form-0")

        with pytest.raises(FormNotFoundError):
            form_service.get_form_by_id("form-1")

        # Verify non-expired form still exists
        form = form_service.get_form_by_id("form-2")
        assert form.form_id == "form-2"


class TestFormValidation:
    """Test form validation logic."""

    def test_validate_submission_with_extra_inputs(self):
        """Test validation allows extra inputs that aren't defined in form."""
        repository = InMemoryFormRepository()
        form_service = FormService(repository)

        # Create form with one input
        form_data = {
            "form_id": "form-123",
            "workflow_run_id": "run-456",
            "node_id": "node-789",
            "tenant_id": "tenant-abc",
            "app_id": "app-def",
            "form_content": "Test form",
            "inputs": [FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="required_input", default=None)],
            "user_actions": [UserAction(id="submit", title="Submit")],
            "timeout": 1,
            "timeout_unit": TimeoutUnit.HOUR,
        }

        form_service.create_form(**form_data)

        # Submit with extra input (should be allowed)
        submission_data = FormSubmissionData(
            form_id="form-123",
            inputs={
                "required_input": "value1",
                "extra_input": "value2",  # Extra input not defined in form
            },
            action="submit",
        )

        # Should not raise any exception
        form_service.submit_form("form-123", submission_data, is_token=False)
