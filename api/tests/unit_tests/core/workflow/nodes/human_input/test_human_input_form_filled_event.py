import datetime
from types import SimpleNamespace

from graphon.entities import GraphInitParams
from graphon.enums import BuiltinNodeTypes
from graphon.graph_events import (
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunStartedEvent,
)
from graphon.nodes.human_input.enums import HumanInputFormStatus
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.runtime import GraphRuntimeState, VariablePool

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, InvokeFrom, UserFrom
from core.workflow.node_runtime import DifyHumanInputNodeRuntime
from core.workflow.system_variables import default_system_variables
from libs.datetime_utils import naive_utc_now


class _FakeFormRepository:
    def __init__(self, form):
        self._form = form

    def get_form(self, *_args, **_kwargs):
        return self._form


def _build_node(form_content: str = "Please enter your name:\n\n{{#$output.name#}}") -> HumanInputNode:
    system_variables = default_system_variables()
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=system_variables, user_inputs={}, environment_variables=[]),
        start_at=0.0,
    )
    graph_init_params = GraphInitParams(
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
        "id": "node-1",
        "type": BuiltinNodeTypes.HUMAN_INPUT,
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
        runtime=DifyHumanInputNodeRuntime(graph_init_params.run_context),
    )


def _build_timeout_node() -> HumanInputNode:
    system_variables = default_system_variables()
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=system_variables, user_inputs={}, environment_variables=[]),
        start_at=0.0,
    )
    graph_init_params = GraphInitParams(
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
        "id": "node-1",
        "type": BuiltinNodeTypes.HUMAN_INPUT,
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
        runtime=DifyHumanInputNodeRuntime(graph_init_params.run_context),
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
