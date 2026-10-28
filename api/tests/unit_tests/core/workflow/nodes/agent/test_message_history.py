import json
from collections.abc import Callable, Sequence
from datetime import timedelta
from typing import Literal

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.plugin.impl.model import PluginModelClient
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.workflow.nodes.agent.message_transformer import AgentMessageTransformer
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from graphon.node_events import StreamCompletedEvent
from models.enums import CreatorUserRole
from models.model import Conversation, Message
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from services.agent.message_history import AgentMessageHistory
from services.agent.workflow_message_history import get_workflow_agent_history


@pytest.mark.usefixtures("agent_runtime_app")
@pytest.mark.parametrize("model", ["m", "different-model"])
def test_workflow_history_round_trip_is_scoped_to_conversation_node_and_model(
    model: str,
    sqlite_session: Session,
    sqlite_engine: Engine,
    agent_records: tuple[Conversation, Message],
    agent_generate_entity: AgentChatAppGenerateEntity,
) -> None:
    conversation, message = agent_records
    message.workflow_run_id = "run"
    message.answer = "visible answer"
    message.answer_tokens = 1
    provider = agent_generate_entity.model_conf.provider
    messages: list[PromptMessage] = [
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
    WorkflowNodeExecutionModel.metadata.tables[WorkflowNodeExecutionModel.__tablename__].create(
        sqlite_engine, checkfirst=True
    )
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


@pytest.mark.usefixtures("agent_runtime_app")
@pytest.mark.parametrize("strategy", ["function_calling", "react"])
@pytest.mark.parametrize(
    ("max_token_limit", "plugin_counting", "retained"),
    [
        pytest.param(None, True, "latest", id="default-budget"),
        pytest.param(1599, True, "none", id="oversized-latest-turn"),
        pytest.param(None, False, "all", id="disabled-token-counting"),
    ],
)
def test_workflow_history_budget_preserves_database_turns(
    strategy: Literal["function_calling", "react"],
    max_token_limit: int | None,
    plugin_counting: bool,
    retained: Literal["latest", "none", "all"],
    sqlite_session: Session,
    sqlite_engine: Engine,
    agent_records: tuple[Conversation, Message],
    agent_generate_entity: AgentChatAppGenerateEntity,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(PLUGIN_BASED_TOKEN_COUNTING_ENABLED=plugin_counting)
    conversation, older = agent_records
    older.answer = "older answer"
    older.answer_tokens = 1
    latest = Message(
        id="latest-message",
        app_id=older.app_id,
        conversation_id=conversation.id,
        parent_message_id=older.id,
        workflow_run_id="latest-run",
        inputs={},
        query="latest query",
        message={},
        message_unit_price=0,
        answer="latest answer",
        answer_tokens=1,
        answer_unit_price=0,
        currency="USD",
        from_source=older.from_source,
        created_at=older.created_at + timedelta(seconds=1),
    )
    provider = agent_generate_entity.model_conf.provider
    tool_call = AssistantPromptMessage.ToolCall(
        id="lookup-call",
        type="function",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="lookup", arguments="{}"),
    )
    messages: list[PromptMessage] = [
        UserPromptMessage(content=latest.query),
        AssistantPromptMessage(
            content=[TextPromptMessageContent(data="thought", opaque_body={"id": 9007199254740993})],
            opaque_body=False,
            tool_calls=[tool_call] if strategy == "function_calling" else [],
        ),
        ToolPromptMessage(tool_call_id=tool_call.id, content="")
        if strategy == "function_calling"
        else UserPromptMessage(content="Observation: lookup result"),
        AssistantPromptMessage(content=latest.answer, opaque_body=0),
    ]
    history = AgentMessageHistory(provider=provider, model="m", messages=messages)
    WorkflowNodeExecutionModel.metadata.tables[WorkflowNodeExecutionModel.__tablename__].create(
        sqlite_engine, checkfirst=True
    )
    sqlite_session.add_all(
        [
            latest,
            WorkflowNodeExecutionModel(
                id="latest-execution",
                tenant_id="tenant",
                app_id=older.app_id,
                workflow_id="workflow",
                workflow_run_id=latest.workflow_run_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                index=0,
                node_id="agent",
                node_type="agent",
                title="Agent",
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="user",
                process_data=json.dumps({"model_history": history.model_dump(mode="json")}),
            ),
        ]
    )
    sqlite_session.commit()
    memory = TokenBufferMemory(
        conversation,
        ModelInstance(provider_model_bundle=agent_generate_entity.model_conf.provider_model_bundle, model="m"),
    )
    if plugin_counting:

        def count_tokens(prompt_messages: Sequence[PromptMessage]) -> int:
            return 400 * len(prompt_messages)

        monkeypatch.setattr(memory.model_instance, "get_llm_num_tokens", count_tokens)
    else:

        def reject_token_request(*_args: object, **_kwargs: object) -> None:
            pytest.fail("Disabled token counting must not invoke the provider")

        monkeypatch.setattr(PluginModelClient, "get_llm_num_tokens", reject_token_request)

    budget = {} if max_token_limit is None else {"max_token_limit": max_token_limit}
    restored = get_workflow_agent_history(
        memory=memory,
        tenant_id="tenant",
        app_id=older.app_id,
        node_id="agent",
        provider=provider,
        model="m",
        message_limit=5,
        **budget,
    )
    expected: dict[str, list[PromptMessage]] = {
        "latest": messages,
        "none": [],
        "all": [UserPromptMessage(content=older.query), AssistantPromptMessage(content=older.answer), *messages],
    }
    assert restored == expected[retained]
