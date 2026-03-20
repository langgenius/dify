from __future__ import annotations

from collections.abc import Generator
from datetime import UTC, datetime
from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.workflow.nodes.agent.agent_node import AgentNode
from core.workflow.nodes.agent.clarification_helper import AgentClarificationHelper
from core.workflow.nodes.agent.message_transformer import AgentMessageTransformer
from dify_graph.entities.graph_init_params import GraphInitParams
from dify_graph.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from dify_graph.graph_events import NodeRunPauseRequestedEvent, NodeRunSucceededEvent
from dify_graph.node_events import StreamCompletedEvent
from dify_graph.nodes.human_input.enums import HumanInputFormStatus
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable


class _FakeFormEntity:
    id = "form-1"
    web_app_token = "token-1"
    recipients = []
    rendered_content = "Please provide the missing customer id.\n\n- `customer_id`: {{#$output.customer_id#}}"
    selected_action_id = None
    submitted_data = None
    submitted = False
    status = HumanInputFormStatus.WAITING
    expiration_time = datetime(2030, 1, 1, tzinfo=UTC)


class _FakeFormRepository:
    def __init__(self) -> None:
        self.last_params = None

    def get_form(self, workflow_execution_id: str, node_id: str):
        return None

    def create_form(self, params):
        self.last_params = params
        return _FakeFormEntity()


class _FakeStrategy:
    def __init__(self, messages: list[ToolInvokeMessage]) -> None:
        self._messages = messages

    def get_parameters(self):
        return []

    def invoke(
        self,
        *,
        params: dict[str, Any],
        user_id: str,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
        credentials: object | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        _ = (params, user_id, conversation_id, app_id, message_id, credentials)
        yield from self._messages


class _FakeStrategyResolver:
    def __init__(self, strategy: _FakeStrategy) -> None:
        self._strategy = strategy

    def resolve(
        self,
        *,
        tenant_id: str,
        agent_strategy_provider_name: str,
        agent_strategy_name: str,
    ) -> _FakeStrategy:
        _ = (tenant_id, agent_strategy_provider_name, agent_strategy_name)
        return self._strategy


class _FakePresentationProvider:
    def get_icon(self, *, tenant_id: str, agent_strategy_provider_name: str) -> str:
        _ = (tenant_id, agent_strategy_provider_name)
        return "icon.svg"


class _FakeRuntimeSupport:
    def build_parameters(self, *, for_log: bool = False, **_: Any) -> dict[str, Any]:
        return {"query": "Need clarification"} if for_log else {"query": "Need clarification"}

    def build_credentials(self, *, parameters: dict[str, Any]) -> object:
        _ = parameters
        return object()


def _build_agent_node(
    *,
    messages: list[ToolInvokeMessage],
    form_repository: _FakeFormRepository,
) -> AgentNode:
    graph_config: dict[str, Any] = {
        "nodes": [
            {
                "id": "agent-node",
                "data": {
                    "type": BuiltinNodeTypes.AGENT,
                    "title": "Agent Node",
                    "desc": "",
                    "agent_strategy_provider_name": "provider",
                    "agent_strategy_name": "strategy",
                    "agent_strategy_label": "Strategy",
                    "agent_parameters": {},
                },
            }
        ],
        "edges": [],
    }
    init_params = GraphInitParams(
        workflow_id="workflow-id",
        graph_config=graph_config,
        run_context={
            "_dify": {
                "tenant_id": "tenant-id",
                "app_id": "app-id",
                "user_id": "user-id",
                "user_from": "account",
                "invoke_from": "debugger",
            }
        },
        call_depth=0,
    )
    variable_pool = VariablePool(
        system_variables=SystemVariable(
            user_id="user-id",
            app_id="app-id",
            workflow_execution_id="workflow-run-id",
        )
    )
    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)
    clarification_helper = AgentClarificationHelper(form_repository_factory=lambda _tenant_id: form_repository)
    return AgentNode(
        id="agent-node",
        config=graph_config["nodes"][0],
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
        strategy_resolver=_FakeStrategyResolver(_FakeStrategy(messages)),
        presentation_provider=_FakePresentationProvider(),
        runtime_support=_FakeRuntimeSupport(),
        message_transformer=AgentMessageTransformer(clarification_helper=clarification_helper),
    )


def test_agent_node_clarification_payload_pauses_workflow() -> None:
    form_repository = _FakeFormRepository()
    node = _build_agent_node(
        form_repository=form_repository,
        messages=[
            ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT,
                message=ToolInvokeMessage.TextMessage(text="Need more context. "),
            ),
            ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.JSON,
                message=ToolInvokeMessage.JsonMessage(
                    json_object={
                        "human_required": {
                            "question": "Please provide the missing customer id.",
                            "required_fields": ["customer_id"],
                            "display_in_ui": True,
                        },
                        "execution_metadata": {
                            "total_tokens": 12,
                            "total_price": 0,
                            "currency": "USD",
                        },
                    }
                ),
            ),
        ],
    )

    events = list(node.run())

    pause_event = next(event for event in events if isinstance(event, NodeRunPauseRequestedEvent))
    assert pause_event.node_run_result.status == WorkflowNodeExecutionStatus.PAUSED
    assert pause_event.reason.form_id == "form-1"
    assert pause_event.reason.node_id == "agent-node"
    assert pause_event.node_run_result.outputs["text"] == "Need more context. "
    assert pause_event.node_run_result.outputs["clarification"]["question"] == "Please provide the missing customer id."
    assert pause_event.node_run_result.outputs["clarification"]["agent_strategy"] == "strategy"
    assert pause_event.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.PAUSE_INFO]["form_id"] == "form-1"
    assert form_repository.last_params is not None
    assert form_repository.last_params.workflow_execution_id == "workflow-run-id"
    assert form_repository.last_params.node_id == "agent-node"
    assert form_repository.last_params.backstage_recipient_required is True
    assert not any(isinstance(event, NodeRunSucceededEvent) for event in events)


def test_message_transformer_keeps_success_path_without_clarification_payload() -> None:
    transformer = AgentMessageTransformer(
        clarification_helper=AgentClarificationHelper(form_repository_factory=lambda _tenant_id: _FakeFormRepository())
    )

    events = list(
        transformer.transform(
            messages=iter(
                [
                    ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.TEXT,
                        message=ToolInvokeMessage.TextMessage(text="Final answer"),
                    ),
                    ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.JSON,
                        message=ToolInvokeMessage.JsonMessage(
                            json_object={
                                "answer": {"ok": True},
                                "execution_metadata": {
                                    "total_tokens": 9,
                                    "total_price": 0,
                                    "currency": "USD",
                                },
                            }
                        ),
                    ),
                ]
            ),
            tool_info={"icon": "icon.svg", "agent_strategy": "strategy"},
            parameters_for_log={"query": "Need clarification"},
            user_id="user-id",
            tenant_id="tenant-id",
            app_id="app-id",
            workflow_execution_id="workflow-run-id",
            node_type=BuiltinNodeTypes.AGENT,
            node_id="agent-node",
            node_title="Agent Node",
            node_execution_id="exec-1",
        )
    )

    completed_event = events[-1]
    assert isinstance(completed_event, StreamCompletedEvent)
    assert completed_event.node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert completed_event.node_run_result.outputs["text"] == "Final answer"
    assert "clarification" not in completed_event.node_run_result.outputs
    assert completed_event.node_run_result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 9
