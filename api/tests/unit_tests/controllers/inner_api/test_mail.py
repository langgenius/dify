"""
Unit tests for inner_api mail module
"""

from unittest.mock import patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.inner_api.mail import (
    BaseMail,
    BillingMail,
    EnterpriseMail,
    InnerMailPayload,
)


class TestInnerMailPayload:
    """Test InnerMailPayload Pydantic model"""

    def test_valid_payload_with_all_fields(self):
        """Test valid payload with all fields passes validation"""
        data = {
            "to": ["test@example.com"],
            "subject": "Test Subject",
            "body": "Test Body",
            "substitutions": {"key": "value"},
        }
        payload = InnerMailPayload.model_validate(data)
        assert payload.to == ["test@example.com"]
        assert payload.subject == "Test Subject"
        assert payload.body == "Test Body"
        assert payload.substitutions == {"key": "value"}

    def test_valid_payload_without_substitutions(self):
        """Test valid payload without optional substitutions"""
        data = {
            "to": ["test@example.com"],
            "subject": "Test Subject",
            "body": "Test Body",
        }
        payload = InnerMailPayload.model_validate(data)
        assert payload.to == ["test@example.com"]
        assert payload.subject == "Test Subject"
        assert payload.body == "Test Body"
        assert payload.substitutions is None

    def test_empty_to_list_fails_validation(self):
        """Test that empty 'to' list fails validation due to min_length=1"""
        data = {
            "to": [],
            "subject": "Test Subject",
            "body": "Test Body",
        }
        with pytest.raises(ValidationError):
            InnerMailPayload.model_validate(data)

    def test_multiple_recipients_allowed(self):
        """Test that multiple recipients are allowed"""
        data = {
            "to": ["user1@example.com", "user2@example.com"],
            "subject": "Test Subject",
            "body": "Test Body",
        }
        payload = InnerMailPayload.model_validate(data)
        assert len(payload.to) == 2
        assert "user1@example.com" in payload.to
        assert "user2@example.com" in payload.to

    def test_missing_to_field_fails_validation(self):
        """Test that missing 'to' field fails validation"""
        data = {
            "subject": "Test Subject",
            "body": "Test Body",
        }
        with pytest.raises(ValidationError):
            InnerMailPayload.model_validate(data)

    def test_missing_subject_fails_validation(self):
        """Test that missing 'subject' field fails validation"""
        data = {
            "to": ["test@example.com"],
            "body": "Test Body",
        }
        with pytest.raises(ValidationError):
            InnerMailPayload.model_validate(data)

    def test_missing_body_fails_validation(self):
        """Test that missing 'body' field fails validation"""
        data = {
            "to": ["test@example.com"],
            "subject": "Test Subject",
        }
        with pytest.raises(ValidationError):
            InnerMailPayload.model_validate(data)


class TestBaseMail:
    """Test BaseMail API endpoint"""

    @pytest.fixture
    def api_instance(self):
        """Create BaseMail API instance"""
        return BaseMail()

    @patch("controllers.inner_api.mail.send_inner_email_task")
    def test_post_sends_email_task(self, mock_task, api_instance, app: Flask):
        """Test that POST sends inner email task"""
        # Arrange
        mock_task.delay.return_value = None

        # Act
        with app.test_request_context(
            json={
                "to": ["test@example.com"],
                "subject": "Test Subject",
                "body": "Test Body",
            }
        ):
            with patch("controllers.inner_api.mail.inner_api_ns") as mock_ns:
                mock_ns.payload = {
                    "to": ["test@example.com"],
                    "subject": "Test Subject",
                    "body": "Test Body",
                }
                result = api_instance.post()

        # Assert
        assert result == ({"message": "success"}, 200)
        mock_task.delay.assert_called_once_with(
            to=["test@example.com"],
            subject="Test Subject",
            body="Test Body",
            substitutions=None,
        )

    @patch("controllers.inner_api.mail.send_inner_email_task")
    def test_post_with_substitutions(self, mock_task, api_instance, app: Flask):
        """Test that POST sends email with substitutions"""
        # Arrange
        mock_task.delay.return_value = None

        # Act
        with app.test_request_context():
            with patch("controllers.inner_api.mail.inner_api_ns") as mock_ns:
                mock_ns.payload = {
                    "to": ["test@example.com"],
                    "subject": "Hello {{name}}",
                    "body": "Welcome {{name}}!",
                    "substitutions": {"name": "John"},
                }
                result = api_instance.post()

        # Assert
        assert result == ({"message": "success"}, 200)
        mock_task.delay.assert_called_once_with(
            to=["test@example.com"],
            subject="Hello {{name}}",
            body="Welcome {{name}}!",
            substitutions={"name": "John"},
        )


class TestEnterpriseMail:
    """Test EnterpriseMail API endpoint"""

    @pytest.fixture
    def api_instance(self):
        """Create EnterpriseMail API instance"""
        return EnterpriseMail()

    def test_has_enterprise_inner_api_only_decorator(self, api_instance):
        """Test that EnterpriseMail has enterprise_inner_api_only decorator"""
        # Check method_decorators
        from controllers.inner_api.wraps import enterprise_inner_api_only

        assert enterprise_inner_api_only in api_instance.method_decorators

    def test_has_setup_required_decorator(self, api_instance):
        """Test that EnterpriseMail has setup_required decorator"""
        # Check by decorator name instead of object reference
        decorator_names = [d.__name__ for d in api_instance.method_decorators]
        assert "setup_required" in decorator_names


class TestBillingMail:
    """Test BillingMail API endpoint"""

    @pytest.fixture
    def api_instance(self):
        """Create BillingMail API instance"""
        return BillingMail()

    def test_has_billing_inner_api_only_decorator(self, api_instance):
        """Test that BillingMail has billing_inner_api_only decorator"""
        # Check method_decorators
        from controllers.inner_api.wraps import billing_inner_api_only

        assert billing_inner_api_only in api_instance.method_decorators

    def test_has_setup_required_decorator(self, api_instance):
        """Test that BillingMail has setup_required decorator"""
        # Check by decorator name instead of object reference
        decorator_names = [d.__name__ for d in api_instance.method_decorators]
        assert "setup_required" in decorator_names
