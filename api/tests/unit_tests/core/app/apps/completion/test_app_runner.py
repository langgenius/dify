from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

import core.app.apps.completion.app_runner as module
from core.app.apps.completion.app_runner import CompletionAppRunner
from core.moderation.base import ModerationError
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent


@pytest.fixture
def runner():
    return CompletionAppRunner()


def _build_app_config(dataset=None, external_tools=None, additional_features=None):
    app_config = MagicMock()
    app_config.app_id = "app1"
    app_config.tenant_id = "tenant"
    app_config.prompt_template = MagicMock()
    app_config.dataset = dataset
    app_config.external_data_variables = external_tools or []
    app_config.additional_features = additional_features
    app_config.app_model_config_dict = {"file_upload": {"enabled": True}}
    return app_config


def _build_generate_entity(app_config, file_upload_config=None):
    model_conf = MagicMock(
        provider_model_bundle="bundle",
        model="model",
        parameters={"max_tokens": 10},
        stop=["stop"],
    )
    return SimpleNamespace(
        app_config=app_config,
        model_conf=model_conf,
        inputs={"qvar": "query_from_input"},
        query="original_query",
        files=[],
        file_upload_config=file_upload_config,
        stream=True,
        user_id="user",
        invoke_from=MagicMock(),
    )


class TestCompletionAppRunner:
    def test_run_app_not_found(self, runner, mocker: MockerFixture):
        session = mocker.MagicMock()
        session.scalar.return_value = None
        mocker.patch.object(module.db, "session", session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        with pytest.raises(ValueError):
            runner.run(app_generate_entity, MagicMock(), MagicMock())

    def test_run_moderation_error_outputs_direct(self, runner, mocker: MockerFixture):
        app_record = MagicMock(id="app1", tenant_id="tenant")

        session = mocker.MagicMock()
        session.scalar.return_value = app_record
        mocker.patch.object(module.db, "session", session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        runner.organize_prompt_messages = MagicMock(return_value=([], None))
        runner.moderation_for_inputs = MagicMock(side_effect=ModerationError("blocked"))
        runner.direct_output = MagicMock()
        runner._handle_invoke_result = MagicMock()

        runner.run(app_generate_entity, MagicMock(), MagicMock(id="msg"))

        runner.direct_output.assert_called_once()
        runner._handle_invoke_result.assert_not_called()

    def test_run_hosting_moderation_stops(self, runner, mocker: MockerFixture):
        app_record = MagicMock(id="app1", tenant_id="tenant")

        session = mocker.MagicMock()
        session.scalar.return_value = app_record
        mocker.patch.object(module.db, "session", session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        runner.organize_prompt_messages = MagicMock(return_value=([], None))
        runner.moderation_for_inputs = MagicMock(return_value=(None, app_generate_entity.inputs, "query"))
        runner.check_hosting_moderation = MagicMock(return_value=True)
        runner._handle_invoke_result = MagicMock()

        runner.run(app_generate_entity, MagicMock(), MagicMock(id="msg"))

        runner._handle_invoke_result.assert_not_called()

    def test_run_dataset_and_external_tools_flow(self, runner, mocker: MockerFixture):
        app_record = MagicMock(id="app1", tenant_id="tenant")

        session = mocker.MagicMock()
        session.scalar.return_value = app_record
        session.close = MagicMock()
        mocker.patch.object(module.db, "session", session)

        retrieve_config = MagicMock(query_variable="qvar")
        dataset_config = MagicMock(dataset_ids=["ds"], retrieve_config=retrieve_config)
        additional_features = MagicMock(show_retrieve_source=True)
        app_config = _build_app_config(
            dataset=dataset_config,
            external_tools=["tool"],
            additional_features=additional_features,
        )

        file_upload_config = MagicMock()
        file_upload_config.image_config.detail = ImagePromptMessageContent.DETAIL.HIGH

        app_generate_entity = _build_generate_entity(app_config, file_upload_config=file_upload_config)

        runner.organize_prompt_messages = MagicMock(side_effect=[(["pm1"], ["stop"]), (["pm2"], ["stop"])])
        runner.moderation_for_inputs = MagicMock(return_value=(None, app_generate_entity.inputs, "query"))
        runner.fill_in_inputs_from_external_data_tools = MagicMock(return_value=app_generate_entity.inputs)
        runner.check_hosting_moderation = MagicMock(return_value=False)
        runner.recalc_llm_max_tokens = MagicMock()
        runner._handle_invoke_result = MagicMock()

        dataset_retrieval = MagicMock()
        dataset_retrieval.retrieve.return_value = ("ctx", ["file1"])
        mocker.patch.object(module, "DatasetRetrieval", return_value=dataset_retrieval)

        model_instance = MagicMock()
        model_instance.invoke_llm.return_value = "invoke_result"
        mocker.patch.object(module, "ModelInstance", return_value=model_instance)

        runner.run(app_generate_entity, MagicMock(), MagicMock(id="msg", tenant_id="tenant"))

        dataset_retrieval.retrieve.assert_called_once()
        assert dataset_retrieval.retrieve.call_args.kwargs["query"] == "query_from_input"
        runner._handle_invoke_result.assert_called_once()

    def test_run_uses_low_image_detail_default(self, runner, mocker: MockerFixture):
        app_record = MagicMock(id="app1", tenant_id="tenant")

        session = mocker.MagicMock()
        session.scalar.return_value = app_record
        mocker.patch.object(module.db, "session", session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config, file_upload_config=None)

        runner.organize_prompt_messages = MagicMock(return_value=([], None))
        runner.moderation_for_inputs = MagicMock(return_value=(None, app_generate_entity.inputs, "query"))
        runner.check_hosting_moderation = MagicMock(return_value=True)

        runner.run(app_generate_entity, MagicMock(), MagicMock(id="msg"))

        assert (
            runner.organize_prompt_messages.call_args.kwargs["image_detail_config"]
            == ImagePromptMessageContent.DETAIL.LOW
        )
