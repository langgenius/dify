"""
Unit tests for human input form models.
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

from .support import FormSubmissionData, FormSubmissionRequest, HumanInputForm


class TestHumanInputForm:
    """Test HumanInputForm model."""

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
            "timeout": 2,
            "timeout_unit": TimeoutUnit.HOUR,
            "form_token": "token-xyz",
        }

    def test_form_creation(self, sample_form_data):
        """Test form creation."""
        form = HumanInputForm(**sample_form_data)

        assert form.form_id == "form-123"
        assert form.workflow_run_id == "run-456"
        assert form.node_id == "node-789"
        assert form.tenant_id == "tenant-abc"
        assert form.app_id == "app-def"
        assert form.form_token == "token-xyz"
        assert form.timeout == 2
        assert form.timeout_unit == TimeoutUnit.HOUR
        assert form.created_at is not None
        assert form.expires_at is not None
        assert form.submitted_at is None
        assert form.submitted_data is None
        assert form.submitted_action is None

    def test_form_expiry_calculation_hours(self, sample_form_data):
        """Test form expiry calculation for hours."""
        form = HumanInputForm(**sample_form_data)

        # Should expire 2 hours after creation
        expected_expiry = form.created_at + timedelta(hours=2)
        assert abs((form.expires_at - expected_expiry).total_seconds()) < 1  # Within 1 second

    def test_form_expiry_calculation_days(self, sample_form_data):
        """Test form expiry calculation for days."""
        sample_form_data["timeout"] = 3
        sample_form_data["timeout_unit"] = TimeoutUnit.DAY

        form = HumanInputForm(**sample_form_data)

        # Should expire 3 days after creation
        expected_expiry = form.created_at + timedelta(days=3)
        assert abs((form.expires_at - expected_expiry).total_seconds()) < 1  # Within 1 second

    def test_form_expiry_property_not_expired(self, sample_form_data):
        """Test is_expired property for non-expired form."""
        form = HumanInputForm(**sample_form_data)
        assert not form.is_expired

    def test_form_expiry_property_expired(self, sample_form_data):
        """Test is_expired property for expired form."""
        # Create form with past expiry
        past_time = datetime.utcnow() - timedelta(hours=1)
        sample_form_data["created_at"] = past_time

        form = HumanInputForm(**sample_form_data)
        # Manually set expiry to past time
        form.expires_at = past_time

        assert form.is_expired

    def test_form_submission_property_not_submitted(self, sample_form_data):
        """Test is_submitted property for non-submitted form."""
        form = HumanInputForm(**sample_form_data)
        assert not form.is_submitted

    def test_form_submission_property_submitted(self, sample_form_data):
        """Test is_submitted property for submitted form."""
        form = HumanInputForm(**sample_form_data)
        form.submit({"input": "test value"}, "submit")

        assert form.is_submitted
        assert form.submitted_at is not None
        assert form.submitted_data == {"input": "test value"}
        assert form.submitted_action == "submit"

    def test_form_submit_method(self, sample_form_data):
        """Test form submit method."""
        form = HumanInputForm(**sample_form_data)

        submission_time_before = datetime.utcnow()
        form.submit({"input": "test value"}, "submit")
        submission_time_after = datetime.utcnow()

        assert form.is_submitted
        assert form.submitted_data == {"input": "test value"}
        assert form.submitted_action == "submit"
        assert submission_time_before <= form.submitted_at <= submission_time_after

    def test_form_to_response_dict_without_site_info(self, sample_form_data):
        """Test converting form to response dict without site info."""
        form = HumanInputForm(**sample_form_data)

        response = form.to_response_dict(include_site_info=False)

        assert "form_content" in response
        assert "inputs" in response
        assert "site" not in response
        assert response["form_content"] == "# Test Form\n\nInput: {{#$output.input#}}"
        assert len(response["inputs"]) == 1
        assert response["inputs"][0]["type"] == "text-input"
        assert response["inputs"][0]["output_variable_name"] == "input"

    def test_form_to_response_dict_with_site_info(self, sample_form_data):
        """Test converting form to response dict with site info."""
        form = HumanInputForm(**sample_form_data)

        response = form.to_response_dict(include_site_info=True)

        assert "form_content" in response
        assert "inputs" in response
        assert "site" in response
        assert response["site"]["app_id"] == "app-def"
        assert response["site"]["title"] == "Workflow Form"

    def test_form_without_web_app_token(self, sample_form_data):
        """Test form creation without web app token."""
        sample_form_data["form_token"] = None

        form = HumanInputForm(**sample_form_data)

        assert form.form_token is None
        assert form.form_id == "form-123"  # Other fields should still work

    def test_form_with_explicit_timestamps(self):
        """Test form creation with explicit timestamps."""
        created_time = datetime(2024, 1, 15, 10, 30, 0)
        expires_time = datetime(2024, 1, 15, 12, 30, 0)

        form = HumanInputForm(
            form_id="form-123",
            workflow_run_id="run-456",
            node_id="node-789",
            tenant_id="tenant-abc",
            app_id="app-def",
            form_content="Test content",
            inputs=[],
            user_actions=[],
            timeout=2,
            timeout_unit=TimeoutUnit.HOUR,
            created_at=created_time,
            expires_at=expires_time,
        )

        assert form.created_at == created_time
        assert form.expires_at == expires_time


class TestFormSubmissionData:
    """Test FormSubmissionData model."""

    def test_submission_data_creation(self):
        """Test submission data creation."""
        submission_data = FormSubmissionData(
            form_id="form-123", inputs={"field1": "value1", "field2": "value2"}, action="submit"
        )

        assert submission_data.form_id == "form-123"
        assert submission_data.inputs == {"field1": "value1", "field2": "value2"}
        assert submission_data.action == "submit"
        assert submission_data.submitted_at is not None

    def test_submission_data_from_request(self):
        """Test creating submission data from API request."""
        request = FormSubmissionRequest(inputs={"input": "test value"}, action="confirm")

        submission_data = FormSubmissionData.from_request("form-456", request)

        assert submission_data.form_id == "form-456"
        assert submission_data.inputs == {"input": "test value"}
        assert submission_data.action == "confirm"
        assert submission_data.submitted_at is not None

    def test_submission_data_with_empty_inputs(self):
        """Test submission data with empty inputs."""
        submission_data = FormSubmissionData(form_id="form-123", inputs={}, action="cancel")

        assert submission_data.inputs == {}
        assert submission_data.action == "cancel"

    def test_submission_data_timestamps(self):
        """Test submission data timestamp handling."""
        before_time = datetime.utcnow()

        submission_data = FormSubmissionData(form_id="form-123", inputs={"test": "value"}, action="submit")

        after_time = datetime.utcnow()

        assert before_time <= submission_data.submitted_at <= after_time

    def test_submission_data_with_explicit_timestamp(self):
        """Test submission data with explicit timestamp."""
        specific_time = datetime(2024, 1, 15, 14, 30, 0)

        submission_data = FormSubmissionData(
            form_id="form-123", inputs={"test": "value"}, action="submit", submitted_at=specific_time
        )

        assert submission_data.submitted_at == specific_time
