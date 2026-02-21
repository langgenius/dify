"""
Unit tests for human input node entities.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from core.workflow.entities import GraphInitParams
from core.workflow.node_events import PauseRequestedEvent
from core.workflow.node_events.node import StreamCompletedEvent
from core.workflow.nodes.human_input.entities import (
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    ExternalRecipient,
    FormInput,
    FormInputDefault,
    HumanInputNodeData,
    MemberRecipient,
    UserAction,
    WebAppDeliveryMethod,
    _WebAppDeliveryConfig,
)
from core.workflow.nodes.human_input.enums import (
    ButtonStyle,
    DeliveryMethodType,
    EmailRecipientType,
    FormInputType,
    PlaceholderType,
    TimeoutUnit,
)
from core.workflow.nodes.human_input.human_input_node import HumanInputNode
from core.workflow.repositories.human_input_form_repository import HumanInputFormRepository
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from tests.unit_tests.core.workflow.graph_engine.human_input_test_utils import InMemoryHumanInputFormRepository


class TestDeliveryMethod:
    """Test DeliveryMethod entity."""

    def test_webapp_delivery_method(self):
        """Test webapp delivery method creation."""
        delivery_method = WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig())

        assert delivery_method.type == DeliveryMethodType.WEBAPP
        assert delivery_method.enabled is True
        assert isinstance(delivery_method.config, _WebAppDeliveryConfig)

    def test_email_delivery_method(self):
        """Test email delivery method creation."""
        recipients = EmailRecipients(
            whole_workspace=False,
            items=[
                MemberRecipient(type=EmailRecipientType.MEMBER, user_id="test-user-123"),
                ExternalRecipient(type=EmailRecipientType.EXTERNAL, email="test@example.com"),
            ],
        )

        config = EmailDeliveryConfig(
            recipients=recipients, subject="Test Subject", body="Test body with {{#url#}} placeholder"
        )

        delivery_method = EmailDeliveryMethod(enabled=True, config=config)

        assert delivery_method.type == DeliveryMethodType.EMAIL
        assert delivery_method.enabled is True
        assert isinstance(delivery_method.config, EmailDeliveryConfig)
        assert delivery_method.config.subject == "Test Subject"
        assert len(delivery_method.config.recipients.items) == 2


class TestFormInput:
    """Test FormInput entity."""

    def test_text_input_with_constant_default(self):
        """Test text input with constant default value."""
        default = FormInputDefault(type=PlaceholderType.CONSTANT, value="Enter your response here...")

        form_input = FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="user_input", default=default)

        assert form_input.type == FormInputType.TEXT_INPUT
        assert form_input.output_variable_name == "user_input"
        assert form_input.default.type == PlaceholderType.CONSTANT
        assert form_input.default.value == "Enter your response here..."

    def test_text_input_with_variable_default(self):
        """Test text input with variable default value."""
        default = FormInputDefault(type=PlaceholderType.VARIABLE, selector=["node_123", "output_var"])

        form_input = FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="user_input", default=default)

        assert form_input.default.type == PlaceholderType.VARIABLE
        assert form_input.default.selector == ["node_123", "output_var"]

    def test_form_input_without_default(self):
        """Test form input without default value."""
        form_input = FormInput(type=FormInputType.PARAGRAPH, output_variable_name="description")

        assert form_input.type == FormInputType.PARAGRAPH
        assert form_input.output_variable_name == "description"
        assert form_input.default is None


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

    def test_user_action_length_boundaries(self):
        """Test user action id and title length boundaries."""
        action = UserAction(id="a" * 20, title="b" * 20)

        assert action.id == "a" * 20
        assert action.title == "b" * 20

    @pytest.mark.parametrize(
        ("field_name", "value"),
        [
            ("id", "a" * 21),
            ("title", "b" * 21),
        ],
    )
    def test_user_action_length_limits(self, field_name: str, value: str):
        """User action fields should enforce max length."""
        data = {"id": "approve", "title": "Approve"}
        data[field_name] = value

        with pytest.raises(ValidationError) as exc_info:
            UserAction(**data)

        errors = exc_info.value.errors()
        assert any(error["loc"] == (field_name,) and error["type"] == "string_too_long" for error in errors)


class TestHumanInputNodeData:
    """Test HumanInputNodeData entity."""

    def test_valid_node_data_creation(self):
        """Test creating valid human input node data."""
        delivery_methods = [WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig())]

        inputs = [
            FormInput(
                type=FormInputType.TEXT_INPUT,
                output_variable_name="content",
                default=FormInputDefault(type=PlaceholderType.CONSTANT, value="Enter content..."),
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
            WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig()),
            EmailDeliveryMethod(
                enabled=False,  # Disabled method should be fine
                config=EmailDeliveryConfig(
                    subject="Hi there", body="", recipients=EmailRecipients(whole_workspace=True)
                ),
            ),
        ]

        node_data = HumanInputNodeData(
            title="Test Node", delivery_methods=delivery_methods, timeout=1, timeout_unit=TimeoutUnit.DAY
        )

        assert len(node_data.delivery_methods) == 2
        assert node_data.timeout == 1
        assert node_data.timeout_unit == TimeoutUnit.DAY

    def test_node_data_defaults(self):
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

    def test_duplicate_input_output_variable_name_raises_validation_error(self):
        """Duplicate form input output_variable_name should raise validation error."""
        duplicate_inputs = [
            FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="content"),
            FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="content"),
        ]

        with pytest.raises(ValidationError, match="duplicated output_variable_name 'content'"):
            HumanInputNodeData(title="Test Node", inputs=duplicate_inputs)

    def test_duplicate_user_action_ids_raise_validation_error(self):
        """Duplicate user action ids should raise validation error."""
        duplicate_actions = [
            UserAction(id="submit", title="Submit"),
            UserAction(id="submit", title="Submit Again"),
        ]

        with pytest.raises(ValidationError, match="duplicated user action id 'submit'"):
            HumanInputNodeData(title="Test Node", user_actions=duplicate_actions)

    def test_extract_outputs_field_names(self):
        content = r"""This is titile {{#start.title#}}

        A content is required:

        {{#$output.content#}}

        A ending is required:

        {{#$output.ending#}}
        """

        node_data = HumanInputNodeData(title="Human Input", form_content=content)
        field_names = node_data.outputs_field_names()
        assert field_names == ["content", "ending"]


class TestRecipients:
    """Test email recipient entities."""

    def test_member_recipient(self):
        """Test member recipient creation."""
        recipient = MemberRecipient(type=EmailRecipientType.MEMBER, user_id="user-123")

        assert recipient.type == EmailRecipientType.MEMBER
        assert recipient.user_id == "user-123"

    def test_external_recipient(self):
        """Test external recipient creation."""
        recipient = ExternalRecipient(type=EmailRecipientType.EXTERNAL, email="test@example.com")

        assert recipient.type == EmailRecipientType.EXTERNAL
        assert recipient.email == "test@example.com"

    def test_email_recipients_whole_workspace(self):
        """Test email recipients with whole workspace enabled."""
        recipients = EmailRecipients(
            whole_workspace=True, items=[MemberRecipient(type=EmailRecipientType.MEMBER, user_id="user-123")]
        )

        assert recipients.whole_workspace is True
        assert len(recipients.items) == 1  # Items are preserved even when whole_workspace is True

    def test_email_recipients_specific_users(self):
        """Test email recipients with specific users."""
        recipients = EmailRecipients(
            whole_workspace=False,
            items=[
                MemberRecipient(type=EmailRecipientType.MEMBER, user_id="user-123"),
                ExternalRecipient(type=EmailRecipientType.EXTERNAL, email="external@example.com"),
            ],
        )

        assert recipients.whole_workspace is False
        assert len(recipients.items) == 2
        assert recipients.items[0].user_id == "user-123"
        assert recipients.items[1].email == "external@example.com"


class TestHumanInputNodeVariableResolution:
    """Tests for resolving variable-based defaults in HumanInputNode."""

    def test_resolves_variable_defaults(self):
        variable_pool = VariablePool(
            system_variables=SystemVariable(
                user_id="user",
                app_id="app",
                workflow_id="workflow",
                workflow_execution_id="exec-1",
            ),
            user_inputs={},
            conversation_variables=[],
        )
        variable_pool.add(("start", "name"), "Jane Doe")
        runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
        graph_init_params = GraphInitParams(
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            user_id="user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        node_data = HumanInputNodeData(
            title="Human Input",
            form_content="Provide your name",
            inputs=[
                FormInput(
                    type=FormInputType.TEXT_INPUT,
                    output_variable_name="user_name",
                    default=FormInputDefault(type=PlaceholderType.VARIABLE, selector=["start", "name"]),
                ),
                FormInput(
                    type=FormInputType.TEXT_INPUT,
                    output_variable_name="user_email",
                    default=FormInputDefault(type=PlaceholderType.CONSTANT, value="foo@example.com"),
                ),
            ],
            user_actions=[UserAction(id="submit", title="Submit")],
        )
        config = {"id": "human", "data": node_data.model_dump()}

        mock_repo = MagicMock(spec=HumanInputFormRepository)
        mock_repo.get_form.return_value = None
        mock_repo.create_form.return_value = SimpleNamespace(
            id="form-1",
            rendered_content="Provide your name",
            web_app_token="token",
            recipients=[],
            submitted=False,
        )

        node = HumanInputNode(
            id=config["id"],
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=runtime_state,
            form_repository=mock_repo,
        )

        run_result = node._run()
        pause_event = next(run_result)

        assert isinstance(pause_event, PauseRequestedEvent)
        expected_values = {"user_name": "Jane Doe"}
        assert pause_event.reason.resolved_default_values == expected_values

        params = mock_repo.create_form.call_args.args[0]
        assert params.resolved_default_values == expected_values

    def test_debugger_falls_back_to_recipient_token_when_webapp_disabled(self):
        variable_pool = VariablePool(
            system_variables=SystemVariable(
                user_id="user",
                app_id="app",
                workflow_id="workflow",
                workflow_execution_id="exec-2",
            ),
            user_inputs={},
            conversation_variables=[],
        )
        runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
        graph_init_params = GraphInitParams(
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            user_id="user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        node_data = HumanInputNodeData(
            title="Human Input",
            form_content="Provide your name",
            inputs=[],
            user_actions=[UserAction(id="submit", title="Submit")],
        )
        config = {"id": "human", "data": node_data.model_dump()}

        mock_repo = MagicMock(spec=HumanInputFormRepository)
        mock_repo.get_form.return_value = None
        mock_repo.create_form.return_value = SimpleNamespace(
            id="form-2",
            rendered_content="Provide your name",
            web_app_token="console-token",
            recipients=[SimpleNamespace(token="recipient-token")],
            submitted=False,
        )

        node = HumanInputNode(
            id=config["id"],
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=runtime_state,
            form_repository=mock_repo,
        )

        run_result = node._run()
        pause_event = next(run_result)

        assert isinstance(pause_event, PauseRequestedEvent)
        assert pause_event.reason.form_token == "console-token"

    def test_debugger_debug_mode_overrides_email_recipients(self):
        variable_pool = VariablePool(
            system_variables=SystemVariable(
                user_id="user-123",
                app_id="app",
                workflow_id="workflow",
                workflow_execution_id="exec-3",
            ),
            user_inputs={},
            conversation_variables=[],
        )
        runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
        graph_init_params = GraphInitParams(
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            user_id="user-123",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        node_data = HumanInputNodeData(
            title="Human Input",
            form_content="Provide your name",
            inputs=[],
            user_actions=[UserAction(id="submit", title="Submit")],
            delivery_methods=[
                EmailDeliveryMethod(
                    enabled=True,
                    config=EmailDeliveryConfig(
                        recipients=EmailRecipients(
                            whole_workspace=False,
                            items=[ExternalRecipient(type=EmailRecipientType.EXTERNAL, email="target@example.com")],
                        ),
                        subject="Subject",
                        body="Body",
                        debug_mode=True,
                    ),
                )
            ],
        )
        config = {"id": "human", "data": node_data.model_dump()}

        mock_repo = MagicMock(spec=HumanInputFormRepository)
        mock_repo.get_form.return_value = None
        mock_repo.create_form.return_value = SimpleNamespace(
            id="form-3",
            rendered_content="Provide your name",
            web_app_token="token",
            recipients=[],
            submitted=False,
        )

        node = HumanInputNode(
            id=config["id"],
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=runtime_state,
            form_repository=mock_repo,
        )

        run_result = node._run()
        pause_event = next(run_result)
        assert isinstance(pause_event, PauseRequestedEvent)

        params = mock_repo.create_form.call_args.args[0]
        assert len(params.delivery_methods) == 1
        method = params.delivery_methods[0]
        assert isinstance(method, EmailDeliveryMethod)
        assert method.config.debug_mode is True
        assert method.config.recipients.whole_workspace is False
        assert len(method.config.recipients.items) == 1
        recipient = method.config.recipients.items[0]
        assert isinstance(recipient, MemberRecipient)
        assert recipient.user_id == "user-123"


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


class TestHumanInputNodeRenderedContent:
    """Tests for rendering submitted content."""

    def test_replaces_outputs_placeholders_after_submission(self):
        variable_pool = VariablePool(
            system_variables=SystemVariable(
                user_id="user",
                app_id="app",
                workflow_id="workflow",
                workflow_execution_id="exec-1",
            ),
            user_inputs={},
            conversation_variables=[],
        )
        runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
        graph_init_params = GraphInitParams(
            tenant_id="tenant",
            app_id="app",
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            user_id="user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        node_data = HumanInputNodeData(
            title="Human Input",
            form_content="Name: {{#$output.name#}}",
            inputs=[
                FormInput(
                    type=FormInputType.TEXT_INPUT,
                    output_variable_name="name",
                )
            ],
            user_actions=[UserAction(id="approve", title="Approve")],
        )
        config = {"id": "human", "data": node_data.model_dump()}

        form_repository = InMemoryHumanInputFormRepository()
        node = HumanInputNode(
            id=config["id"],
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=runtime_state,
            form_repository=form_repository,
        )

        pause_gen = node._run()
        pause_event = next(pause_gen)
        assert isinstance(pause_event, PauseRequestedEvent)
        with pytest.raises(StopIteration):
            next(pause_gen)

        form_repository.set_submission(action_id="approve", form_data={"name": "Alice"})

        events = list(node._run())
        last_event = events[-1]
        assert isinstance(last_event, StreamCompletedEvent)
        node_run_result = last_event.node_run_result
        assert node_run_result.outputs["__rendered_content"] == "Name: Alice"
