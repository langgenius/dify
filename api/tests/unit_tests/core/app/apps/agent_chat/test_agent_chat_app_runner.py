from collections.abc import Generator, Iterator, Mapping
from datetime import datetime

import pytest
from flask import Flask
from pytest_mock import MockerFixture
from redis import Redis
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.agent.cot_agent_runner import CotAgentRunner
from core.agent.cot_chat_agent_runner import CotChatAgentRunner
from core.agent.cot_completion_agent_runner import CotCompletionAgentRunner
from core.agent.entities import AgentEntity, AgentPromptEntity
from core.app.app_config.entities import EasyUIBasedAppModelConfigFrom, ModelConfigEntity, PromptTemplateEntity
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.agent_chat.app_runner import AgentChatAppRunner
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import QueueAnnotationReplyEvent, QueueLLMChunkEvent, QueueMessageEndEvent
from core.entities.provider_entities import CustomProviderConfiguration
from core.moderation.base import ModerationError
from core.moderation.input_moderation import InputModeration
from core.plugin.entities.plugin_daemon import PluginLLMNumTokensResponse
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from graphon.model_runtime.entities.llm_entities import LLMMode, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, Message, MessageAgentThought, MessageAnnotation
from tests.unit_tests.core.model_fixtures import make_model_config

PROVIDER = "langgenius/openai/openai"


@pytest.fixture
def queue_manager(monkeypatch: pytest.MonkeyPatch) -> Iterator[MessageBasedAppQueueManager]:
    """Use the production queue and Redis wrapper; isolate only Redis commands."""
    with Redis() as client:
        monkeypatch.setattr(client, "execute_command", lambda *_args, **_kwargs: None)
        redis = RedisClientWrapper()
        redis.initialize(client)
        monkeypatch.setattr("core.app.apps.base_app_queue_manager.redis_client", redis)
        monkeypatch.setattr("core.plugin.impl.model_runtime.redis_client", redis)
        yield MessageBasedAppQueueManager(
            task_id="task",
            user_id="user",
            invoke_from=InvokeFrom.SERVICE_API,
            conversation_id="conv",
            app_mode=AppMode.AGENT_CHAT,
            message_id="msg",
        )


@pytest.fixture
def agent_app(sqlite_engine: Engine) -> Iterator[Flask]:
    """Bind production agent-thought writes to the same SQLite database as setup reads."""
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = sqlite_engine.url
    db.init_app(app)
    with app.app_context():
        try:
            yield app
        finally:
            db.engine.dispose()


@pytest.fixture
def generate_entity(monkeypatch: pytest.MonkeyPatch) -> AgentChatAppGenerateEntity:
    model_config = make_model_config(provider=PROVIDER, model="m", mode=LLMMode.CHAT)
    model_config.credentials = {"api_key": "token"}
    model_config.model_schema.model_properties = {ModelPropertyKey.MODE: LLMMode.CHAT}
    bundle = model_config.provider_model_bundle
    bundle.configuration.tenant_id = "tenant"
    bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(
        credentials=model_config.credentials
    )
    bundle.model_type_instance = LargeLanguageModel(
        provider_schema=bundle.configuration.provider, model_runtime=create_plugin_model_runtime(tenant_id="tenant")
    )
    monkeypatch.setattr(PluginModelClient, "get_model_schema", lambda *_args, **_kwargs: model_config.model_schema)
    return AgentChatAppGenerateEntity(
        task_id="task",
        app_config=AgentChatAppConfig(
            app_id="app1",
            tenant_id="tenant",
            app_mode=AppMode.AGENT_CHAT,
            app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
            app_model_config_dict={},
            model=ModelConfigEntity(provider=PROVIDER, model="m", mode=LLMMode.CHAT),
            prompt_template=PromptTemplateEntity(
                prompt_type=PromptTemplateEntity.PromptType.SIMPLE, simple_prompt_template="Help the user."
            ),
            agent=AgentEntity(
                provider=PROVIDER,
                model="m",
                strategy=AgentEntity.Strategy.CHAIN_OF_THOUGHT,
                prompt=AgentPromptEntity(
                    first_prompt=(
                        "{{instruction}} {{tools}} {{tool_names}} {{historic_messages}} {{query}} {{agent_scratchpad}}"
                    ),
                    next_iteration="continue",
                ),
            ),
        ),
        model_conf=model_config,
        inputs={},
        query="q",
        files=[],
        stream=True,
        user_id="user",
        invoke_from=InvokeFrom.SERVICE_API,
    )


def _assert_direct_output(queue_manager: MessageBasedAppQueueManager, text: str) -> None:
    messages = list(queue_manager.listen())
    chunks = [item.event.chunk.delta.message.content for item in messages if isinstance(item.event, QueueLLMChunkEvent)]
    assert all(isinstance(chunk, str) for chunk in chunks)
    assert "".join(chunk for chunk in chunks if isinstance(chunk, str)) == text
    assert isinstance(messages[-1].event, QueueMessageEndEvent)
    assert messages[-1].event.llm_result is not None
    assert messages[-1].event.llm_result.message.content == text


@pytest.fixture
def runner(sqlite_session: Session) -> AgentChatAppRunner:
    app = App(
        id="app1",
        tenant_id="tenant",
        name="Agent chat app",
        description="",
        mode=AppMode.AGENT_CHAT,
        enable_site=False,
        enable_api=False,
    )
    conversation = Conversation(
        id="conv",
        app_id=app.id,
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.AGENT_CHAT,
        name="Conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=None,
        from_account_id="user",
    )
    message = Message(
        id="msg",
        app_id=app.id,
        conversation_id=conversation.id,
        inputs={},
        query="q",
        message={},
        message_tokens=0,
        message_unit_price=0,
        message_price_unit=0,
        answer="",
        answer_tokens=0,
        answer_unit_price=0,
        answer_price_unit=0,
        provider_response_latency=0,
        total_price=0,
        currency="USD",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=None,
        from_account_id="user",
        app_mode=AppMode.AGENT_CHAT,
        created_at=datetime(2025, 1, 1),
    )
    sqlite_session.add_all([app, conversation, message])
    sqlite_session.commit()
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
        generate_entity: AgentChatAppGenerateEntity,
        queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        app = sqlite_session.get(App, "app1")
        assert app is not None
        sqlite_session.delete(app)
        sqlite_session.commit()
        conversation, message = _records(sqlite_session)

        with pytest.raises(ValueError, match="App not found"):
            runner.run(generate_entity, queue_manager, conversation, message, sqlite_session)

    def test_run_moderation_error_direct_output(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        generate_entity: AgentChatAppGenerateEntity,
        queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        def reject_input(_moderation: InputModeration, **kwargs: object) -> None:
            assert kwargs["query"] == "q"
            raise ModerationError("bad")

        monkeypatch.setattr(InputModeration, "check", reject_input)
        conversation, message = _records(sqlite_session)

        runner.run(generate_entity, queue_manager, conversation, message, sqlite_session)

        _assert_direct_output(queue_manager, "bad")

    def test_run_annotation_reply_short_circuits(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        generate_entity: AgentChatAppGenerateEntity,
        queue_manager: MessageBasedAppQueueManager,
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
        runner.run(generate_entity, queue_manager, conversation, message, sqlite_session)

        event_message = queue_manager._q.get_nowait()
        assert event_message is not None
        assert isinstance(event_message.event, QueueAnnotationReplyEvent)
        assert event_message.event.message_annotation_id == annotation.id
        assert sessions == [sqlite_session]
        _assert_direct_output(queue_manager, "answer")

    def test_run_hosting_moderation_short_circuits(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        generate_entity: AgentChatAppGenerateEntity,
        queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        def reject_hosted_input(**kwargs: object) -> bool:
            assert kwargs["tenant_id"] == "tenant"
            assert "q" in str(kwargs["text"])
            return True

        monkeypatch.setattr("core.helper.moderation.check_moderation", reject_hosted_input)
        conversation, message = _records(sqlite_session)

        runner.run(generate_entity, queue_manager, conversation, message, sqlite_session)

        _assert_direct_output(
            queue_manager, "I apologize for any confusion, but I'm an AI assistant to be helpful, harmless, and honest."
        )

    def test_run_model_schema_missing(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        generate_entity: AgentChatAppGenerateEntity,
        queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        monkeypatch.setattr(PluginModelClient, "get_model_schema", lambda *_args, **_kwargs: None)
        conversation, message = _records(sqlite_session)

        with pytest.raises(ValueError, match="Model schema not found"):
            runner.run(generate_entity, queue_manager, conversation, message, sqlite_session)

    @pytest.mark.parametrize(
        ("mode", "expected_runner"),
        [
            (LLMMode.CHAT, CotChatAgentRunner),
            (LLMMode.COMPLETION, CotCompletionAgentRunner),
        ],
    )
    @pytest.mark.usefixtures("agent_app")
    def test_run_chain_of_thought_modes(
        self,
        runner: AgentChatAppRunner,
        monkeypatch: pytest.MonkeyPatch,
        mode: LLMMode,
        expected_runner: type[CotAgentRunner],
        sqlite_session: Session,
        generate_entity: AgentChatAppGenerateEntity,
        queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        generate_entity.model_conf.mode = mode
        generate_entity.model_conf.model_schema.model_properties[ModelPropertyKey.MODE] = mode
        generate_entity.app_config.model.mode = mode
        generate_entity.conversation_id = "conv"
        events: list[str] = []
        selected_runners: list[CotAgentRunner] = []
        daemon_calls: list[dict[str, object]] = []
        original_run = CotAgentRunner.run

        def observe_run(
            agent: CotAgentRunner, *, session: Session, message: Message, query: str, inputs: Mapping[str, str]
        ) -> Generator[LLMResultChunk]:
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
            runner.run(generate_entity, queue_manager, conversation, message, sqlite_session)
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
        messages = list(queue_manager.listen())
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
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ) -> None:
        app_config = mocker.MagicMock(app_id="app1", tenant_id="tenant", prompt_template=mocker.MagicMock())
        app_config.agent = AgentEntity(provider="p", model="m", strategy=AgentEntity.Strategy.CHAIN_OF_THOUGHT)

        generate_entity = mocker.MagicMock(
            app_config=app_config,
            inputs={},
            query="q",
            files=[],
            stream=True,
            model_conf=mocker.MagicMock(
                provider_model_bundle=mocker.MagicMock(),
                model="m",
                provider="p",
                credentials={"k": "v"},
            ),
            conversation_id="conv",
            invoke_from=mocker.MagicMock(),
            user_id="user",
        )

        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=None)
        mocker.patch.object(runner, "check_hosting_moderation", return_value=False)

        model_schema = mocker.MagicMock()
        model_schema.features = list[ModelFeature]()
        model_schema.model_properties = {ModelPropertyKey.MODE: "invalid"}

        llm_instance = mocker.MagicMock()
        llm_instance.model_type_instance.get_model_schema.return_value = model_schema
        mocker.patch("core.app.apps.agent_chat.app_runner.ModelInstance", return_value=llm_instance)

        conversation, message = _records(sqlite_session)

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), conversation, message, sqlite_session)

    def test_run_function_calling_strategy_selected_by_features(
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ) -> None:
        app_config = mocker.MagicMock(app_id="app1", tenant_id="tenant", prompt_template=mocker.MagicMock())
        app_config.agent = AgentEntity(provider="p", model="m", strategy=AgentEntity.Strategy.CHAIN_OF_THOUGHT)

        generate_entity = mocker.MagicMock(
            app_config=app_config,
            inputs={},
            query="q",
            files=[],
            stream=True,
            model_conf=mocker.MagicMock(
                provider_model_bundle=mocker.MagicMock(),
                model="m",
                provider="p",
                credentials={"k": "v"},
            ),
            conversation_id="conv",
            invoke_from=mocker.MagicMock(),
            user_id="user",
        )

        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=None)
        mocker.patch.object(runner, "check_hosting_moderation", return_value=False)

        model_schema = mocker.MagicMock()
        model_schema.features = [ModelFeature.TOOL_CALL]
        model_schema.model_properties = {ModelPropertyKey.MODE: LLMMode.CHAT}

        llm_instance = mocker.MagicMock()
        llm_instance.model_type_instance.get_model_schema.return_value = model_schema
        mocker.patch("core.app.apps.agent_chat.app_runner.ModelInstance", return_value=llm_instance)

        conversation, message = _records(sqlite_session)

        runner_cls = mocker.MagicMock()
        mocker.patch("core.app.apps.agent_chat.app_runner.FunctionCallAgentRunner", runner_cls)

        runner_instance = mocker.MagicMock()
        runner_cls.return_value = runner_instance
        runner_instance.run.return_value = list[LLMResultChunk]()
        mocker.patch.object(runner, "_handle_invoke_result")

        runner.run(generate_entity, mocker.MagicMock(), conversation, message, sqlite_session)

        assert app_config.agent.strategy == AgentEntity.Strategy.FUNCTION_CALLING
        runner_instance.run.assert_called_once()

    def test_run_conversation_not_found(
        self,
        runner: AgentChatAppRunner,
        sqlite_session: Session,
        generate_entity: AgentChatAppGenerateEntity,
        queue_manager: MessageBasedAppQueueManager,
    ) -> None:
        conversation_record, message_record = _records(sqlite_session)
        sqlite_session.delete(conversation_record)
        sqlite_session.commit()

        with pytest.raises(ValueError, match="Conversation not found"):
            runner.run(generate_entity, queue_manager, conversation_record, message_record, sqlite_session)

    def test_run_message_not_found(
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ) -> None:
        app_config = mocker.MagicMock(app_id="app1", tenant_id="tenant", prompt_template=mocker.MagicMock())
        app_config.agent = AgentEntity(provider="p", model="m", strategy=AgentEntity.Strategy.FUNCTION_CALLING)

        generate_entity = mocker.MagicMock(
            app_config=app_config,
            inputs={},
            query="q",
            files=[],
            stream=True,
            model_conf=mocker.MagicMock(
                provider_model_bundle=mocker.MagicMock(),
                model="m",
                provider="p",
                credentials={"k": "v"},
            ),
            conversation_id="conv",
            invoke_from=mocker.MagicMock(),
            user_id="user",
        )

        conversation_record, message_record = _records(sqlite_session)
        sqlite_session.delete(message_record)
        sqlite_session.commit()
        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=None)
        mocker.patch.object(runner, "check_hosting_moderation", return_value=False)

        with pytest.raises(ValueError):
            runner.run(
                generate_entity,
                mocker.MagicMock(),
                conversation_record,
                message_record,
                sqlite_session,
            )

    def test_run_invalid_agent_strategy_raises(
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ) -> None:
        app_config = mocker.MagicMock(app_id="app1", tenant_id="tenant", prompt_template=mocker.MagicMock())
        app_config.agent = mocker.MagicMock(strategy="invalid", provider="p", model="m")

        generate_entity = mocker.MagicMock(
            app_config=app_config,
            inputs={},
            query="q",
            files=[],
            stream=True,
            model_conf=mocker.MagicMock(
                provider_model_bundle=mocker.MagicMock(),
                model="m",
                provider="p",
                credentials={"k": "v"},
            ),
            conversation_id="conv",
            invoke_from=mocker.MagicMock(),
            user_id="user",
        )

        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=None)
        mocker.patch.object(runner, "check_hosting_moderation", return_value=False)

        model_schema = mocker.MagicMock()
        model_schema.features = list[ModelFeature]()
        model_schema.model_properties = {ModelPropertyKey.MODE: LLMMode.CHAT}

        llm_instance = mocker.MagicMock()
        llm_instance.model_type_instance.get_model_schema.return_value = model_schema
        mocker.patch("core.app.apps.agent_chat.app_runner.ModelInstance", return_value=llm_instance)

        conversation, message = _records(sqlite_session)

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), conversation, message, sqlite_session)
