import json

import pytest

from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.workflow.nodes.agent.message_transformer import AgentMessageTransformer
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from graphon.node_events import StreamCompletedEvent
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from services.agent.message_history import AgentMessageHistory
from services.agent.workflow_message_history import get_workflow_agent_history


@pytest.mark.usefixtures("agent_runtime_app")
@pytest.mark.parametrize("model", ["m", "different-model"])
def test_workflow_history_round_trip_is_scoped_to_conversation_node_and_model(
    model, sqlite_session, sqlite_engine, agent_records, agent_generate_entity
):
    conversation, message = agent_records
    message.workflow_run_id = "run"
    message.answer = "visible answer"
    message.answer_tokens = 1
    provider = agent_generate_entity.model_conf.provider
    messages = [
        UserPromptMessage(content="original node query"),
        AssistantPromptMessage(
            content=[TextPromptMessageContent(data="", opaque_body={"id": 9007199254740993})],
            opaque_body=False,
            tool_calls=[
                AssistantPromptMessage.ToolCall(
                    id="original-call",
                    type="function",
                    function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="lookup", arguments="{}"),
                )
            ],
        ),
        ToolPromptMessage(tool_call_id="original-call", content=""),
        AssistantPromptMessage(content="visible answer", opaque_body=0),
    ]
    history = AgentMessageHistory(provider=provider, model="m", messages=messages)
    events = list(
        AgentMessageTransformer().transform(
            messages=(
                item
                for item in [
                    ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.JSON,
                        message=ToolInvokeMessage.JsonMessage(
                            json_object={
                                "model_history": history.model_dump(mode="json"),
                                "public_value": 1,
                            }
                        ),
                    )
                ]
            ),
            tool_info={},
            parameters_for_log={},
            user_id="user",
            tenant_id="tenant",
            conversation_id=conversation.id,
            node_type=BuiltinNodeTypes.AGENT,
            node_id="agent",
            node_execution_id="execution",
        )
    )
    result = next(event.node_run_result for event in events if isinstance(event, StreamCompletedEvent))
    assert result.outputs["json"] == [{"public_value": 1}]
    WorkflowNodeExecutionModel.__table__.create(sqlite_engine, checkfirst=True)
    for index, (tenant, app, run, node) in enumerate(
        [
            ("tenant", "app1", "run", "agent"),
            ("other-tenant", "app1", "run", "agent"),
            ("tenant", "other-app", "run", "agent"),
            ("tenant", "app1", "other-run", "agent"),
            ("tenant", "app1", "run", "other-node"),
        ]
    ):
        sqlite_session.add(
            WorkflowNodeExecutionModel(
                id=f"execution-{index}",
                tenant_id=tenant,
                app_id=app,
                workflow_id="workflow",
                workflow_run_id=run,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                index=index,
                node_id=node,
                node_type="agent",
                title="Agent",
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="user",
                process_data=json.dumps(result.process_data),
            )
        )
    sqlite_session.commit()
    memory = TokenBufferMemory(
        conversation,
        ModelInstance(
            provider_model_bundle=agent_generate_entity.model_conf.provider_model_bundle,
            model=model,
        ),
    )
    restored = get_workflow_agent_history(
        memory=memory,
        tenant_id="tenant",
        app_id="app1",
        node_id="agent",
        provider=provider,
        model=model,
        message_limit=5,
    )
    assert restored == (
        messages
        if model == "m"
        else [
            UserPromptMessage(content=message.query),
            AssistantPromptMessage(content=message.answer),
        ]
    )
    assert (
        get_workflow_agent_history(
            memory=memory,
            tenant_id="other-tenant",
            app_id="app1",
            node_id="agent",
            provider=provider,
            model=model,
            message_limit=5,
        )
        == []
    )
