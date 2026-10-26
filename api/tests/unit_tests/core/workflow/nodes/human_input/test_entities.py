from __future__ import annotations

import datetime as _human_input_form_filled_event_datetime
import json
from collections.abc import Generator, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, timedelta
from datetime import datetime as _dify_owned_contracts_datetime
from datetime import datetime as _entities_datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask
from pydantic import TypeAdapter, ValidationError
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.apps.advanced_chat.generate_task_pipeline import (
    AdvancedChatAppGenerateTaskPipeline,
    ConversationSnapshot,
    MessageSnapshot,
    WorkflowSnapshot,
)
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import (
    DIFY_RUN_CONTEXT_KEY,
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    UserFrom,
)
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueHumanInputFormFilledEvent,
    QueueNodeSucceededEvent,
    QueueWorkflowStartedEvent,
    WorkflowQueueMessage,
)
from core.repositories.human_input_repository import (
    FormCreateParams,
    HumanInputFormEntity,
    HumanInputFormRecipientEntity,
    HumanInputFormRepository,
    HumanInputFormSubmissionRepository,
)
from core.workflow.human_input_adapter import (
    DeliveryMethodType,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    EmailRecipients,
    EmailRecipientType,
    ExternalRecipient,
    MemberRecipient,
    WebAppDeliveryMethod,
    _WebAppDeliveryConfig,
)
from core.workflow.node_runtime import DifyHumanInputNodeRuntime
from core.workflow.nodes.human_input._exc import ExtensionsNotSetErrorValueError
from core.workflow.nodes.human_input.boundary import HumanInputFormEventFilter
from core.workflow.nodes.human_input.callback import (
    DifyHITLCallback,
)
from core.workflow.nodes.human_input.entities import (
    FileInputConfig,
    FileListInputConfig,
    FormDefinition,
    HumanInputNodeData,
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    StringSource,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import (
    ButtonStyle,
    FormInputType,
    HumanInputFormStatus,
    TimeoutUnit,
    ValueSourceType,
)
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from core.workflow.nodes.human_input.session_binding import SessionBinding
from core.workflow.system_variables import build_system_variables
from core.workflow.workflow_entry import WorkflowEntry, iter_dify_graph_engine_events
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine.filter import EngineEventFilterContext, filter_engine_events
from graphon.engine_events import (
    EngineEvent,
    GraphEdgeSkippedEvent,
    GraphEdgeTakenEvent,
    NodeRunHumanInputFormFilledEvent,
)
from graphon.entities import WorkflowStartReason
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from graphon.file import File, FileTransferMethod, FileType
from graphon.graph import Graph
from graphon.node_events import PauseRequestedEvent
from graphon.node_events.node import StreamCompletedEvent
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.nodes.protocols import FileReferenceFactoryProtocol
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import InitParams, ReadOnlyRuntimeStateWrapper, RuntimeState, VariablePool
from graphon.runtime.execution import ROOT_FRAME_ID
from graphon.variables.segments import ArrayFileSegment, FileSegment, StringSegment
from libs.datetime_utils import naive_utc_now
from libs.helper import compact_generate_response
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import ConversationFromSource, MessageStatus
from models.human_input import HumanInputForm
from models.model import AppMode
from tests.helpers.unit.model_factories import make_account, make_message, make_tenant


def test_session_binding_identity_mapping() -> None:
    binding = SessionBinding()

    assert binding.issue_session_id_for_form(form_id="form-1") == "form-1"
    assert binding.resolve_form_id_from_session_id(session_id="form-1") == "form-1"


def test_human_input_node_contracts_accept_legacy_json_payload() -> None:
    payload = {
        "form_content": "Please confirm",
        "inputs": [
            {
                "type": "paragraph",
                "output_variable_name": "name",
                "default": {
                    "type": "constant",
                    "selector": [],
                    "value": "Alice",
                },
            },
            {
                "type": "select",
                "output_variable_name": "decision",
                "option_source": {
                    "type": "constant",
                    "selector": [],
                    "value": ["approve", "reject"],
                },
            },
        ],
        "user_actions": [
            {
                "id": "approve",
                "title": "Approve",
                "button_style": "primary",
            }
        ],
        "rendered_content": "Please confirm",
        "expiration_time": "2024-01-01T00:00:00Z",
        "default_values": {"name": "Alice"},
        "node_title": "Human Input",
        "display_in_ui": True,
    }

    restored = TypeAdapter(FormDefinition).validate_json(json.dumps(payload))

    assert isinstance(restored.inputs[0], ParagraphInputConfig)
    assert isinstance(restored.inputs[1], SelectInputConfig)
    assert restored.inputs[0].default is not None
    assert restored.inputs[0].default.type == ValueSourceType.CONSTANT
    assert restored.inputs[0].default.value == "Alice"
    assert restored.inputs[1].option_source.type == ValueSourceType.CONSTANT
    assert restored.inputs[1].option_source.value == ["approve", "reject"]
    assert restored.user_actions == [UserActionConfig(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY)]


def test_human_input_required_pause_reason_keeps_legacy_payload_shape() -> None:
    payload = {
        "TYPE": "human_input_required",
        "form_id": "form-1",
        "form_content": "Please confirm",
        "inputs": [
            {
                "type": "paragraph",
                "output_variable_name": "name",
                "default": {
                    "type": "constant",
                    "selector": [],
                    "value": "Alice",
                },
            }
        ],
        "actions": [
            {
                "id": "approve",
                "title": "Approve",
                "button_style": "primary",
            }
        ],
        "node_id": "node-1",
        "node_title": "Human Input",
        "resolved_default_values": {"name": "Alice"},
    }

    restored = TypeAdapter(HumanInputRequired).validate_json(json.dumps(payload))

    assert restored.TYPE.value == "human_input_required"
    assert restored.actions[0].button_style == ButtonStyle.PRIMARY
    assert restored.model_dump(mode="json")["TYPE"] == "human_input_required"


def test_form_definition_dump_keeps_public_json_shape() -> None:
    definition = FormDefinition(
        form_content="Please confirm",
        inputs=[ParagraphInputConfig(type=FormInputType.PARAGRAPH, output_variable_name="name")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        rendered_content="rendered",
        expiration_time=_dify_owned_contracts_datetime(2024, 1, 1, tzinfo=UTC),
        default_values={"name": "Alice"},
        node_title="Ask Name",
        display_in_ui=True,
    )

    payload = definition.model_dump(mode="json")

    assert payload["expiration_time"] == "2024-01-01T00:00:00Z"
    assert payload["user_actions"][0]["id"] == "approve"
    assert payload["inputs"][0]["type"] == "paragraph"


def test_custom_file_input_requires_extensions() -> None:
    with pytest.raises(ExtensionsNotSetErrorValueError):
        FileInputConfig(
            output_variable_name="attachment",
            allowed_file_types=[FileType.CUSTOM],
            allowed_file_extensions=[],
        )


"""
Unit tests for human input node entities.
"""


@dataclass
class _InMemoryFormEntity(HumanInputFormEntity):
    form_id: str
    rendered: str
    token: str | None = None
    action_id: str | None = None
    data: Mapping[str, Any] | None = None
    is_submitted: bool = False
    status_value: HumanInputFormStatus = HumanInputFormStatus.WAITING
    created: _entities_datetime = field(default_factory=naive_utc_now)
    expiration: _entities_datetime = field(default_factory=lambda: naive_utc_now() + timedelta(days=1))

    @property
    def id(self) -> str:
        return self.form_id

    @property
    def submission_token(self) -> str | None:
        return self.token

    @property
    def recipients(self) -> list[HumanInputFormRecipientEntity]:
        return []

    @property
    def rendered_content(self) -> str:
        return self.rendered

    @property
    def selected_action_id(self) -> str | None:
        return self.action_id

    @property
    def created_at(self) -> _entities_datetime:
        return self.created

    @property
    def submitted_data(self) -> Mapping[str, Any] | None:
        return self.data

    @property
    def submitted(self) -> bool:
        return self.is_submitted

    @property
    def status(self) -> HumanInputFormStatus:
        return self.status_value

    @property
    def expiration_time(self) -> _entities_datetime:
        return self.expiration


class InMemoryHumanInputFormRepository(HumanInputFormRepository):
    """Minimal in-memory repository for Dify-owned HumanInputNode behavior tests."""

    def __init__(self) -> None:
        self._form_counter = 0
        self.created_params: list[FormCreateParams] = []
        self.created_forms: list[_InMemoryFormEntity] = []
        self._forms_by_node_id: dict[str, _InMemoryFormEntity] = {}

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        self.created_params.append(params)
        self._form_counter += 1
        form_id = f"form-{self._form_counter}"
        entity = _InMemoryFormEntity(
            form_id=form_id,
            rendered=params.rendered_content,
            token=f"token-{form_id}",
        )
        self.created_forms.append(entity)
        self._forms_by_node_id[params.node_id] = entity
        return entity

    def get_form(self, node_id: str) -> HumanInputFormEntity | None:
        return self._forms_by_node_id.get(node_id)

    def mark_timeout(self, node_id: str, *, form_id: str) -> HumanInputFormEntity:
        raise AssertionError(f"unexpected timeout in submission scenario: node={node_id}, form={form_id}")

    def set_submission(self, *, action_id: str, form_data: Mapping[str, Any] | None = None) -> None:
        if not self.created_forms:
            raise AssertionError("no form has been created to attach submission data")
        entity = self.created_forms[-1]
        entity.action_id = action_id
        entity.data = form_data or {}
        entity.is_submitted = True
        entity.status_value = HumanInputFormStatus.SUBMITTED


class _EntitiesTestfilereferencefactory(FileReferenceFactoryProtocol):
    """Build graph-layer file objects without touching Dify persistence in unit tests."""

    def build_from_mapping(self, *, mapping: Mapping[str, Any]) -> File:
        return File(
            file_id=mapping.get("id"),
            file_type=FileType(mapping["type"]),
            transfer_method=FileTransferMethod(mapping["transfer_method"]),
            remote_url=mapping.get("remote_url") or mapping.get("url"),
            related_id=mapping.get("related_id") or mapping.get("upload_file_id"),
            filename=mapping.get("filename"),
            extension=mapping.get("extension"),
            mime_type=mapping.get("mime_type"),
            size=mapping.get("size", -1),
        )


def _build_human_input_node(
    *,
    node_id: str,
    node_data: HumanInputNodeData | Mapping[str, Any],
    init_params: InitParams,
    runtime_state: RuntimeState,
    runtime: DifyHumanInputNodeRuntime,
) -> HumanInputNode:
    typed_node_data = (
        node_data if isinstance(node_data, HumanInputNodeData) else HumanInputNodeData.model_validate(node_data)
    )
    runtime._file_reference_factory = _EntitiesTestfilereferencefactory()  # type: ignore[attr-defined]
    callback = DifyHITLCallback(
        form_repository=runtime.build_form_repository(),
        node_data=typed_node_data,
        delivery_methods=runtime._resolve_delivery_methods(node_data=typed_node_data),
        display_in_ui=runtime._display_in_ui(node_data=typed_node_data),
        file_reference_factory=_EntitiesTestfilereferencefactory(),
    )
    return HumanInputNode(
        node_id=node_id,
        data=typed_node_data,
        init_params=init_params,
        runtime_state=runtime_state,
        hitl_callback=callback,
    )


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
            include_bound_group=False,
            items=[
                MemberRecipient(type=EmailRecipientType.MEMBER, reference_id="test-user-123"),
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


class TestParagraphInputConfig:
    """Test ParagraphInputConfig entity."""

    def test_paragraph_input_with_constant_default(self):
        """Test paragraph input with constant default value."""
        default = StringSource(type=ValueSourceType.CONSTANT, value="Enter your response here...")

        form_input = ParagraphInputConfig(output_variable_name="user_input", default=default)

        assert form_input.type == FormInputType.PARAGRAPH
        assert form_input.output_variable_name == "user_input"
        assert form_input.default is not None
        assert form_input.default.type == ValueSourceType.CONSTANT
        assert form_input.default.value == "Enter your response here..."

    def test_paragraph_input_with_variable_default(self):
        """Test paragraph input with variable default value."""
        default = StringSource(type=ValueSourceType.VARIABLE, selector=["node_123", "output_var"])

        form_input = ParagraphInputConfig(output_variable_name="user_input", default=default)

        assert form_input.default is not None
        assert form_input.default.type == ValueSourceType.VARIABLE
        assert form_input.default.selector == ["node_123", "output_var"]

    def test_form_input_without_default(self):
        """Test form input without default value."""
        form_input = ParagraphInputConfig(output_variable_name="description")

        assert form_input.type == FormInputType.PARAGRAPH
        assert form_input.output_variable_name == "description"
        assert form_input.default is None


class TestUserAction:
    """Test UserActionConfig entity."""

    def test_user_action_creation(self):
        """Test user action creation."""
        action = UserActionConfig(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY)

        assert action.id == "approve"
        assert action.title == "Approve"
        assert action.button_style == ButtonStyle.PRIMARY

    def test_user_action_default_button_style(self):
        """Test user action with default button style."""
        action = UserActionConfig(id="cancel", title="Cancel")

        assert action.button_style == ButtonStyle.DEFAULT

    def test_user_action_length_boundaries(self):
        """Test user action id and title length boundaries."""
        action = UserActionConfig(id="a" * 20, title="b" * 100)

        assert action.id == "a" * 20
        assert action.title == "b" * 100

    @pytest.mark.parametrize(
        ("field_name", "value"),
        [
            ("id", "a" * 21),
            ("title", "b" * 101),
        ],
    )
    def test_user_action_length_limits(self, field_name: str, value: str):
        """User action fields should enforce max length."""
        data = {"id": "approve", "title": "Approve"}
        data[field_name] = value

        with pytest.raises(ValidationError) as exc_info:
            UserActionConfig.model_validate(data)

        errors = exc_info.value.errors()
        assert any(error["loc"] == (field_name,) and error["type"] == "string_too_long" for error in errors)


class TestHumanInputNodeData:
    """Test HumanInputNodeData entity."""

    def test_valid_node_data_creation(self):
        """Test creating valid human input node data."""
        delivery_methods = [WebAppDeliveryMethod(enabled=True, config=_WebAppDeliveryConfig())]

        inputs = [
            ParagraphInputConfig(
                output_variable_name="content",
                default=StringSource(type=ValueSourceType.CONSTANT, value="Enter content..."),
            )
        ]

        user_actions = [UserActionConfig(id="submit", title="Submit", button_style=ButtonStyle.PRIMARY)]

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
                    subject="Hi there", body="", recipients=EmailRecipients(include_bound_group=True)
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
        assert node_data.model_dump().get("delivery_methods") is None
        assert node_data.form_content == ""
        assert node_data.inputs == []
        assert node_data.user_actions == []
        assert node_data.timeout == 36
        assert node_data.timeout_unit == TimeoutUnit.HOUR

    def test_duplicate_input_output_variable_name_raises_validation_error(self):
        """Duplicate form input output_variable_name should raise validation error."""
        duplicate_inputs = [
            ParagraphInputConfig(output_variable_name="content"),
            ParagraphInputConfig(output_variable_name="content"),
        ]

        with pytest.raises(ValidationError, match="duplicated output_variable_name 'content'"):
            HumanInputNodeData(title="Test Node", inputs=duplicate_inputs)

    def test_duplicate_user_action_ids_raise_validation_error(self):
        """Duplicate user action ids should raise validation error."""
        duplicate_actions = [
            UserActionConfig(id="submit", title="Submit"),
            UserActionConfig(id="submit", title="Submit Again"),
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
        recipient = MemberRecipient(type=EmailRecipientType.MEMBER, reference_id="user-123")

        assert recipient.type == EmailRecipientType.MEMBER
        assert recipient.reference_id == "user-123"

    def test_external_recipient(self):
        """Test external recipient creation."""
        recipient = ExternalRecipient(type=EmailRecipientType.EXTERNAL, email="test@example.com")

        assert recipient.type == EmailRecipientType.EXTERNAL
        assert recipient.email == "test@example.com"

    def test_email_recipients_bound_group(self):
        """Test email recipients with the bound group enabled."""
        recipients = EmailRecipients(
            include_bound_group=True,
            items=[MemberRecipient(type=EmailRecipientType.MEMBER, reference_id="user-123")],
        )

        assert recipients.include_bound_group is True
        assert len(recipients.items) == 1  # Items are preserved even when include_bound_group is True

    def test_email_recipients_specific_users(self):
        """Test email recipients with specific users."""
        recipients = EmailRecipients(
            include_bound_group=False,
            items=[
                MemberRecipient(type=EmailRecipientType.MEMBER, reference_id="user-123"),
                ExternalRecipient(type=EmailRecipientType.EXTERNAL, email="external@example.com"),
            ],
        )

        assert recipients.include_bound_group is False
        assert len(recipients.items) == 2
        assert recipients.items[0].reference_id == "user-123"
        assert recipients.items[1].email == "external@example.com"

    def test_legacy_recipient_keys_are_rejected(self):
        with pytest.raises(ValidationError):
            MemberRecipient(type=EmailRecipientType.MEMBER, user_id="user-123")

        recipients = EmailRecipients(whole_workspace=True, items=[])
        assert recipients.include_bound_group is True
        assert recipients.items == []


class TestHumanInputNodeVariableResolution:
    """Tests for resolving variable-based defaults in HumanInputNode."""

    @pytest.fixture(autouse=True)
    def _bind_repository(self, sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture) -> None:
        mocker.patch(
            "core.repositories.human_input_repository.session_factory.create_session",
            side_effect=sqlite_session_factory,
        )
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    make_account(account_id="user-123"),
                    make_tenant(tenant_id="tenant"),
                    TenantAccountJoin(tenant_id="tenant", account_id="user-123", role=TenantAccountRole.NORMAL),
                ]
            )

    def test_resolves_variable_defaults(self, mocker: MockerFixture):
        variable_pool = VariablePool.from_bootstrap(
            system_variables=build_system_variables(
                user_id="user",
                app_id="app",
                workflow_id="workflow",
                workflow_execution_id="exec-1",
            ),
            user_inputs={},
            conversation_variables=[],
        )
        variable_pool.add(("start", "name"), "Jane Doe")
        runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0.0)
        graph_init_params = InitParams(
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            run_context={
                DIFY_RUN_CONTEXT_KEY: {
                    "tenant_id": "tenant",
                    "app_id": "app",
                    "user_id": "user",
                    "user_from": "account",
                    "invoke_from": "debugger",
                }
            },
            call_depth=0,
        )

        node_data = HumanInputNodeData(
            title="Human Input",
            form_content="Provide your name",
            inputs=[
                ParagraphInputConfig(
                    output_variable_name="user_name",
                    default=StringSource(type=ValueSourceType.VARIABLE, selector=["start", "name"]),
                ),
                ParagraphInputConfig(
                    output_variable_name="user_email",
                    default=StringSource(type=ValueSourceType.CONSTANT, value="foo@example.com"),
                ),
            ],
            user_actions=[UserActionConfig(id="submit", title="Submit")],
        )
        config = {"id": "human", "data": node_data.model_dump()}

        runtime = DifyHumanInputNodeRuntime(
            graph_init_params.run_context,
            workflow_execution_id_getter=lambda: "exec-1",
        )
        repository = runtime.build_form_repository()
        create = mocker.spy(repository, "create_form")
        runtime = runtime.with_form_repository(repository)
        node = _build_human_input_node(
            node_id=config["id"],
            node_data=config["data"],
            init_params=graph_init_params,
            runtime_state=runtime_state,
            runtime=runtime,
        )

        run_result = node._run()
        pause_event = next(run_result)

        assert isinstance(pause_event, PauseRequestedEvent)
        expected_values = {"user_name": "Jane Doe"}
        create_params = create.call_args.args[0]
        assert create_params.resolved_default_values == expected_values

        params = create.call_args.args[0]
        assert params.resolved_default_values == expected_values

    def test_debugger_falls_back_to_recipient_token_when_webapp_disabled(self, mocker: MockerFixture):
        variable_pool = VariablePool.from_bootstrap(
            system_variables=build_system_variables(
                user_id="user",
                app_id="app",
                workflow_id="workflow",
                workflow_execution_id="exec-2",
            ),
            user_inputs={},
            conversation_variables=[],
        )
        runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0.0)
        graph_init_params = InitParams(
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            run_context={
                DIFY_RUN_CONTEXT_KEY: {
                    "tenant_id": "tenant",
                    "app_id": "app",
                    "user_id": "user",
                    "user_from": "account",
                    "invoke_from": "debugger",
                }
            },
            call_depth=0,
        )

        node_data = HumanInputNodeData(
            title="Human Input",
            form_content="Provide your name",
            inputs=[],
            user_actions=[UserActionConfig(id="submit", title="Submit")],
        )
        config = {"id": "human", "data": node_data.model_dump()}

        runtime = DifyHumanInputNodeRuntime(
            graph_init_params.run_context,
            workflow_execution_id_getter=lambda: "exec-2",
        )
        repository = runtime.build_form_repository()
        mocker.spy(repository, "create_form")
        runtime = runtime.with_form_repository(repository)
        node = _build_human_input_node(
            node_id=config["id"],
            node_data=config["data"],
            init_params=graph_init_params,
            runtime_state=runtime_state,
            runtime=runtime,
        )

        run_result = node._run()
        pause_event = next(run_result)

        assert isinstance(pause_event, PauseRequestedEvent)
        assert not hasattr(pause_event.reason, "form_token")

    def test_webapp_runtime_keeps_form_visible_in_ui_when_webapp_delivery_is_enabled(self, mocker: MockerFixture):
        variable_pool = VariablePool.from_bootstrap(
            system_variables=build_system_variables(
                user_id="user",
                app_id="app",
                workflow_id="workflow",
                workflow_execution_id="exec-4",
            ),
            user_inputs={},
            conversation_variables=[],
        )
        runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0.0)
        graph_init_params = InitParams(
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            run_context={
                DIFY_RUN_CONTEXT_KEY: {
                    "tenant_id": "tenant",
                    "app_id": "app",
                    "user_id": "end-user-1",
                    "user_from": "end-user",
                    "invoke_from": "web-app",
                }
            },
            call_depth=0,
        )

        config = {
            "id": "human",
            "data": {
                "type": "human-input",
                "title": "Human Input",
                "form_content": "Provide your name",
                "inputs": [],
                "user_actions": [{"id": "submit", "title": "Submit"}],
                "delivery_methods": [{"enabled": True, "type": "webapp", "config": {}}],
            },
        }

        runtime = DifyHumanInputNodeRuntime(
            graph_init_params.run_context,
            workflow_execution_id_getter=lambda: "exec-4",
        )
        repository = runtime.build_form_repository()
        create = mocker.spy(repository, "create_form")
        runtime = runtime.with_form_repository(repository)
        node = _build_human_input_node(
            node_id=config["id"],
            node_data=config["data"],
            init_params=graph_init_params,
            runtime_state=runtime_state,
            runtime=runtime,
        )

        run_result = node._run()
        pause_event = next(run_result)

        assert isinstance(pause_event, PauseRequestedEvent)
        params = create.call_args.args[0]
        assert params.display_in_ui is True

    def test_debugger_debug_mode_overrides_email_recipients(self, mocker: MockerFixture):
        variable_pool = VariablePool.from_bootstrap(
            system_variables=build_system_variables(
                user_id="user-123",
                app_id="app",
                workflow_id="workflow",
                workflow_execution_id="exec-3",
            ),
            user_inputs={},
            conversation_variables=[],
        )
        runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0.0)
        graph_init_params = InitParams(
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            run_context={
                DIFY_RUN_CONTEXT_KEY: {
                    "tenant_id": "tenant",
                    "app_id": "app",
                    "user_id": "user-123",
                    "user_from": "account",
                    "invoke_from": "debugger",
                }
            },
            call_depth=0,
        )

        node_data = HumanInputNodeData(
            title="Human Input",
            form_content="Provide your name",
            inputs=[],
            user_actions=[UserActionConfig(id="submit", title="Submit")],
            delivery_methods=[
                EmailDeliveryMethod(
                    enabled=True,
                    config=EmailDeliveryConfig(
                        recipients=EmailRecipients(
                            include_bound_group=False,
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

        runtime = DifyHumanInputNodeRuntime(
            graph_init_params.run_context,
            workflow_execution_id_getter=lambda: "exec-3",
        )
        repository = runtime.build_form_repository()
        create = mocker.spy(repository, "create_form")
        runtime = runtime.with_form_repository(repository)
        node = _build_human_input_node(
            node_id=config["id"],
            node_data=config["data"],
            init_params=graph_init_params,
            runtime_state=runtime_state,
            runtime=runtime,
        )

        run_result = node._run()
        pause_event = next(run_result)
        assert isinstance(pause_event, PauseRequestedEvent)

        params = create.call_args.args[0]
        assert len(params.delivery_methods) == 1
        method = params.delivery_methods[0]
        assert isinstance(method, EmailDeliveryMethod)
        assert method.config.debug_mode is True
        assert method.config.recipients.include_bound_group is False
        assert len(method.config.recipients.items) == 1
        recipient = method.config.recipients.items[0]
        assert isinstance(recipient, MemberRecipient)
        assert recipient.reference_id == "user-123"


class TestValidation:
    """Test validation scenarios."""

    def test_invalid_form_input_type(self):
        """Test validation with invalid form input type."""
        with pytest.raises(ValidationError):
            ParagraphInputConfig.model_validate(
                {
                    "type": "invalid-type",
                    "output_variable_name": "test",
                }
            )

    def test_invalid_button_style(self):
        """Test validation with invalid button style."""
        with pytest.raises(ValidationError):
            UserActionConfig(
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
        variable_pool = VariablePool.from_bootstrap(
            system_variables=build_system_variables(
                user_id="user",
                app_id="app",
                workflow_id="workflow",
                workflow_execution_id="exec-1",
            ),
            user_inputs={},
            conversation_variables=[],
        )
        runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0.0)
        graph_init_params = InitParams(
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            run_context={
                DIFY_RUN_CONTEXT_KEY: {
                    "tenant_id": "tenant",
                    "app_id": "app",
                    "user_id": "user",
                    "user_from": "account",
                    "invoke_from": "debugger",
                }
            },
            call_depth=0,
        )

        node_data = HumanInputNodeData(
            title="Human Input",
            form_content="Name: {{#$output.name#}}",
            inputs=[ParagraphInputConfig(output_variable_name="name")],
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        )
        config = {"id": "human", "data": node_data.model_dump()}

        form_repository = InMemoryHumanInputFormRepository()
        runtime = DifyHumanInputNodeRuntime(graph_init_params.run_context)
        runtime._build_form_repository = MagicMock(return_value=form_repository)  # type: ignore[attr-defined]
        node = _build_human_input_node(
            node_id=config["id"],
            node_data=config["data"],
            init_params=graph_init_params,
            runtime_state=runtime_state,
            runtime=runtime,
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
        assert node_run_result.outputs["name"] == StringSegment(value="Alice")
        assert node_run_result.outputs["__action_id"] == StringSegment(value="approve")
        assert node_run_result.outputs["__rendered_content"] == StringSegment(value="Name: Alice")

    def test_resume_restores_file_outputs_as_runtime_segments(self):
        variable_pool = VariablePool.from_bootstrap(
            system_variables=build_system_variables(
                user_id="user",
                app_id="app",
                workflow_id="workflow",
                workflow_execution_id="run",
            ),
            user_inputs={},
            conversation_variables=[],
        )
        runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=variable_pool, start_at=0.0)
        graph_init_params = InitParams(
            workflow_id="workflow",
            graph_config={"nodes": [], "edges": []},
            run_context={
                DIFY_RUN_CONTEXT_KEY: {
                    "tenant_id": "tenant",
                    "app_id": "app",
                    "user_id": "user",
                    "user_from": "account",
                    "invoke_from": "debugger",
                }
            },
            call_depth=0,
        )

        node_data = HumanInputNodeData(
            title="Human Input",
            form_content=(
                "Decision: {{#$output.decision#}}\n"
                "Attachment: {{#$output.attachment#}}\n"
                "Attachments: {{#$output.attachments#}}"
            ),
            inputs=[
                SelectInputConfig(
                    output_variable_name="decision",
                    option_source=StringListSource(type="constant", value=["approve", "reject"]),
                ),
                FileInputConfig(output_variable_name="attachment"),
                FileListInputConfig(output_variable_name="attachments", number_limits=2),
            ],
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        )
        config = {"id": "human", "data": node_data.model_dump()}

        form_repository = InMemoryHumanInputFormRepository()
        runtime = DifyHumanInputNodeRuntime(graph_init_params.run_context)
        runtime._build_form_repository = MagicMock(return_value=form_repository)  # type: ignore[attr-defined]
        node = _build_human_input_node(
            node_id=config["id"],
            node_data=config["data"],
            init_params=graph_init_params,
            runtime_state=runtime_state,
            runtime=runtime,
        )

        pause_gen = node._run()
        pause_event = next(pause_gen)
        assert isinstance(pause_event, PauseRequestedEvent)
        with pytest.raises(StopIteration):
            next(pause_gen)

        form_repository.set_submission(
            action_id="approve",
            form_data={
                "decision": "approve",
                "attachment": {
                    "type": "document",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/resume.pdf",
                    "filename": "resume.pdf",
                    "extension": ".pdf",
                    "mime_type": "application/pdf",
                },
                "attachments": [
                    {
                        "type": "image",
                        "transfer_method": "remote_url",
                        "remote_url": "https://example.com/a.png",
                        "filename": "a.png",
                        "extension": ".png",
                        "mime_type": "image/png",
                    },
                    {
                        "type": "image",
                        "transfer_method": "remote_url",
                        "remote_url": "https://example.com/b.png",
                        "filename": "b.png",
                        "extension": ".png",
                        "mime_type": "image/png",
                    },
                ],
            },
        )

        events = list(node._run())
        last_event = events[-1]
        assert isinstance(last_event, StreamCompletedEvent)
        node_run_result = last_event.node_run_result
        assert node_run_result.outputs["decision"] == StringSegment(value="approve")
        assert node_run_result.outputs["__rendered_content"] == StringSegment(
            value="Decision: approve\nAttachment: [file]\nAttachments: [2 files]"
        )
        assert isinstance(node_run_result.outputs["attachment"], FileSegment)
        assert node_run_result.outputs["attachment"].value.filename == "resume.pdf"
        assert isinstance(node_run_result.outputs["attachments"], ArrayFileSegment)
        assert [file.filename for file in node_run_result.outputs["attachments"].value] == ["a.png", "b.png"]


def _persist_form(
    sessions: sessionmaker[Session],
    *,
    form_id: str,
    app_id: str,
    node_id: str,
    expiration_time: _human_input_form_filled_event_datetime.datetime,
    status: HumanInputFormStatus,
) -> None:
    definition = FormDefinition(form_content="content", rendered_content="content", expiration_time=expiration_time)
    form = HumanInputForm(
        tenant_id="tenant",
        app_id=app_id,
        workflow_run_id="run-1",
        node_id=node_id,
        form_definition=definition.model_dump_json(),
        rendered_content="content",
        expiration_time=expiration_time,
        status=status,
    )
    form.id = form_id
    with sessions.begin() as session:
        session.add(form)


class _FakeFormRepository:
    def __init__(self, form):
        self._form = form

    def get_form(self, *_args, **_kwargs):
        return self._form

    def mark_timeout(self, _node_id: str, *, form_id: str):
        assert form_id == self._form.id
        self._form.status = HumanInputFormStatus.TIMEOUT
        return self._form


class _HumanInputFormFilledEventTestfilereferencefactory(FileReferenceFactoryProtocol):
    def build_from_mapping(self, *, mapping: Mapping[str, Any]):
        return File(
            file_id=mapping.get("id"),
            file_type=FileType(mapping["type"]),
            transfer_method=FileTransferMethod(mapping["transfer_method"]),
            remote_url=mapping.get("remote_url") or mapping.get("url"),
            related_id=mapping.get("related_id") or mapping.get("upload_file_id"),
            filename=mapping.get("filename"),
            extension=mapping.get("extension"),
            mime_type=mapping.get("mime_type"),
            size=mapping.get("size", -1),
        )


def _create_human_input_node(
    *,
    config: dict,
    init_params: InitParams,
    runtime_state: RuntimeState,
    repo: _FakeFormRepository,
) -> HumanInputNode:
    node_data = (
        config["data"]
        if isinstance(config["data"], HumanInputNodeData)
        else HumanInputNodeData.model_validate(config["data"])
    )
    callback = DifyHITLCallback(
        form_repository=repo,
        node_data=node_data,
        file_reference_factory=_HumanInputFormFilledEventTestfilereferencefactory(),
    )
    node = HumanInputNode(
        node_id=config["id"],
        data=node_data,
        init_params=init_params,
        runtime_state=runtime_state,
        hitl_callback=callback,
    )
    node.bind_execution_id("00000000-0000-4000-8000-000000000001")
    return node


def _build_node(
    form_content: str = (
        "Please enter your name:\n\n{{#$output.name#}}\n"
        "Decision: {{#$output.decision#}}\n"
        "Attachment: {{#$output.attachment#}}\n"
        "Attachments: {{#$output.attachments#}}"
    ),
    *,
    with_inputs: bool = True,
    node_id: str = "node-1",
) -> HumanInputNode:
    system_variables = build_system_variables(app_id="app", workflow_execution_id="run-1")
    graph_runtime_state = RuntimeState(
        workflow_id="workflow",
        variable_pool=VariablePool.from_bootstrap(
            system_variables=system_variables,
            user_inputs={},
            environment_variables=[],
        ),
        start_at=0.0,
    )
    graph_init_params = InitParams(
        workflow_id="workflow",
        graph_config={"nodes": [], "edges": []},
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": "tenant",
                "app_id": "app",
                "user_id": "user",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.SERVICE_API,
            }
        },
        call_depth=0,
    )

    config = {
        "id": node_id,
        "type": BuiltinNodeTypes.HUMAN_INPUT,
        "data": {
            "title": "Human Input",
            "form_content": form_content,
            "inputs": [
                ParagraphInputConfig(output_variable_name="name").model_dump(mode="json"),
                SelectInputConfig(
                    output_variable_name="decision",
                    option_source=StringListSource(type="constant", value=["approve", "reject"]),
                ).model_dump(mode="json"),
                FileInputConfig(output_variable_name="attachment").model_dump(mode="json"),
                FileListInputConfig(output_variable_name="attachments", number_limits=2).model_dump(mode="json"),
            ],
            "user_actions": [UserActionConfig(id="Accept", title="Approve").model_dump(mode="json")],
        },
    }

    fake_form = SimpleNamespace(
        id="form-1",
        rendered_content=form_content,
        submitted=True,
        selected_action_id="Accept",
        submitted_data={
            "name": "Alice",
            "decision": "approve",
            "attachment": {
                "type": "document",
                "transfer_method": "remote_url",
                "remote_url": "https://example.com/resume.pdf",
                "filename": "resume.pdf",
                "extension": ".pdf",
                "mime_type": "application/pdf",
            },
            "attachments": [
                {
                    "type": "image",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/a.png",
                    "filename": "a.png",
                    "extension": ".png",
                    "mime_type": "image/png",
                }
            ],
        },
        status=HumanInputFormStatus.SUBMITTED,
        expiration_time=naive_utc_now() + _human_input_form_filled_event_datetime.timedelta(days=1),
    )

    if not with_inputs:
        config["data"]["inputs"] = []
        fake_form.submitted_data = {}

    repo = _FakeFormRepository(fake_form)
    return _create_human_input_node(
        config=config,
        init_params=graph_init_params,
        runtime_state=graph_runtime_state,
        repo=repo,
    )


def _build_timeout_node(
    expiration_time: _human_input_form_filled_event_datetime.datetime | None = None,
    *,
    status: HumanInputFormStatus = HumanInputFormStatus.TIMEOUT,
    node_id: str = "node-1",
) -> HumanInputNode:
    system_variables = build_system_variables(app_id="app", workflow_execution_id="run-1")
    graph_runtime_state = RuntimeState(
        workflow_id="workflow",
        variable_pool=VariablePool.from_bootstrap(
            system_variables=system_variables,
            user_inputs={},
            environment_variables=[],
        ),
        start_at=0.0,
    )
    graph_init_params = InitParams(
        workflow_id="workflow",
        graph_config={"nodes": [], "edges": []},
        run_context={
            DIFY_RUN_CONTEXT_KEY: {
                "tenant_id": "tenant",
                "app_id": "app",
                "user_id": "user",
                "user_from": UserFrom.ACCOUNT,
                "invoke_from": InvokeFrom.SERVICE_API,
            }
        },
        call_depth=0,
    )

    config = {
        "id": node_id,
        "type": BuiltinNodeTypes.HUMAN_INPUT,
        "data": {
            "title": "Human Input",
            "form_content": "Please enter your name:\n\n{{#$output.name#}}",
            "inputs": [ParagraphInputConfig(output_variable_name="name").model_dump(mode="json")],
            "user_actions": [UserActionConfig(id="Accept", title="Approve").model_dump(mode="json")],
        },
    }

    fake_form = SimpleNamespace(
        id="form-1",
        rendered_content="content",
        submitted=False,
        selected_action_id=None,
        submitted_data=None,
        status=status,
        created_at=naive_utc_now(),
        expiration_time=expiration_time
        or naive_utc_now() - _human_input_form_filled_event_datetime.timedelta(minutes=1),
    )

    repo = _FakeFormRepository(fake_form)
    return _create_human_input_node(
        config=config,
        init_params=graph_init_params,
        runtime_state=graph_runtime_state,
        repo=repo,
    )


def _publish_node_events(node: HumanInputNode) -> list[AppQueueEvent]:
    return _publish_graph_events(
        _filter_human_input_events(node.run(), node=node),
        graph=Graph(root_node=node),
        runtime_state=node.runtime_state,
    )


def _filter_human_input_events(events: Iterable[EngineEvent], *, node: HumanInputNode | None = None):
    node = node or _build_node()
    return filter_engine_events(
        events,
        context=EngineEventFilterContext(
            graph=Graph(root_node=node),
            runtime_state=ReadOnlyRuntimeStateWrapper(node.runtime_state),
        ),
        filters=[HumanInputFormEventFilter(form_repository=HumanInputFormSubmissionRepository())],
    )


@pytest.mark.parametrize("event_type", [GraphEdgeTakenEvent, GraphEdgeSkippedEvent])
def test_human_input_filter_forwards_traversals_without_waiting_for_completion(event_type):
    started, _ = list(_build_node().run())
    edge = event_type(frame_id=ROOT_FRAME_ID, edge_id="human-answer", source_node_id="node-1", target_node_id="answer")
    edge_forwarded = False

    def source() -> Generator[EngineEvent]:
        yield started
        yield edge
        assert edge_forwarded, "The traversal must be forwarded before consuming more upstream events"

    events = iter(_filter_human_input_events(source()))
    assert next(events) == started
    assert next(events) == edge
    edge_forwarded = True
    assert list(events) == []


def test_form_events_keep_titles_for_interleaved_executions_of_one_node():
    node = _build_node()
    started, succeeded = list(node.run())
    first_start = started.model_copy(update={"id": "first", "node_title": "First approval"})
    second_start = started.model_copy(update={"id": "second", "node_title": "Second approval"})
    first_result = succeeded.model_copy(
        update={
            "id": "first",
            "container_id": "loop-1",
            "node_run_result": succeeded.node_run_result.model_copy(
                update={"metadata": {WorkflowNodeExecutionMetadataKey.LOOP_ID: "loop-1"}}
            ),
        }
    )
    second_result = succeeded.model_copy(
        update={
            "id": "second",
            "container_id": "iteration-2",
            "node_run_result": succeeded.node_run_result.model_copy(
                update={"metadata": {WorkflowNodeExecutionMetadataKey.ITERATION_ID: "iteration-2"}}
            ),
        }
    )

    filtered = list(_filter_human_input_events([first_start, second_start, second_result, first_result], node=node))
    form_events = [event for event in filtered if isinstance(event, NodeRunHumanInputFormFilledEvent)]
    assert [(event.id, event.container_id, event.node_run_result.metadata) for event in form_events] == [
        ("second", "iteration-2", second_result.node_run_result.metadata),
        ("first", "loop-1", first_result.node_run_result.metadata),
    ]
    events = _publish_graph_events(filtered, graph=Graph(root_node=node), runtime_state=node.runtime_state)

    filled = [event for event in events if isinstance(event, QueueHumanInputFormFilledEvent)]
    assert [(event.form_id, event.node_title) for event in filled] == [
        ("second", "Second approval"),
        ("first", "First approval"),
    ]
    completed = [event for event in events if isinstance(event, QueueNodeSucceededEvent)]
    assert [(event.node_execution_id, event.in_loop_id, event.in_iteration_id) for event in completed] == [
        ("second", None, "iteration-2"),
        ("first", "loop-1", None),
    ]


class _EventQueue(AppQueueManager):
    """Record events and replay a finite stream without starting a watchdog."""

    def __init__(self, invoke_from: InvokeFrom, runtime_state: RuntimeState) -> None:
        self.invoke_from = invoke_from
        self.graph_runtime_state = runtime_state
        self.events: list[AppQueueEvent] = []

    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        assert pub_from in {PublishFrom.APPLICATION_MANAGER, PublishFrom.TASK_PIPELINE}
        self.events.append(event)

    def listen(self) -> Generator[WorkflowQueueMessage]:
        for event in self.events:
            yield WorkflowQueueMessage(task_id="task-1", app_mode=AppMode.ADVANCED_CHAT, event=event)


def _publish_graph_events(
    events: Iterable[EngineEvent], *, graph: Graph, runtime_state: RuntimeState
) -> list[AppQueueEvent]:
    queue_manager = _EventQueue(InvokeFrom.WEB_APP, runtime_state)
    runner = WorkflowBasedAppRunner(queue_manager=queue_manager, app_id="app")
    workflow_entry = WorkflowEntry(
        graph_config={},
        graph=graph,
        call_depth=0,
        graph_runtime_state=runtime_state,
    )
    for event in events:
        runner.handle_event(workflow_entry, event)
    return queue_manager.events


def _sse_payloads(
    events: Sequence[AppQueueEvent],
    invoke_from: InvokeFrom,
    app: Flask,
    sessions: sessionmaker[Session],
    runtime_state: RuntimeState | None = None,
) -> list[dict[str, Any]]:
    generate_entity = AdvancedChatAppGenerateEntity(
        task_id="task-1",
        app_config=WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            workflow_id="workflow",
        ),
        inputs={},
        query="hello",
        files=[],
        user_id="user",
        stream=True,
        invoke_from=invoke_from,
        workflow_run_id="run-1",
    )
    if runtime_state is None:
        runtime_state = RuntimeState(
            workflow_id="workflow",
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id="run-1")
            ),
            start_at=0,
        )
    queue_manager = _EventQueue(invoke_from, runtime_state)
    queue_manager.events.extend(events)
    with sessions.begin() as session:
        session.add(
            make_message(
                app_id="app",
                inputs={},
                query="hello",
                message={},
                answer="",
                status=MessageStatus.PAUSED,
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                total_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
            )
        )
        has_form = session.scalar(select(HumanInputForm.id).where(HumanInputForm.workflow_run_id == "run-1"))
    if has_form is None:
        for event in events:
            if isinstance(event, QueueHumanInputFormFilledEvent):
                _persist_form(
                    sessions,
                    form_id=event.form_id,
                    app_id="app",
                    node_id=event.node_id,
                    expiration_time=naive_utc_now() + _human_input_form_filled_event_datetime.timedelta(days=1),
                    status=HumanInputFormStatus.SUBMITTED,
                )
    pipeline = AdvancedChatAppGenerateTaskPipeline(
        application_generate_entity=generate_entity,
        workflow=WorkflowSnapshot(id="workflow", tenant_id="tenant", features_dict={}),
        queue_manager=queue_manager,
        conversation=ConversationSnapshot(id="conversation-1", mode=AppMode.ADVANCED_CHAT),
        message=MessageSnapshot(
            id="message-1", query="hello", created_at=naive_utc_now(), status=MessageStatus.PAUSED, answer=""
        ),
        user=Account(name="tester", email="tester@example.com"),
        stream=True,
        dialogue_count=1,
        draft_var_saver_factory=MagicMock(),
    )
    with app.test_request_context():
        if not any(isinstance(event, QueueWorkflowStartedEvent) for event in events):
            list(
                pipeline._handle_workflow_started_event(
                    QueueWorkflowStartedEvent(reason=WorkflowStartReason.RESUMPTION)
                )
            )
        response = compact_generate_response(
            BaseAppGenerator.convert_to_event_stream(
                AdvancedChatAppGenerateResponseConverter.convert(
                    pipeline._to_stream_response(pipeline._process_stream_response()), invoke_from
                )
            )
        )
        assert response.mimetype == "text/event-stream"
        return [
            json.loads(line.removeprefix("data: ")) for line in response.get_data(as_text=True).splitlines() if line
        ]


@pytest.mark.parametrize("invoke_from", [InvokeFrom.DEBUGGER, InvokeFrom.WEB_APP], ids=["full", "simple"])
def test_submitted_human_input_reaches_response_stream(
    invoke_from: InvokeFrom, app: Flask, sqlite_session_factory: sessionmaker[Session]
):
    events = _publish_node_events(_build_node())

    payloads = _sse_payloads(events, invoke_from, app, sqlite_session_factory)

    # Dify's original HumanInputNode (9c339239850) emitted the form event
    # before node completion; its runner and task pipeline preserved that order.
    assert [payload["event"] for payload in payloads] == [
        "node_started",
        "human_input_form_filled",
        "node_finished",
    ]
    payload = payloads[1]
    assert payload["workflow_run_id"] == "run-1"
    assert payload["data"]["form_id"] == "00000000-0000-4000-8000-000000000001"
    assert payload["data"]["node_id"] == "node-1"
    assert payload["data"]["node_title"] == "Human Input"
    assert payload["data"]["action_id"] == "Accept"
    assert payload["data"]["action_text"] == "Approve"
    assert payload["data"]["rendered_content"] == (
        "Please enter your name:\n\nAlice\nDecision: approve\nAttachment: [file]\nAttachments: [1 files]"
    )
    submitted_data = payload["data"]["submitted_data"]
    assert submitted_data["name"] == "Alice"
    assert submitted_data["decision"] == "approve"
    assert submitted_data["attachment"]["filename"] == "resume.pdf"
    assert submitted_data["attachment"]["type"] == "document"
    assert submitted_data["attachment"]["transfer_method"] == "remote_url"
    assert submitted_data["attachments"][0]["filename"] == "a.png"
    assert submitted_data["attachments"][0]["type"] == "image"


def test_button_only_human_input_reaches_response_stream(app: Flask, sqlite_session_factory: sessionmaker[Session]):
    events = _publish_node_events(_build_node("Approve deployment?", with_inputs=False))

    payloads = _sse_payloads(events, InvokeFrom.WEB_APP, app, sqlite_session_factory)

    assert [payload["event"] for payload in payloads] == [
        "node_started",
        "human_input_form_filled",
        "node_finished",
    ]
    assert payloads[1]["data"]["rendered_content"] == "Approve deployment?"
    assert payloads[1]["data"]["submitted_data"] == {}
    assert payloads[1]["data"]["action_id"] == "Accept"


@pytest.mark.parametrize("status", [HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.WAITING])
def test_timed_out_human_input_reaches_response_stream(
    status: HumanInputFormStatus, sqlite_session_factory: sessionmaker[Session], app: Flask
):
    expiration_time = _human_input_form_filled_event_datetime.datetime(2025, 1, 1)
    for form_id, expiration in (
        ("previous-execution", _human_input_form_filled_event_datetime.datetime(2024, 1, 1)),
        ("00000000-0000-4000-8000-000000000001", expiration_time),
    ):
        _persist_form(
            sqlite_session_factory,
            form_id=form_id,
            app_id="app",
            node_id="node-1",
            expiration_time=expiration,
            status=status,
        )

    events = _publish_node_events(_build_timeout_node(expiration_time, status=status))

    payloads = _sse_payloads(events, InvokeFrom.WEB_APP, app, sqlite_session_factory)
    assert [payload["event"] for payload in payloads] == [
        "node_started",
        "human_input_form_timeout",
        "node_finished",
    ]
    assert payloads[1]["data"] == {
        "form_id": "00000000-0000-4000-8000-000000000001",
        "node_id": "node-1",
        "node_title": "Human Input",
        "expiration_time": 1735689600,
    }


@pytest.mark.parametrize("timed_out", [False, True])
@pytest.mark.parametrize("terminal", ["end", "answer"])
def test_human_input_completion_and_referenced_answer_reach_response_stream(
    timed_out: bool, terminal: str, mocker: MockerFixture, app: Flask, sqlite_session_factory: sessionmaker[Session]
):
    expiration_time = _human_input_form_filled_event_datetime.datetime(2025, 1, 1)
    node = (
        _build_timeout_node(expiration_time, node_id="human")
        if timed_out
        else _build_node("Approve?", with_inputs=False, node_id="human")
    )
    runtime_state = node.runtime_state
    runtime_state.variable_pool.add(["sys", "workflow_execution_id"], StringSegment(value="run-1"))
    init_params = InitParams(workflow_id="workflow", graph_config={}, run_context={}, call_depth=0)
    start = StartNode(
        node_id="start",
        data=StartNodeData(title="Start", variables=[]),
        init_params=init_params,
        runtime_state=runtime_state,
    )
    if terminal == "answer":
        terminal_node = AnswerNode(
            node_id="answer",
            data=AnswerNodeData(title="Answer", answer="Action: {{#human.__action_id#}}"),
            init_params=init_params,
            runtime_state=runtime_state,
        )
    else:
        terminal_node = EndNode(
            node_id="end",
            data=EndNodeData(title="End", outputs=[]),
            init_params=init_params,
            runtime_state=runtime_state,
        )
    graph = (
        Graph.new()
        .add_root(start)
        .add_node(node, from_node_id="start")
        .add_node(terminal_node, from_node_id=node.id, source_handle="__timeout" if timed_out else "Accept")
        .build()
    )
    engine = Engine(
        graph=graph,
        runtime_state=runtime_state,
        command_channel=InMemoryChannel(),
        workers=1,
    )
    bind_execution_id = node.bind_execution_id

    def bind_form(execution_id: str) -> None:
        bind_execution_id(execution_id)
        _persist_form(
            sqlite_session_factory,
            form_id=execution_id,
            app_id="app",
            node_id=node.id,
            expiration_time=expiration_time,
            status=HumanInputFormStatus.TIMEOUT if timed_out else HumanInputFormStatus.SUBMITTED,
        )

    mocker.patch.object(node, "bind_execution_id", side_effect=bind_form)

    events = _publish_graph_events(iter_dify_graph_engine_events(engine), graph=graph, runtime_state=runtime_state)
    payloads = _sse_payloads(events, InvokeFrom.WEB_APP, app, sqlite_session_factory, runtime_state)

    form_event = "human_input_form_timeout" if timed_out else "human_input_form_filled"
    lifecycle_events = [payload for payload in payloads if payload["event"] != "message"]
    assert [(payload["event"], payload.get("data", {}).get("node_id")) for payload in lifecycle_events] == [
        ("workflow_started", None),
        ("node_started", "start"),
        ("node_finished", "start"),
        ("node_started", node.id),
        (form_event, node.id),
        ("node_finished", node.id),
        ("node_started", terminal),
        ("node_finished", terminal),
        ("message_end", None),
        ("workflow_finished", None),
    ]
    answer = "".join(payload["answer"] for payload in payloads if payload["event"] == "message")
    expected_answer = "Action: " + ("" if timed_out else "Accept")
    assert answer == (expected_answer if terminal == "answer" else "")
    assert payloads[-1]["data"]["status"] == "succeeded"


@pytest.mark.parametrize("form_owner", [None, ("other-app", "node-1"), ("app", "other-node")])
def test_timeout_rejects_missing_or_unrelated_form(
    form_owner: tuple[str, str] | None, sqlite_session_factory: sessionmaker[Session]
):
    if form_owner is not None:
        app_id, node_id = form_owner
        _persist_form(
            sqlite_session_factory,
            form_id="00000000-0000-4000-8000-000000000001",
            app_id=app_id,
            node_id=node_id,
            expiration_time=_human_input_form_filled_event_datetime.datetime(2025, 1, 1),
            status=HumanInputFormStatus.TIMEOUT,
        )

    with pytest.raises(ValueError, match="Cannot resolve timed-out human input form"):
        _publish_node_events(_build_timeout_node())
