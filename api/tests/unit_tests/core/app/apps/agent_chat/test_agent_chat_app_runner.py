from collections.abc import Generator, Iterator, Mapping

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from core.agent.cot_agent_runner import CotAgentRunner
from core.agent.cot_chat_agent_runner import CotChatAgentRunner
from core.agent.cot_completion_agent_runner import CotCompletionAgentRunner
from core.agent.entities import AgentEntity
from core.agent.fc_agent_runner import FunctionCallAgentRunner
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.agent_chat.app_runner import AgentChatAppRunner
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity
from core.app.entities.queue_entities import QueueAnnotationReplyEvent, QueueLLMChunkEvent, QueueMessageEndEvent
from core.moderation.base import ModerationError
from core.moderation.input_moderation import InputModeration
from core.plugin.entities.plugin_daemon import PluginLLMNumTokensResponse
from core.plugin.impl.model import PluginModelClient
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey
from models.model import App, Conversation, Message, MessageAgentThought, MessageAnnotation


def _assert_direct_output(agent_queue_manager: MessageBasedAppQueueManager, text: str) -> None:
    messages = list(agent_queue_manager.listen())
    chunks = [item.event.chunk.delta.message.content for item in messages if isinstance(item.event, QueueLLMChunkEvent)]
    assert all(isinstance(chunk, str) for chunk in chunks)
    assert "".join(chunk for chunk in chunks if isinstance(chunk, str)) == text
    assert isinstance(messages[-1].event, QueueMessageEndEvent)
    assert messages[-1].event.llm_result is not None
    assert messages[-1].event.llm_result.message.content == text


@pytest.fixture
def runner(agent_records: tuple[Conversation, Message]) -> AgentChatAppRunner:
    assert agent_records[0].id == "conv"
    return AgentChatAppRunner()


def _records(session: Session) -> tuple[Conversation, Message]:
    conversation = session.get(Conversation, "conv")
    message = session.get(Message, "msg")
    assert conversation is not None
    assert message is not None
    return conversation, message


class TestAgentChatAppRunnerRun:
    def test_run_app_not_found(
        self,
        runner: AgentChatAppRunner,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        app = sqlite_session.get(App, "app1")
        assert app is not None
        sqlite_session.delete(app)
        sqlite_session.commit()
        conversation, message = _records(sqlite_session)

        with pytest.raises(ValueError, match="App not found"):
            runner.run(agent_generate_entity, agent_queue_manager, conversation, message, sqlite_session)

    def test_run_moderation_error_direct_output(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        def reject_input(_moderation: InputModeration, **kwargs: object) -> None:
            assert kwargs["query"] == "q"
            raise ModerationError("bad")

        monkeypatch.setattr(InputModeration, "check", reject_input)
        conversation, message = _records(sqlite_session)

        runner.run(agent_generate_entity, agent_queue_manager, conversation, message, sqlite_session)

        _assert_direct_output(agent_queue_manager, "bad")

    def test_run_annotation_reply_short_circuits(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        annotation = MessageAnnotation(
            app_id="app1",
            question="q",
            content="answer",
            account_id="user",
        )
        sqlite_session.add(annotation)
        sqlite_session.commit()
        sessions: list[Session] = []

        def query_annotation(*, session: Session, **_kwargs: object) -> MessageAnnotation | None:
            sessions.append(session)
            return session.get(MessageAnnotation, annotation.id)

        monkeypatch.setattr(runner, "query_app_annotations_to_reply", query_annotation)
        conversation, message = _records(sqlite_session)
        runner.run(agent_generate_entity, agent_queue_manager, conversation, message, sqlite_session)

        event_message = agent_queue_manager._q.get_nowait()
        assert event_message is not None
        assert isinstance(event_message.event, QueueAnnotationReplyEvent)
        assert event_message.event.message_annotation_id == annotation.id
        assert sessions == [sqlite_session]
        _assert_direct_output(agent_queue_manager, "answer")

    def test_run_hosting_moderation_short_circuits(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        def reject_hosted_input(**kwargs: object) -> bool:
            assert kwargs["tenant_id"] == "tenant"
            assert "q" in str(kwargs["text"])
            return True

        monkeypatch.setattr("core.helper.moderation.check_moderation", reject_hosted_input)
        conversation, message = _records(sqlite_session)

        runner.run(agent_generate_entity, agent_queue_manager, conversation, message, sqlite_session)

        _assert_direct_output(
            agent_queue_manager,
            "I apologize for any confusion, but I'm an AI assistant to be helpful, harmless, and honest.",
        )

    def test_run_model_schema_missing(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        monkeypatch.setattr(PluginModelClient, "get_model_schema", lambda *_args, **_kwargs: None)
        conversation, message = _records(sqlite_session)

        with pytest.raises(ValueError, match="Model schema not found"):
            runner.run(agent_generate_entity, agent_queue_manager, conversation, message, sqlite_session)

    @pytest.mark.parametrize(
        ("mode", "expected_runner"),
        [
            (LLMMode.CHAT, CotChatAgentRunner),
            (LLMMode.COMPLETION, CotCompletionAgentRunner),
        ],
    )
    @pytest.mark.usefixtures("agent_runtime_app")
    def test_run_chain_of_thought_modes(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        mode: LLMMode,
        expected_runner: type[CotAgentRunner],
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        agent_generate_entity.model_conf.mode = mode
        agent_generate_entity.model_conf.model_schema.model_properties[ModelPropertyKey.MODE] = mode
        agent_generate_entity.app_config.model.mode = mode
        agent_generate_entity.conversation_id = "conv"
        events: list[str] = []
        selected_runners: list[CotAgentRunner] = []
        daemon_calls: list[dict[str, object]] = []
        original_run = CotAgentRunner.run

        def observe_run(
            agent: CotAgentRunner, *, session: Session, message: Message, query: str, inputs: Mapping[str, str]
        ) -> Generator[LLMResultChunk, None, None]:
            assert not sqlite_session.in_transaction()
            selected_runners.append(agent)
            events.append("agent-run")
            return original_run(agent, session=session, message=message, query=query, inputs=inputs)

        def dispatch(
            _client: PluginModelClient, **kwargs: object
        ) -> Iterator[LLMResultChunk | PluginLLMNumTokensResponse]:
            path = kwargs["path"]
            assert isinstance(path, str)
            if path.endswith("/num_tokens"):
                yield PluginLLMNumTokensResponse(num_tokens=1)
                return
            assert path == "plugin/tenant/dispatch/llm/invoke"
            assert not sqlite_session.in_transaction()
            daemon_calls.append(kwargs)
            events.append("invoke")
            yield LLMResultChunk(
                model="m",
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(
                        content='Action: {"action": "Final Answer", "action_input": "answer"}'
                    ),
                    usage=LLMUsage.empty_usage(),
                ),
            )

        def record_commit(_session: Session) -> None:
            events.append("commit")

        monkeypatch.setattr(CotAgentRunner, "run", observe_run)
        monkeypatch.setattr(PluginModelClient, "_request_with_plugin_daemon_response_stream", dispatch)
        conversation, message = _records(sqlite_session)
        event.listen(sqlite_session, "after_commit", record_commit)
        try:
            runner.run(agent_generate_entity, agent_queue_manager, conversation, message, sqlite_session)
        finally:
            event.remove(sqlite_session, "after_commit", record_commit)

        assert events == ["commit", "commit", "agent-run", "commit", "invoke"]
        assert len(selected_runners) == 1
        assert type(selected_runners[0]) is expected_runner
        assert len(daemon_calls) == 1
        data = daemon_calls[0]["data"]
        assert isinstance(data, dict)
        assert data["data"]["credentials"] == {"api_key": "token"}
        assert data["data"]["provider"] == "openai"
        messages = list(agent_queue_manager.listen())
        end_events = [item.event for item in messages if isinstance(item.event, QueueMessageEndEvent)]
        assert len(end_events) == 1
        assert end_events[0].llm_result is not None
        assert end_events[0].llm_result.message.content == "answer"
        thoughts = sqlite_session.scalars(
            select(MessageAgentThought).where(MessageAgentThought.message_id == "msg")
        ).all()
        assert len(thoughts) == 1
        assert thoughts[0].answer == "answer"
        assert thoughts[0].position == 1

    def test_run_invalid_llm_mode_raises(
        self,
        runner: AgentChatAppRunner,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        # Simulate corrupt provider metadata without replacing the runtime or validated app config.
        agent_generate_entity.model_conf.model_schema.model_properties[ModelPropertyKey.MODE] = "invalid"
        conversation, message = _records(sqlite_session)
        with pytest.raises(ValueError, match="Invalid LLM mode: invalid"):
            runner.run(agent_generate_entity, agent_queue_manager, conversation, message, sqlite_session)

    @pytest.mark.parametrize("feature", [ModelFeature.TOOL_CALL, ModelFeature.MULTI_TOOL_CALL])
    @pytest.mark.parametrize("stream_tool_call", [False, True])
    @pytest.mark.usefixtures("agent_runtime_app")
    def test_run_function_calling_strategy_selected_by_features(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
        feature: ModelFeature,
        stream_tool_call: bool,
    ) -> None:
        schema = agent_generate_entity.model_conf.model_schema
        schema.features = [feature, *([ModelFeature.STREAM_TOOL_CALL] if stream_tool_call else [])]
        selected: list[FunctionCallAgentRunner] = []
        requests: list[dict[str, object]] = []
        original_run = FunctionCallAgentRunner.run

        def run_agent(
            agent: FunctionCallAgentRunner, *, session: Session, message: Message, query: str, **kwargs: object
        ) -> Generator[LLMResultChunk, None, None]:
            assert not session.in_transaction()
            selected.append(agent)
            return original_run(agent, session=session, message=message, query=query, **kwargs)

        def dispatch(_client: PluginModelClient, **kwargs: object) -> Iterator[LLMResultChunk]:
            assert not sqlite_session.in_transaction()
            assert kwargs["path"] == "plugin/tenant/dispatch/llm/invoke"
            requests.append(kwargs)
            yield LLMResultChunk(
                model="m",
                delta=LLMResultChunkDelta(
                    index=0, message=AssistantPromptMessage(content="answer"), usage=LLMUsage.empty_usage()
                ),
            )

        monkeypatch.setattr(FunctionCallAgentRunner, "run", run_agent)
        monkeypatch.setattr(PluginModelClient, "_request_with_plugin_daemon_response_stream", dispatch)
        conversation, message = _records(sqlite_session)
        runner.run(agent_generate_entity, agent_queue_manager, conversation, message, sqlite_session)

        app_config = agent_generate_entity.app_config
        assert isinstance(app_config, AgentChatAppConfig)
        assert app_config.agent is not None
        assert app_config.agent.strategy == AgentEntity.Strategy.FUNCTION_CALLING
        assert len(selected) == 1
        assert type(selected[0]) is FunctionCallAgentRunner
        assert len(requests) == 1
        data = requests[0]["data"]
        assert isinstance(data, dict)
        assert data["data"]["stream"] is stream_tool_call
        assert data["data"]["credentials"] == {"api_key": "token"}
        events = list(agent_queue_manager.listen())
        assert isinstance(events[-1].event, QueueMessageEndEvent)
        assert events[-1].event.llm_result is not None
        assert events[-1].event.llm_result.message.content == "answer\n"
        thoughts = sqlite_session.scalars(
            select(MessageAgentThought).where(MessageAgentThought.message_id == "msg")
        ).all()
        assert len(thoughts) == 1
        assert thoughts[0].answer == "answer"

    def test_run_conversation_not_found(
        self,
        runner: AgentChatAppRunner,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        conversation_record, message_record = _records(sqlite_session)
        sqlite_session.delete(conversation_record)
        sqlite_session.commit()

        with pytest.raises(ValueError, match="Conversation not found"):
            runner.run(agent_generate_entity, agent_queue_manager, conversation_record, message_record, sqlite_session)

    def test_run_message_not_found(
        self,
        runner: AgentChatAppRunner,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        conversation, message = _records(sqlite_session)
        sqlite_session.delete(message)
        sqlite_session.commit()
        with pytest.raises(ValueError, match="Message not found"):
            runner.run(agent_generate_entity, agent_queue_manager, conversation, message, sqlite_session)

    def test_run_invalid_agent_strategy_raises(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        app_config = agent_generate_entity.app_config
        assert isinstance(app_config, AgentChatAppConfig)
        agent = app_config.agent
        assert isinstance(agent, AgentEntity)
        # Fault injection after validation covers the defensive runtime branch for corrupted state.
        monkeypatch.setattr(agent, "strategy", "invalid")
        conversation, message = _records(sqlite_session)
        with pytest.raises(ValueError, match="Invalid agent strategy: invalid"):
            runner.run(agent_generate_entity, agent_queue_manager, conversation, message, sqlite_session)
