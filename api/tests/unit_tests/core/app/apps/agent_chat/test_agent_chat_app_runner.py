import pytest
from pytest_mock import MockerFixture

from core.agent.entities import AgentEntity
from core.app.apps.agent_chat.app_runner import AgentChatAppRunner
from core.moderation.base import ModerationError
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey


@pytest.fixture
def runner():
    return AgentChatAppRunner()


class TestAgentChatAppRunnerRun:
    def test_run_app_not_found(self, runner, mocker: MockerFixture):
        app_config = mocker.MagicMock(app_id="app1", tenant_id="tenant", agent=mocker.MagicMock())
        generate_entity = mocker.MagicMock(app_config=app_config, inputs={}, query="q", files=[], stream=True)

        mocker.patch("core.app.apps.agent_chat.app_runner.db.session.scalar", return_value=None)

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), mocker.MagicMock(), mocker.MagicMock())

    def test_run_moderation_error_direct_output(self, runner, mocker: MockerFixture):
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

        mocker.patch("core.app.apps.agent_chat.app_runner.db.session.scalar", return_value=app_record)
        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", side_effect=ModerationError("bad"))
        mocker.patch.object(runner, "direct_output")

        runner.run(generate_entity, mocker.MagicMock(), mocker.MagicMock(), mocker.MagicMock())

        runner.direct_output.assert_called_once()

    def test_run_annotation_reply_short_circuits(self, runner, mocker: MockerFixture):
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

        mocker.patch("core.app.apps.agent_chat.app_runner.db.session.scalar", return_value=app_record)
        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        annotation = mocker.MagicMock(id="anno", content="answer")
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=annotation)
        mocker.patch.object(runner, "direct_output")

        queue_manager = mocker.MagicMock()
        runner.run(generate_entity, queue_manager, mocker.MagicMock(), mocker.MagicMock())

        queue_manager.publish.assert_called_once()
        runner.direct_output.assert_called_once()

    def test_run_hosting_moderation_short_circuits(self, runner, mocker: MockerFixture):
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

        mocker.patch("core.app.apps.agent_chat.app_runner.db.session.scalar", return_value=app_record)
        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=None)
        mocker.patch.object(runner, "check_hosting_moderation", return_value=True)

        runner.run(generate_entity, mocker.MagicMock(), mocker.MagicMock(), mocker.MagicMock())

    def test_run_model_schema_missing(self, runner, mocker: MockerFixture):
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

        mocker.patch("core.app.apps.agent_chat.app_runner.db.session.scalar", return_value=app_record)
        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=None)
        mocker.patch.object(runner, "check_hosting_moderation", return_value=False)

        llm_instance = mocker.MagicMock()
        llm_instance.model_type_instance.get_model_schema.return_value = None
        mocker.patch("core.app.apps.agent_chat.app_runner.ModelInstance", return_value=llm_instance)

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), mocker.MagicMock(), mocker.MagicMock())

    @pytest.mark.parametrize(
        ("mode", "expected_runner"),
        [
            (LLMMode.CHAT, "CotChatAgentRunner"),
            (LLMMode.COMPLETION, "CotCompletionAgentRunner"),
        ],
    )
    def test_run_chain_of_thought_modes(self, runner, mocker: MockerFixture, mode, expected_runner):
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

        mocker.patch("core.app.apps.agent_chat.app_runner.db.session.scalar", return_value=app_record)
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
        mocker.patch(
            "core.app.apps.agent_chat.app_runner.db.session.scalar",
            side_effect=[app_record, conversation, message],
        )

        runner_cls = mocker.MagicMock()
        mocker.patch(f"core.app.apps.agent_chat.app_runner.{expected_runner}", runner_cls)

        runner_instance = mocker.MagicMock()
        runner_cls.return_value = runner_instance
        runner_instance.run.return_value = []
        mocker.patch.object(runner, "_handle_invoke_result")

        runner.run(generate_entity, mocker.MagicMock(), conversation, message)

        runner_instance.run.assert_called_once()
        runner._handle_invoke_result.assert_called_once()

    def test_run_invalid_llm_mode_raises(self, runner, mocker: MockerFixture):
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

        mocker.patch("core.app.apps.agent_chat.app_runner.db.session.scalar", return_value=app_record)
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
        mocker.patch(
            "core.app.apps.agent_chat.app_runner.db.session.scalar",
            side_effect=[app_record, conversation, message],
        )

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), conversation, message)

    def test_run_function_calling_strategy_selected_by_features(self, runner, mocker: MockerFixture):
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

        mocker.patch("core.app.apps.agent_chat.app_runner.db.session.scalar", return_value=app_record)
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
        mocker.patch(
            "core.app.apps.agent_chat.app_runner.db.session.scalar",
            side_effect=[app_record, conversation, message],
        )

        runner_cls = mocker.MagicMock()
        mocker.patch("core.app.apps.agent_chat.app_runner.FunctionCallAgentRunner", runner_cls)

        runner_instance = mocker.MagicMock()
        runner_cls.return_value = runner_instance
        runner_instance.run.return_value = []
        mocker.patch.object(runner, "_handle_invoke_result")

        runner.run(generate_entity, mocker.MagicMock(), conversation, message)

        assert app_config.agent.strategy == AgentEntity.Strategy.FUNCTION_CALLING
        runner_instance.run.assert_called_once()

    def test_run_conversation_not_found(self, runner, mocker: MockerFixture):
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

        mocker.patch(
            "core.app.apps.agent_chat.app_runner.db.session.scalar",
            side_effect=[app_record, None],
        )
        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=None)
        mocker.patch.object(runner, "check_hosting_moderation", return_value=False)

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), mocker.MagicMock(id="conv"), mocker.MagicMock(id="msg"))

    def test_run_message_not_found(self, runner, mocker: MockerFixture):
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

        mocker.patch(
            "core.app.apps.agent_chat.app_runner.db.session.scalar",
            side_effect=[app_record, mocker.MagicMock(id="conv"), None],
        )
        mocker.patch.object(runner, "organize_prompt_messages", return_value=([], None))
        mocker.patch.object(runner, "moderation_for_inputs", return_value=(None, {}, "q"))
        mocker.patch.object(runner, "query_app_annotations_to_reply", return_value=None)
        mocker.patch.object(runner, "check_hosting_moderation", return_value=False)

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), mocker.MagicMock(id="conv"), mocker.MagicMock(id="msg"))

    def test_run_invalid_agent_strategy_raises(self, runner, mocker: MockerFixture):
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

        mocker.patch("core.app.apps.agent_chat.app_runner.db.session.scalar", return_value=app_record)
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
        mocker.patch(
            "core.app.apps.agent_chat.app_runner.db.session.scalar",
            side_effect=[app_record, conversation, message],
        )

        with pytest.raises(ValueError):
            runner.run(generate_entity, mocker.MagicMock(), conversation, message)
