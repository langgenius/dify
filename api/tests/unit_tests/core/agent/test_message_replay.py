from collections.abc import Generator
from copy import deepcopy

import pytest
from sqlalchemy.orm import Session

from core.agent.cot_chat_agent_runner import CotChatAgentRunner
from core.agent.fc_agent_runner import FunctionCallAgentRunner
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity
from core.model_manager import ModelInstance
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMUsage,
    PromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
)
from models.model import Conversation, Message
from services.workflow_run_agg import WorkflowRunAgg


@pytest.mark.usefixtures("agent_runtime_app")
@pytest.mark.parametrize("mode", ["blocking", "streaming", "react"])
def test_tool_rounds_preserve_model_messages(
    mode: str,
    sqlite_session: Session,
    agent_records: tuple[Conversation, Message],
    agent_generate_entity: AgentChatAppGenerateEntity,
    agent_queue_manager: MessageBasedAppQueueManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation, message = agent_records
    app_config = agent_generate_entity.app_config
    assert isinstance(app_config, AgentChatAppConfig)
    assert app_config.agent is not None
    app_config.agent.max_iteration = 3
    runner_class = CotChatAgentRunner if mode == "react" else FunctionCallAgentRunner
    runner = runner_class(
        execution_driver=WorkflowRunAgg.run,
        session=sqlite_session,
        tenant_id=app_config.tenant_id,
        application_generate_entity=agent_generate_entity,
        conversation=conversation,
        app_config=app_config,
        model_config=agent_generate_entity.model_conf,
        config=app_config.agent,
        queue_manager=agent_queue_manager,
        message=message,
        user_id=agent_generate_entity.user_id,
        model_instance=ModelInstance(
            provider_model_bundle=agent_generate_entity.model_conf.provider_model_bundle,
            model=agent_generate_entity.model_conf.model,
        ),
    )
    runner.stream_tool_call = mode == "streaming"
    replies = []
    for index, state in enumerate(({"signature": "signed", "id": 9007199254740993}, False)):
        text = 'Thought: check\nAction: {"action":"lookup","action_input":{}}' if mode == "react" else "check"
        replies.append(
            AssistantPromptMessage(
                content=[
                    TextPromptMessageContent(data=text, opaque_body={"block": index}),
                    TextPromptMessageContent(data="", opaque_body=0),
                ],
                opaque_body=state,
                tool_calls=[]
                if mode == "react"
                else [
                    AssistantPromptMessage.ToolCall(
                        id=f"original-{index}",
                        type="function",
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="lookup", arguments="{}"),
                    )
                ],
            )
        )
    replies.append(
        AssistantPromptMessage(content='{"action":"Final Answer","action_input":"done"}' if mode == "react" else "done")
    )
    requests: list[list[PromptMessage]] = []

    def invoke(*, prompt_messages: list[PromptMessage], **_kwargs: object) -> LLMResult | Generator[LLMResultChunk]:
        requests.append(deepcopy(prompt_messages))
        reply = replies[len(requests) - 1].model_copy(deep=True)
        if mode == "blocking":
            return LLMResult(model="m", prompt_messages=[], message=reply, usage=LLMUsage.empty_usage())
        return (chunk for chunk in [LLMResultChunk(model="m", delta=LLMResultChunkDelta(index=0, message=reply))])

    monkeypatch.setattr(runner.model_instance, "invoke_llm", invoke)
    monkeypatch.setattr(runner, "_init_prompt_tools", lambda: ({}, []))
    list(runner.run(sqlite_session, message, "query", **({"inputs": {}} if mode == "react" else {})))
    assert len(requests) == 3
    assistants = [item for item in requests[-1] if isinstance(item, AssistantPromptMessage)]
    assert assistants == replies[:2]

    if mode != "react":
        assert [item.tool_call_id for item in requests[-1] if isinstance(item, ToolPromptMessage)] == [
            "original-0",
            "original-1",
        ]
