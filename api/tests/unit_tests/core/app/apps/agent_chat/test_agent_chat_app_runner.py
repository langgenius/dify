from datetime import datetime

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.agent.entities import AgentEntity
from core.app.apps.agent_chat.app_runner import AgentChatAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom
from core.moderation.base import ModerationError
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, Message


@pytest.fixture
def runner(sqlite_session: Session):
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


@pytest.fixture(autouse=True)
def _patch_create_session(mocker: MockerFixture, sqlite_session_factory: sessionmaker[Session]) -> None:
    mocker.patch("core.app.apps.agent_chat.app_runner.create_session", side_effect=sqlite_session_factory)


class TestAgentChatAppRunnerRun:
    def test_run_app_not_found(self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session):
        app_config = mocker.MagicMock(app_id="app1", tenant_id="tenant", agent=mocker.MagicMock())
        generate_entity = mocker.MagicMock(app_config=app_config, inputs={}, query="q", files=[], stream=True)

        app = sqlite_session.get(App, "app1")
        assert app is not None
        sqlite_session.delete(app)
        sqlite_session.commit()

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), mocker.MagicMock(), mocker.MagicMock(), sqlite_session)

    def test_run_moderation_error_direct_output(
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ):
        app_record = mocker.MagicMock(id="app1", tenant_id="tenant")
        app_config = mocker.MagicMock(app_id="app1", tenant_id="tenant", prompt_template=mocker.MagicMock())
        app_config.agent = mocker.MagicMock()
        generate_entity = mocker.MagicMock(
            app_config=app_config,
            inputs={},
            query="q",
            files=[],
            stream=True,
            model_conf=mocker.MagicMock(),
            conversation_id=None,
        )

        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", side_effect=ModerationError("bad"))
        mocker.patch.object(runner, "direct_output")

        runner.run(generate_entity, mocker.MagicMock(), mocker.MagicMock(), mocker.MagicMock(), sqlite_session)

        runner.direct_output.assert_called_once()

    def test_run_annotation_reply_short_circuits(
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ):
        app_record = mocker.MagicMock(id="app1", tenant_id="tenant")
        app_config = mocker.MagicMock(app_id="app1", tenant_id="tenant", prompt_template=mocker.MagicMock())
        app_config.agent = mocker.MagicMock()
        generate_entity = mocker.MagicMock(
            app_config=app_config,
            inputs={},
            query="q",
            files=[],
            stream=True,
            model_conf=mocker.MagicMock(),
            conversation_id=None,
            user_id="user",
            invoke_from=mocker.MagicMock(),
        )

        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        annotation = mocker.MagicMock(id="anno", content="answer")
        annotation_query = mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=annotation)
        mocker.patch.object(runner, "direct_output")

        queue_manager = mocker.MagicMock()
        write_session = sqlite_session
        runner.run(generate_entity, queue_manager, mocker.MagicMock(), mocker.MagicMock(), write_session)

        queue_manager.publish.assert_called_once()
        assert annotation_query.call_args.kwargs["session"] is write_session
        runner.direct_output.assert_called_once()

    def test_run_hosting_moderation_short_circuits(
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ):
        app_record = mocker.MagicMock(id="app1", tenant_id="tenant")
        app_config = mocker.MagicMock(app_id="app1", tenant_id="tenant", prompt_template=mocker.MagicMock())
        app_config.agent = mocker.MagicMock()
        generate_entity = mocker.MagicMock(
            app_config=app_config,
            inputs={},
            query="q",
            files=[],
            stream=True,
            model_conf=mocker.MagicMock(),
            conversation_id=None,
            invoke_from=mocker.MagicMock(),
            user_id="user",
        )

        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=None)
        mocker.patch.object(runner, "check_hosting_moderation", return_value=True)

        runner.run(generate_entity, mocker.MagicMock(), mocker.MagicMock(), mocker.MagicMock(), sqlite_session)

    def test_run_model_schema_missing(self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session):
        app_record = mocker.MagicMock(id="app1", tenant_id="tenant")
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

        llm_instance = mocker.MagicMock()
        llm_instance.model_type_instance.get_model_schema.return_value = None
        mocker.patch("core.app.apps.agent_chat.app_runner.ModelInstance", return_value=llm_instance)

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), mocker.MagicMock(), mocker.MagicMock(), sqlite_session)

    @pytest.mark.parametrize(
        ("mode", "expected_runner"),
        [
            (LLMMode.CHAT, "CotChatAgentRunner"),
            (LLMMode.COMPLETION, "CotCompletionAgentRunner"),
        ],
    )
    def test_run_chain_of_thought_modes(
        self,
        runner: AgentChatAppRunner,
        mocker: MockerFixture,
        mode,
        expected_runner,
        sqlite_session: Session,
    ):
        app_record = mocker.MagicMock(id="app1", tenant_id="tenant")
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
        model_schema.features = []
        model_schema.model_properties = {ModelPropertyKey.MODE: mode}

        llm_instance = mocker.MagicMock()
        llm_instance.model_type_instance.get_model_schema.return_value = model_schema
        mocker.patch("core.app.apps.agent_chat.app_runner.ModelInstance", return_value=llm_instance)

        conversation = mocker.MagicMock(id="conv")
        message = mocker.MagicMock(id="msg")

        runner_cls = mocker.MagicMock()
        mocker.patch(f"core.app.apps.agent_chat.app_runner.{expected_runner}", runner_cls)

        runner_instance = mocker.MagicMock()
        runner_cls.return_value = runner_instance
        events: list[str] = []
        runner_instance.run.side_effect = lambda **_kwargs: events.append("agent-run") or []
        mocker.patch.object(runner, "_handle_invoke_result")
        session = sqlite_session
        event.listen(session, "after_commit", lambda _session: events.append("commit"))
        original_close = session.close

        def close_session() -> None:
            events.append("close")
            original_close()

        session.close = close_session

        runner.run(generate_entity, mocker.MagicMock(), conversation, message, session)

        assert events == ["commit", "close", "commit", "close", "agent-run"]
        runner_instance.run.assert_called_once()
        runner._handle_invoke_result.assert_called_once()

    def test_run_invalid_llm_mode_raises(
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ):
        app_record = mocker.MagicMock(id="app1", tenant_id="tenant")
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
        model_schema.features = []
        model_schema.model_properties = {ModelPropertyKey.MODE: "invalid"}

        llm_instance = mocker.MagicMock()
        llm_instance.model_type_instance.get_model_schema.return_value = model_schema
        mocker.patch("core.app.apps.agent_chat.app_runner.ModelInstance", return_value=llm_instance)

        conversation = mocker.MagicMock(id="conv")
        message = mocker.MagicMock(id="msg")

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), conversation, message, sqlite_session)

    def test_run_function_calling_strategy_selected_by_features(
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ):
        app_record = mocker.MagicMock(id="app1", tenant_id="tenant")
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

        conversation = mocker.MagicMock(id="conv")
        message = mocker.MagicMock(id="msg")

        runner_cls = mocker.MagicMock()
        mocker.patch("core.app.apps.agent_chat.app_runner.FunctionCallAgentRunner", runner_cls)

        runner_instance = mocker.MagicMock()
        runner_cls.return_value = runner_instance
        runner_instance.run.return_value = []
        mocker.patch.object(runner, "_handle_invoke_result")

        runner.run(generate_entity, mocker.MagicMock(), conversation, message, sqlite_session)

        assert app_config.agent.strategy == AgentEntity.Strategy.FUNCTION_CALLING
        runner_instance.run.assert_called_once()

    def test_run_conversation_not_found(
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ):
        app_record = mocker.MagicMock(id="app1", tenant_id="tenant")
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

        conversation_record = sqlite_session.get(Conversation, "conv")
        assert conversation_record is not None
        sqlite_session.delete(conversation_record)
        sqlite_session.commit()
        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=None)
        mocker.patch.object(runner, "check_hosting_moderation", return_value=False)

        with pytest.raises(ValueError):
            runner.run(
                generate_entity,
                mocker.MagicMock(),
                mocker.MagicMock(id="conv"),
                mocker.MagicMock(id="msg"),
                sqlite_session,
            )

    def test_run_message_not_found(self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session):
        app_record = mocker.MagicMock(id="app1", tenant_id="tenant")
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

        message_record = sqlite_session.get(Message, "msg")
        assert message_record is not None
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
                mocker.MagicMock(id="conv"),
                mocker.MagicMock(id="msg"),
                sqlite_session,
            )

    def test_run_invalid_agent_strategy_raises(
        self, runner: AgentChatAppRunner, mocker: MockerFixture, sqlite_session: Session
    ):
        app_record = mocker.MagicMock(id="app1", tenant_id="tenant")
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
        model_schema.features = []
        model_schema.model_properties = {ModelPropertyKey.MODE: LLMMode.CHAT}

        llm_instance = mocker.MagicMock()
        llm_instance.model_type_instance.get_model_schema.return_value = model_schema
        mocker.patch("core.app.apps.agent_chat.app_runner.ModelInstance", return_value=llm_instance)

        conversation = mocker.MagicMock(id="conv")
        message = mocker.MagicMock(id="msg")

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), conversation, message, sqlite_session)
