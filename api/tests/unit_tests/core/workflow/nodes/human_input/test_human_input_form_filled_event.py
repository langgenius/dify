import datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.graph_init_params import GraphInitParams
from core.workflow.enums import NodeType
from core.workflow.graph_events import (
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunStartedEvent,
)
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input.human_input_node import HumanInputNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from libs.datetime_utils import naive_utc_now
from models.enums import UserFrom


class _FakeFormRepository:
    def __init__(self, form):
        self._form = form

    def get_form(self, *_args, **_kwargs):
        return self._form


def _build_node(form_content: str = "Please enter your name:\n\n{{#$output.name#}}") -> HumanInputNode:
    system_variables = SystemVariable.default()
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=system_variables, user_inputs={}, environment_variables=[]),
        start_at=0.0,
    )
    graph_init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config={"nodes": [], "edges": []},
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )

    config = {
        "id": "node-1",
        "type": NodeType.HUMAN_INPUT.value,
        "data": {
            "title": "Human Input",
            "form_content": form_content,
            "inputs": [
                {
                    "type": "text_input",
                    "output_variable_name": "name",
                    "default": {"type": "constant", "value": ""},
                }
            ],
            "user_actions": [
                {
                    "id": "Accept",
                    "title": "Approve",
                    "button_style": "default",
                }
            ],
        },
    }

    fake_form = SimpleNamespace(
        id="form-1",
        rendered_content=form_content,
        submitted=True,
        selected_action_id="Accept",
        submitted_data={"name": "Alice"},
        status=HumanInputFormStatus.SUBMITTED,
        expiration_time=naive_utc_now() + datetime.timedelta(days=1),
    )

    repo = _FakeFormRepository(fake_form)
    return HumanInputNode(
        id="node-1",
        config=config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        form_repository=repo,
    )


def _build_timeout_node() -> HumanInputNode:
    system_variables = SystemVariable.default()
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=system_variables, user_inputs={}, environment_variables=[]),
        start_at=0.0,
    )
    graph_init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config={"nodes": [], "edges": []},
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )

    config = {
        "id": "node-1",
        "type": NodeType.HUMAN_INPUT.value,
        "data": {
            "title": "Human Input",
            "form_content": "Please enter your name:\n\n{{#$output.name#}}",
            "inputs": [
                {
                    "type": "text_input",
                    "output_variable_name": "name",
                    "default": {"type": "constant", "value": ""},
                }
            ],
            "user_actions": [
                {
                    "id": "Accept",
                    "title": "Approve",
                    "button_style": "default",
                }
            ],
        },
    }

    fake_form = SimpleNamespace(
        id="form-1",
        rendered_content="content",
        submitted=False,
        selected_action_id=None,
        submitted_data=None,
        status=HumanInputFormStatus.TIMEOUT,
        expiration_time=naive_utc_now() - datetime.timedelta(minutes=1),
    )

    repo = _FakeFormRepository(fake_form)
    return HumanInputNode(
        id="node-1",
        config=config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        form_repository=repo,
    )


def test_human_input_node_emits_form_filled_event_before_succeeded():
    node = _build_node()

    events = list(node.run())

    assert isinstance(events[0], NodeRunStartedEvent)
    assert isinstance(events[1], NodeRunHumanInputFormFilledEvent)

    filled_event = events[1]
    assert filled_event.node_title == "Human Input"
    assert filled_event.rendered_content.endswith("Alice")
    assert filled_event.action_id == "Accept"
    assert filled_event.action_text == "Approve"


def test_human_input_node_emits_timeout_event_before_succeeded():
    node = _build_timeout_node()

    events = list(node.run())

    assert isinstance(events[0], NodeRunStartedEvent)
    assert isinstance(events[1], NodeRunHumanInputFormTimeoutEvent)

    timeout_event = events[1]
    assert timeout_event.node_title == "Human Input"


def test_constructor_creates_default_repository_when_none_is_provided():
    system_variables = SystemVariable.default()
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=system_variables, user_inputs={}, environment_variables=[]),
        start_at=0.0,
    )
    graph_init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config={"nodes": [], "edges": []},
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.SERVICE_API,
        call_depth=0,
    )
    config = {
        "id": "node-1",
        "type": NodeType.HUMAN_INPUT.value,
        "data": {
            "title": "Human Input",
            "inputs": [],
            "user_actions": [],
        },
    }

    with (
        patch("core.workflow.nodes.human_input.human_input_node.db", SimpleNamespace(engine="engine")),
        patch("core.workflow.nodes.human_input.human_input_node.HumanInputFormRepositoryImpl") as repo_cls,
    ):
        HumanInputNode(
            id="node-1",
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            form_repository=None,
        )

    repo_cls.assert_called_once_with(session_factory="engine", tenant_id="tenant")


def test_branch_selection_helpers_cover_variable_pool_and_default_values():
    node = _build_node()
    node._node_data = SimpleNamespace(default_value_dict={"branch": {"handle": "default-handle"}})
    node.graph_runtime_state.variable_pool.add((node.id, "branch"), " selected ")
    assert node._resolve_branch_selection() == "selected"
    node.graph_runtime_state.variable_pool.remove((node.id,))
    assert node._resolve_branch_selection() == "default-handle"

    assert HumanInputNode._extract_branch_handle(None) is None
    assert HumanInputNode._extract_branch_handle(SimpleNamespace(value=None)) is None
    assert HumanInputNode._extract_branch_handle(SimpleNamespace(to_object=lambda: {"branch": "b"})) == "b"
    assert HumanInputNode._normalize_branch_value(None) is None
    assert HumanInputNode._normalize_branch_value("  ") is None
    assert HumanInputNode._normalize_branch_value({"edgeSourceHandle": "edge-1"}) == "edge-1"


def test_console_recipient_and_ui_visibility_policies():
    node = _build_node()
    node.invoke_from = InvokeFrom.DEBUGGER
    assert node._should_require_console_recipient() is True
    assert node._display_in_ui() is True

    node.invoke_from = InvokeFrom.EXPLORE
    assert node._should_require_console_recipient() is False
    assert node._display_in_ui() is False

    node.invoke_from = InvokeFrom.SERVICE_API
    assert node._should_require_console_recipient() is False
    assert node._display_in_ui() is False


def test_human_input_required_event_requires_form_token_for_ui_display():
    node = _build_node()
    node.invoke_from = InvokeFrom.DEBUGGER
    form = SimpleNamespace(id="form-1", rendered_content="content", web_app_token=None)

    with pytest.raises(AssertionError, match="Form token"):
        node._human_input_required_event(form)


def test_run_raises_when_submitted_form_has_no_selected_action():
    node = _build_node()
    node._form_repository = _FakeFormRepository(
        SimpleNamespace(
            id="form-missing-action",
            rendered_content="content",
            submitted=True,
            selected_action_id=None,
            submitted_data={},
            status=HumanInputFormStatus.SUBMITTED,
            expiration_time=naive_utc_now() + datetime.timedelta(days=1),
        )
    )

    with pytest.raises(AssertionError, match="selected_action_id"):
        list(node._run())


def test_render_form_content_with_outputs_handles_none_and_complex_values():
    content = "none={{#$output.none#}}, obj={{#$output.obj#}}, arr={{#$output.arr#}}, text={{#$output.text#}}"
    outputs = {
        "none": None,
        "obj": {"a": 1},
        "arr": [1, 2],
        "text": "ok",
    }

    rendered = HumanInputNode.render_form_content_with_outputs(content, outputs, ["none", "obj", "arr", "text"])

    assert "none=" in rendered
    assert '"a": 1' in rendered
    assert "[1, 2]" in rendered
    assert "text=ok" in rendered


def test_extract_variable_selector_to_variable_mapping_classmethod():
    mapping = HumanInputNode._extract_variable_selector_to_variable_mapping(
        graph_config={},
        node_id="human-1",
        node_data={
            "title": "Human Input",
            "form_content": "Hello {{#start.name#}}",
            "inputs": [
                {
                    "type": "text_input",
                    "output_variable_name": "user_name",
                    "default": {"type": "variable", "selector": ["profile", "name"]},
                }
            ],
            "user_actions": [{"id": "submit", "title": "Submit"}],
        },
    )

    assert mapping["human-1.#start.name#"] == ["start", "name"]
    assert mapping["human-1.#profile.name#"] == ["profile", "name"]
