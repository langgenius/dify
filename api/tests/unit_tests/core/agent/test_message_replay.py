import json
import logging
from collections.abc import Generator
from copy import deepcopy
from typing import Literal

import pytest
from sqlalchemy import select
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
    UserPromptMessage,
)
from models.enums import CreatorUserRole
from models.model import Conversation, Message, MessageAgentThought
from services.agent.message_history import AgentMessageHistory
from services.workflow_run_agg import WorkflowRunAgg


@pytest.mark.usefixtures("agent_runtime_app")
@pytest.mark.parametrize("mode", ["blocking", "streaming", "react"])
def test_tool_rounds_and_persisted_history_preserve_model_messages(
    mode: Literal["blocking", "streaming", "react"],
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

    rows = sqlite_session.scalars(select(MessageAgentThought).order_by(MessageAgentThought.position)).all()
    restored: list[PromptMessage] = []
    for row in rows:
        assert row.model_messages is not None
        restored.extend(AgentMessageHistory.model_validate_json(row.model_messages).messages)
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


@pytest.mark.usefixtures("agent_runtime_app")
def test_invalid_persisted_model_history_falls_back_to_legacy_tool_turn(
    sqlite_session: Session,
    agent_records: tuple[Conversation, Message],
    agent_generate_entity: AgentChatAppGenerateEntity,
    agent_queue_manager: MessageBasedAppQueueManager,
    caplog: pytest.LogCaptureFixture,
) -> None:
    conversation, message = agent_records
    app_config = agent_generate_entity.app_config
    assert isinstance(app_config, AgentChatAppConfig)
    assert app_config.agent is not None
    thought = MessageAgentThought(
        message_id=message.id,
        position=1,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=agent_generate_entity.user_id,
        thought="Checking the saved result.",
        tool="lookup",
        tool_input=json.dumps({"lookup": {"city": "Boston"}}),
        observation=json.dumps({"lookup": "sunny"}),
        model_messages=json.dumps(
            {
                "provider": agent_generate_entity.model_conf.provider,
                "model": agent_generate_entity.model_conf.model,
                "messages": [
                    {"role": "assistant", "content": "Discard this", "opaque_body": {"signature": "stale"}},
                    {"role": "invalid", "content": "Corrupt message"},
                ],
            }
        ),
    )
    thought_id = thought.id
    sqlite_session.add(thought)
    sqlite_session.commit()
    next_message = deepcopy(message)
    next_message.id = "next-message"
    sqlite_session.expunge_all()

    with caplog.at_level(logging.WARNING, logger="core.agent.base_agent_runner"):
        runner = FunctionCallAgentRunner(
            execution_driver=WorkflowRunAgg.run,
            session=sqlite_session,
            tenant_id=app_config.tenant_id,
            application_generate_entity=agent_generate_entity,
            conversation=conversation,
            app_config=app_config,
            model_config=agent_generate_entity.model_conf,
            config=app_config.agent,
            queue_manager=agent_queue_manager,
            message=next_message,
            user_id=agent_generate_entity.user_id,
            model_instance=ModelInstance(
                provider_model_bundle=agent_generate_entity.model_conf.provider_model_bundle,
                model=agent_generate_entity.model_conf.model,
            ),
        )

    history = runner.history_prompt_messages
    user, assistant, observation = history
    assert user == UserPromptMessage(content=message.query)
    assert isinstance(assistant, AssistantPromptMessage)
    assert assistant.content == "Checking the saved result."
    (tool_call,) = assistant.tool_calls
    assert tool_call.function.name == "lookup"
    assert json.loads(tool_call.function.arguments) == {"city": "Boston"}
    assert observation == ToolPromptMessage(tool_call_id=tool_call.id, name="lookup", content="sunny")
    assert assistant.opaque_body is None
    assert any(
        record.name == "core.agent.base_agent_runner"
        and record.levelno == logging.WARNING
        and thought_id in record.getMessage()
        for record in caplog.records
    )


def test_history_keeps_empty_tool_results_and_completes_interrupted_calls() -> None:
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
    assert restored is not None
    assert restored[0] == assistant
    assert isinstance(restored[1], ToolPromptMessage)
    assert restored[1].tool_call_id == "original"
    assert isinstance(restored[1].content, str)
    assert "interrupted" in restored[1].content
    history.messages.append(ToolPromptMessage(tool_call_id="original", content=""))
    assert history.restore(provider="p", model="m") == history.messages
    assert history.restore(provider="other", model="m") is None
