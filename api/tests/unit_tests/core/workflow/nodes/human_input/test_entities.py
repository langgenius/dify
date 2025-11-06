"""
Unit tests for human input node entities.
"""

import pytest
from pydantic import ValidationError

from core.workflow.nodes.human_input.entities import (
    ButtonStyle,
    DeliveryMethod,
    DeliveryMethodType,
    EmailDeliveryConfig,
    EmailRecipients,
    ExternalRecipient,
    FormInput,
    FormInputPlaceholder,
    FormInputType,
    HumanInputNodeData,
    MemberRecipient,
    PlaceholderType,
    RecipientType,
    TimeoutUnit,
    UserAction,
    WebAppDeliveryConfig,
)


class TestDeliveryMethod:
    """Test DeliveryMethod entity."""

    def test_webapp_delivery_method(self):
        """Test webapp delivery method creation."""
        delivery_method = DeliveryMethod(type=DeliveryMethodType.WEBAPP, enabled=True, config=WebAppDeliveryConfig())

        assert delivery_method.type == DeliveryMethodType.WEBAPP
        assert delivery_method.enabled is True
        assert isinstance(delivery_method.config, WebAppDeliveryConfig)

    def test_email_delivery_method(self):
        """Test email delivery method creation."""
        recipients = EmailRecipients(
            whole_workspace=False,
            items=[
                MemberRecipient(type=RecipientType.MEMBER, user_id="test-user-123"),
                ExternalRecipient(type=RecipientType.EXTERNAL, email="test@example.com"),
            ],
        )

        config = EmailDeliveryConfig(
            recipients=recipients, subject="Test Subject", body="Test body with {{#url#}} placeholder"
        )

        delivery_method = DeliveryMethod(type=DeliveryMethodType.EMAIL, enabled=True, config=config)

        assert delivery_method.type == DeliveryMethodType.EMAIL
        assert delivery_method.enabled is True
        assert isinstance(delivery_method.config, EmailDeliveryConfig)
        assert delivery_method.config.subject == "Test Subject"
        assert len(delivery_method.config.recipients.items) == 2


class TestFormInput:
    """Test FormInput entity."""

    def test_text_input_with_constant_placeholder(self):
        """Test text input with constant placeholder."""
        placeholder = FormInputPlaceholder(type=PlaceholderType.CONSTANT, value="Enter your response here...")

        form_input = FormInput(
            type=FormInputType.TEXT_INPUT, output_variable_name="user_input", placeholder=placeholder
        )

        assert form_input.type == FormInputType.TEXT_INPUT
        assert form_input.output_variable_name == "user_input"
        assert form_input.placeholder.type == PlaceholderType.CONSTANT
        assert form_input.placeholder.value == "Enter your response here..."

    def test_text_input_with_variable_placeholder(self):
        """Test text input with variable placeholder."""
        placeholder = FormInputPlaceholder(type=PlaceholderType.VARIABLE, selector=["node_123", "output_var"])

        form_input = FormInput(
            type=FormInputType.TEXT_INPUT, output_variable_name="user_input", placeholder=placeholder
        )

        assert form_input.placeholder.type == PlaceholderType.VARIABLE
        assert form_input.placeholder.selector == ["node_123", "output_var"]

    def test_form_input_without_placeholder(self):
        """Test form input without placeholder."""
        form_input = FormInput(type=FormInputType.PARAGRAPH, output_variable_name="description")

        assert form_input.type == FormInputType.PARAGRAPH
        assert form_input.output_variable_name == "description"
        assert form_input.placeholder is None


class TestUserAction:
    """Test UserAction entity."""

    def test_user_action_creation(self):
        """Test user action creation."""
        action = UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY)

        assert action.id == "approve"
        assert action.title == "Approve"
        assert action.button_style == ButtonStyle.PRIMARY

    def test_user_action_default_button_style(self):
        """Test user action with default button style."""
        action = UserAction(id="cancel", title="Cancel")

        assert action.button_style == ButtonStyle.DEFAULT


class TestHumanInputNodeData:
    """Test HumanInputNodeData entity."""

    def test_valid_node_data_creation(self):
        """Test creating valid human input node data."""
        delivery_methods = [DeliveryMethod(type=DeliveryMethodType.WEBAPP, enabled=True, config=WebAppDeliveryConfig())]

        inputs = [
            FormInput(
                type=FormInputType.TEXT_INPUT,
                output_variable_name="content",
                placeholder=FormInputPlaceholder(type=PlaceholderType.CONSTANT, value="Enter content..."),
            )
        ]

        user_actions = [UserAction(id="submit", title="Submit", button_style=ButtonStyle.PRIMARY)]

        node_data = HumanInputNodeData(
            title="Human Input Test",
            desc="Test node description",
            delivery_methods=delivery_methods,
            form_content="# Test Form\n\nPlease provide input:\n\n{{#$output.content#}}",
            inputs=inputs,
            user_actions=user_actions,
            timeout=24,
            timeout_unit=TimeoutUnit.HOUR,
        )

        assert node_data.title == "Human Input Test"
        assert node_data.desc == "Test node description"
        assert len(node_data.delivery_methods) == 1
        assert node_data.form_content.startswith("# Test Form")
        assert len(node_data.inputs) == 1
        assert len(node_data.user_actions) == 1
        assert node_data.timeout == 24
        assert node_data.timeout_unit == TimeoutUnit.HOUR

    def test_node_data_with_multiple_delivery_methods(self):
        """Test node data with multiple delivery methods."""
        delivery_methods = [
            DeliveryMethod(type=DeliveryMethodType.WEBAPP, enabled=True, config=WebAppDeliveryConfig()),
            DeliveryMethod(
                type=DeliveryMethodType.EMAIL,
                enabled=False,  # Disabled method should be fine
                config=None,
            ),
        ]

        node_data = HumanInputNodeData(
            title="Test Node", delivery_methods=delivery_methods, timeout=1, timeout_unit=TimeoutUnit.DAY
        )

        assert len(node_data.delivery_methods) == 2
        assert node_data.timeout == 1
        assert node_data.timeout_unit == TimeoutUnit.DAY

    def test_node_data_default_values(self):
        """Test node data with default values."""
        node_data = HumanInputNodeData(title="Test Node")

        assert node_data.title == "Test Node"
        assert node_data.desc is None
        assert node_data.delivery_methods == []
        assert node_data.form_content == ""
        assert node_data.inputs == []
        assert node_data.user_actions == []
        assert node_data.timeout == 36
        assert node_data.timeout_unit == TimeoutUnit.HOUR


class TestRecipients:
    """Test email recipient entities."""

    def test_member_recipient(self):
        """Test member recipient creation."""
        recipient = MemberRecipient(type=RecipientType.MEMBER, user_id="user-123")

        assert recipient.type == RecipientType.MEMBER
        assert recipient.user_id == "user-123"

    def test_external_recipient(self):
        """Test external recipient creation."""
        recipient = ExternalRecipient(type=RecipientType.EXTERNAL, email="test@example.com")

        assert recipient.type == RecipientType.EXTERNAL
        assert recipient.email == "test@example.com"

    def test_email_recipients_whole_workspace(self):
        """Test email recipients with whole workspace enabled."""
        recipients = EmailRecipients(
            whole_workspace=True, items=[MemberRecipient(type=RecipientType.MEMBER, user_id="user-123")]
        )

        assert recipients.whole_workspace is True
        assert len(recipients.items) == 1  # Items are preserved even when whole_workspace is True

    def test_email_recipients_specific_users(self):
        """Test email recipients with specific users."""
        recipients = EmailRecipients(
            whole_workspace=False,
            items=[
                MemberRecipient(type=RecipientType.MEMBER, user_id="user-123"),
                ExternalRecipient(type=RecipientType.EXTERNAL, email="external@example.com"),
            ],
        )

        assert recipients.whole_workspace is False
        assert len(recipients.items) == 2
        assert recipients.items[0].user_id == "user-123"
        assert recipients.items[1].email == "external@example.com"


class TestValidation:
    """Test validation scenarios."""

    def test_invalid_form_input_type(self):
        """Test validation with invalid form input type."""
        with pytest.raises(ValidationError):
            FormInput(
                type="invalid-type",  # Invalid type
                output_variable_name="test",
            )

    def test_invalid_button_style(self):
        """Test validation with invalid button style."""
        with pytest.raises(ValidationError):
            UserAction(
                id="test",
                title="Test",
                button_style="invalid-style",  # Invalid style
            )

    def test_invalid_timeout_unit(self):
        """Test validation with invalid timeout unit."""
        with pytest.raises(ValidationError):
            HumanInputNodeData(
                title="Test",
                timeout_unit="invalid-unit",  # Invalid unit
            )
