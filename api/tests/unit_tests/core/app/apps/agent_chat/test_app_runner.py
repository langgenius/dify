from collections.abc import Generator, Iterator, Mapping
from unittest.mock import create_autospec

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.agent.entities import AgentEntity
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity
from core.app.entities.queue_entities import QueueAnnotationReplyEvent, QueueLLMChunkEvent, QueueMessageEndEvent
from core.moderation.base import ModerationError
from core.moderation.input_moderation import InputModeration
from core.plugin.entities.plugin_daemon import PluginLLMNumTokensResponse
from core.plugin.impl.model import PluginModelClient
from extensions.application_services.workflow import WorkflowExecutionDependencies
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey
from models.annotation_reply import AnnotationReplies
from models.model import App, Conversation, Message, MessageAgentThought, MessageAnnotation
from repositories.app.generation_repository import AppGenerationRepository
from services.agent.chat.cot_chat_runner import CotChatAgentRunner
from services.agent.chat.cot_completion_runner import CotCompletionAgentRunner
from services.agent.chat.cot_runner import CotAgentRunner
from services.agent.chat.function_call_runner import FunctionCallAgentRunner
from services.agent.chat.ports import AgentToolInvoker
from services.app.generation.adapters.agent_chat_runner import AgentChatAppRunner


def _assert_direct_output(agent_queue_manager: MessageBasedAppQueueManager, text: str) -> None:
    messages = list(agent_queue_manager.listen())
    chunks = [item.event.chunk.delta.message.content for item in messages if isinstance(item.event, QueueLLMChunkEvent)]
    assert all(isinstance(chunk, str) for chunk in chunks)
    assert "".join(chunk for chunk in chunks if isinstance(chunk, str)) == text
    assert isinstance(messages[-1].event, QueueMessageEndEvent)
    assert messages[-1].event.llm_result is not None
    assert messages[-1].event.llm_result.message.content == text


@pytest.fixture
def runner(
    agent_records: tuple[Conversation, Message],
    *,
    app_records: AppGenerationRepository,
    workflow_runtime: WorkflowExecutionDependencies,
) -> AgentChatAppRunner:
    assert agent_records[0].id == "conv"
    return AgentChatAppRunner(
        dataset_tools=workflow_runtime.dataset_tools,
        records=app_records,
        tool_invoker=create_autospec(AgentToolInvoker, instance=True, spec_set=True),
    )


def _runtime_records(session: Session) -> tuple[App, Conversation, Message]:
    app = session.get(App, "app1")
    conversation = session.get(Conversation, "conv")
    message = session.get(Message, "msg")
    assert app is not None
    assert conversation is not None
    assert message is not None
    session.expunge_all()
    session.rollback()
    return app, conversation, message


class TestAgentChatAppRunnerRun:
    def test_run_moderation_error_direct_output(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
        annotation_replies: AnnotationReplies,
    ) -> None:
        def reject_input(_moderation: InputModeration, **kwargs: object) -> None:
            assert kwargs["query"] == "q"
            raise ModerationError("bad")

        monkeypatch.setattr(InputModeration, "check", reject_input)
        app, conversation, message = _runtime_records(sqlite_session)

        runner.run(
            agent_generate_entity,
            agent_queue_manager,
            conversation,
            message,
            app_record=app,
            annotations=annotation_replies,
        )

        _assert_direct_output(agent_queue_manager, "bad")

    def test_run_annotation_reply_short_circuits(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
        annotation_replies: AnnotationReplies,
    ) -> None:
        annotation = MessageAnnotation(
            app_id="app1",
            question="q",
            content="answer",
            account_id="user",
        )
        sqlite_session.add(annotation)
        sqlite_session.commit()
        calls: list[dict[str, object]] = []

        def query_annotation(**kwargs: object) -> MessageAnnotation:
            calls.append(kwargs)
            return annotation

        monkeypatch.setattr(annotation_replies, "query", query_annotation)
        app, conversation, message = _runtime_records(sqlite_session)
        runner.run(
            agent_generate_entity,
            agent_queue_manager,
            conversation,
            message,
            app_record=app,
            annotations=annotation_replies,
        )

        event_message = agent_queue_manager._q.get_nowait()
        assert event_message is not None
        assert isinstance(event_message.event, QueueAnnotationReplyEvent)
        assert event_message.event.message_annotation_id == annotation.id
        assert calls[0]["tenant_id"] == "tenant"
        assert calls[0]["app_id"] == "app1"
        assert calls[0]["message_id"] == "msg"
        assert calls[0]["query"] == "q"
        assert calls[0]["user_id"] == "user"
        _assert_direct_output(agent_queue_manager, "answer")

    def test_run_hosting_moderation_short_circuits(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
        annotation_replies: AnnotationReplies,
    ) -> None:
        def reject_hosted_input(**kwargs: object) -> bool:
            assert kwargs["tenant_id"] == "tenant"
            assert "q" in str(kwargs["text"])
            return True

        monkeypatch.setattr("core.helper.moderation.check_moderation", reject_hosted_input)
        app, conversation, message = _runtime_records(sqlite_session)

        runner.run(
            agent_generate_entity,
            agent_queue_manager,
            conversation,
            message,
            app_record=app,
            annotations=annotation_replies,
        )

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
        annotation_replies: AnnotationReplies,
    ) -> None:
        monkeypatch.setattr(PluginModelClient, "get_model_schema", lambda *_args, **_kwargs: None)
        app, conversation, message = _runtime_records(sqlite_session)

        with pytest.raises(ValueError, match="Model schema not found"):
            runner.run(
                agent_generate_entity,
                agent_queue_manager,
                conversation,
                message,
                app_record=app,
                annotations=annotation_replies,
            )

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
        annotation_replies: AnnotationReplies,
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
            agent: CotAgentRunner, *, message: Message, query: str, inputs: Mapping[str, str]
        ) -> Generator[LLMResultChunk]:
            assert not sqlite_session.in_transaction()
            selected_runners.append(agent)
            events.append("agent-run")
            return original_run(agent, message=message, query=query, inputs=inputs)

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

        monkeypatch.setattr(CotAgentRunner, "run", observe_run)
        monkeypatch.setattr(PluginModelClient, "_request_with_plugin_daemon_response_stream", dispatch)
        app, conversation, message = _runtime_records(sqlite_session)
        runner.run(
            agent_generate_entity,
            agent_queue_manager,
            conversation,
            message,
            app_record=app,
            annotations=annotation_replies,
        )

        assert events == ["agent-run", "invoke"]
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
        annotation_replies: AnnotationReplies,
    ) -> None:
        agent_generate_entity.model_conf.model_schema.model_properties[ModelPropertyKey.MODE] = "invalid"
        app, conversation, message = _runtime_records(sqlite_session)
        with pytest.raises(ValueError, match="Invalid LLM mode: invalid"):
            runner.run(
                agent_generate_entity,
                agent_queue_manager,
                conversation,
                message,
                app_record=app,
                annotations=annotation_replies,
            )

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
        annotation_replies: AnnotationReplies,
        feature: ModelFeature,
        stream_tool_call: bool,
    ) -> None:
        schema = agent_generate_entity.model_conf.model_schema
        schema.features = [feature, *([ModelFeature.STREAM_TOOL_CALL] if stream_tool_call else [])]
        selected: list[FunctionCallAgentRunner] = []
        requests: list[dict[str, object]] = []
        original_run = FunctionCallAgentRunner.run

        def run_agent(
            agent: FunctionCallAgentRunner, *, message: Message, query: str, **kwargs: object
        ) -> Generator[LLMResultChunk]:
            assert not sqlite_session.in_transaction()
            selected.append(agent)
            return original_run(agent, message=message, query=query, **kwargs)

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
        app, conversation, message = _runtime_records(sqlite_session)
        runner.run(
            agent_generate_entity,
            agent_queue_manager,
            conversation,
            message,
            app_record=app,
            annotations=annotation_replies,
        )

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

    def test_run_invalid_agent_strategy_raises(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
        annotation_replies: AnnotationReplies,
    ) -> None:
        app_config = agent_generate_entity.app_config
        assert isinstance(app_config, AgentChatAppConfig)
        agent = app_config.agent
        assert isinstance(agent, AgentEntity)
        monkeypatch.setattr(agent, "strategy", "invalid")
        app, conversation, message = _runtime_records(sqlite_session)
        with pytest.raises(ValueError, match="Invalid agent strategy: invalid"):
            runner.run(
                agent_generate_entity,
                agent_queue_manager,
                conversation,
                message,
                app_record=app,
                annotations=annotation_replies,
            )
