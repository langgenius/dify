from copy import deepcopy

import pytest
from sqlalchemy import select

from core.agent.cot_chat_agent_runner import CotChatAgentRunner
from core.agent.fc_agent_runner import FunctionCallAgentRunner
from core.model_manager import ModelInstance
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMUsage,
    TextPromptMessageContent,
    ToolPromptMessage,
)
from models.model import MessageAgentThought
from services.agent.message_history import AgentMessageHistory
from services.workflow_run_agg import WorkflowRunAgg


@pytest.mark.usefixtures("agent_runtime_app")
@pytest.mark.parametrize("mode", ["blocking", "streaming", "react"])
def test_tool_rounds_and_persisted_history_preserve_model_messages(
    mode, sqlite_session, agent_records, agent_generate_entity, agent_queue_manager, monkeypatch
):
    conversation, message = agent_records
    app_config = agent_generate_entity.app_config
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
    requests = []

    def invoke(**kwargs):
        requests.append(deepcopy(kwargs["prompt_messages"]))
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

    rows = sqlite_session.scalars(select(MessageAgentThought).order_by(MessageAgentThought.position)).all()
    restored = [item for row in rows for item in AgentMessageHistory.model_validate_json(row.model_messages).messages]
    assert [item for item in restored if isinstance(item, AssistantPromptMessage)] == replies
    if mode != "react":
        assert [item.tool_call_id for item in restored if isinstance(item, ToolPromptMessage)] == [
            "original-0",
            "original-1",
        ]
    runner.message = deepcopy(message)
    runner.message.id = "next-message"
    history = runner.organize_agent_history([], session=sqlite_session)
    assert [item for item in history if isinstance(item, AssistantPromptMessage)] == replies


def test_history_keeps_empty_tool_results_and_completes_interrupted_calls():
    assistant = AssistantPromptMessage(
        opaque_body=False,
        tool_calls=[
            AssistantPromptMessage.ToolCall(
                id="original",
                type="function",
                function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="lookup", arguments="{}"),
            )
        ],
    )
    history = AgentMessageHistory(provider="p", model="m", messages=[assistant])
    restored = AgentMessageHistory.model_validate_json(history.model_dump_json()).restore(provider="p", model="m")
    assert restored[0] == assistant
    assert restored[1].tool_call_id == "original"
    assert "interrupted" in restored[1].content
    history.messages.append(ToolPromptMessage(tool_call_id="original", content=""))
    assert history.restore(provider="p", model="m") == history.messages
    assert history.restore(provider="other", model="m") is None
