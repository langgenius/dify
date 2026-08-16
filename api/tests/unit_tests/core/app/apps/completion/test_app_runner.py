from types import SimpleNamespace
from unittest.mock import ANY, MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

import core.app.apps.completion.app_runner as module
from core.app.apps.completion.app_runner import CompletionAppRunner
from core.moderation.base import ModerationError
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
from graphon.model_runtime.entities.model_entities import ModelType
from models.model import App, AppMode, IconType

APP_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "00000000-0000-0000-0000-000000000002"


@pytest.fixture
def runner():
    return CompletionAppRunner()


def _build_app_config(dataset=None, external_tools=None, additional_features=None):
    app_config = MagicMock()
    app_config.app_id = APP_ID
    app_config.tenant_id = TENANT_ID
    app_config.prompt_template = MagicMock()
    app_config.dataset = dataset
    app_config.external_data_variables = external_tools or []
    app_config.additional_features = additional_features
    app_config.app_model_config_dict = {"file_upload": {"enabled": True}}
    return app_config


def _build_generate_entity(app_config, file_upload_config=None):
    model_conf = MagicMock(
        provider="provider",
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


def _persist_app(session: Session) -> App:
    app = App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="Completion app",
        mode=AppMode.COMPLETION,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#ffffff",
        enable_site=False,
        enable_api=False,
    )
    session.add(app)
    session.commit()
    return app


class TestCompletionAppRunner:
    def test_run_app_not_found(self, runner, mocker: MockerFixture, sqlite_session: Session):
        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        with pytest.raises(ValueError):
            runner.run(app_generate_entity, MagicMock(), MagicMock(), sqlite_session)

    def test_run_moderation_error_outputs_direct(self, runner, mocker: MockerFixture, sqlite_session: Session):
        _persist_app(sqlite_session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        runner.organize_prompt_messages = MagicMock(return_value=([], None))
        runner.moderation_for_inputs = MagicMock(side_effect=ModerationError("blocked"))
        runner.direct_output = MagicMock()
        runner._handle_invoke_result = MagicMock()

        runner.run(app_generate_entity, MagicMock(), MagicMock(id="msg"), sqlite_session)

        runner.direct_output.assert_called_once()
        runner._handle_invoke_result.assert_not_called()

    def test_run_hosting_moderation_stops(self, runner, mocker: MockerFixture, sqlite_session: Session):
        _persist_app(sqlite_session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)

        runner.organize_prompt_messages = MagicMock(return_value=([], None))
        runner.moderation_for_inputs = MagicMock(return_value=(None, app_generate_entity.inputs, "query"))
        runner.check_hosting_moderation = MagicMock(return_value=True)
        runner._handle_invoke_result = MagicMock()

        runner.run(app_generate_entity, MagicMock(), MagicMock(id="msg"), sqlite_session)

        runner._handle_invoke_result.assert_not_called()

    def test_run_dataset_and_external_tools_flow(self, runner, mocker: MockerFixture, sqlite_session: Session):
        _persist_app(sqlite_session)

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
        model_manager = MagicMock()
        model_manager.get_model_instance.return_value = model_instance
        mocker.patch.object(module.ModelManager, "for_tenant", return_value=model_manager)

        runner.run(app_generate_entity, MagicMock(), MagicMock(id="msg", tenant_id=TENANT_ID), sqlite_session)

        dataset_retrieval.retrieve.assert_called_once()
        assert dataset_retrieval.retrieve.call_args.kwargs["query"] == "query_from_input"
        runner._handle_invoke_result.assert_called_once()

    def test_run_closes_explicit_session_before_stream_consumption(
        self, runner, mocker: MockerFixture, sqlite_session: Session
    ):
        _persist_app(sqlite_session)
        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)
        queue_manager = MagicMock()

        events = []
        session = sqlite_session
        original_commit = session.commit
        original_close = session.close

        def commit_session() -> None:
            events.append("commit")
            original_commit()

        def close_session() -> None:
            events.append("close")
            original_close()

        mocker.patch.object(session, "commit", side_effect=commit_session)
        mocker.patch.object(session, "close", side_effect=close_session)
        runner.organize_prompt_messages = MagicMock(return_value=([], None))
        runner.moderation_for_inputs = MagicMock(return_value=(None, app_generate_entity.inputs, "query"))
        runner.check_hosting_moderation = MagicMock(return_value=False)
        runner.recalc_llm_max_tokens = MagicMock()
        runner._handle_invoke_result = MagicMock(side_effect=lambda invoke_result, **kwargs: list(invoke_result))

        model_instance = MagicMock()

        def invoke_stream():
            events.append("first-chunk")
            yield "chunk"

        def invoke_llm(**kwargs):
            events.append("invoke")
            return invoke_stream()

        model_instance.invoke_llm.side_effect = invoke_llm
        model_manager = MagicMock()
        model_manager.get_model_instance.return_value = model_instance
        mocker.patch.object(module.ModelManager, "for_tenant", return_value=model_manager)

        runner.run(app_generate_entity, queue_manager, MagicMock(id="msg"), session)

        assert events == ["commit", "close", "invoke", "first-chunk"]
        runner._handle_invoke_result.assert_called_once_with(
            invoke_result=ANY,
            queue_manager=queue_manager,
            stream=True,
            message_id="msg",
            user_id="user",
            tenant_id=TENANT_ID,
        )

    @pytest.mark.parametrize("stream", [False, True])
    def test_run_invokes_model_resolved_by_model_manager(
        self,
        runner,
        mocker: MockerFixture,
        sqlite_session: Session,
        stream: bool,
    ):
        _persist_app(sqlite_session)
        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config)
        app_generate_entity.stream = stream

        runner.organize_prompt_messages = MagicMock(return_value=(["prompt"], ["stop"]))
        runner.moderation_for_inputs = MagicMock(return_value=(None, app_generate_entity.inputs, "query"))
        runner.check_hosting_moderation = MagicMock(return_value=False)
        runner.recalc_llm_max_tokens = MagicMock()
        runner._handle_invoke_result = MagicMock()

        model_instance = MagicMock()
        model_instance.invoke_llm.return_value = "invoke_result"
        model_manager = MagicMock()
        model_manager.get_model_instance.return_value = model_instance
        model_manager_factory = mocker.patch.object(module.ModelManager, "for_tenant", return_value=model_manager)

        runner.run(app_generate_entity, MagicMock(), MagicMock(id="msg"), sqlite_session)

        model_manager_factory.assert_called_once_with(tenant_id=TENANT_ID)
        model_manager.get_model_instance.assert_called_once_with(
            tenant_id=TENANT_ID,
            provider="provider",
            model_type=ModelType.LLM,
            model="model",
        )
        model_instance.invoke_llm.assert_called_once_with(
            prompt_messages=["prompt"],
            model_parameters={"max_tokens": 10},
            stop=["stop"],
            stream=stream,
            request_metadata={"app_id": APP_ID},
        )

    def test_run_uses_low_image_detail_default(self, runner, mocker: MockerFixture, sqlite_session: Session):
        _persist_app(sqlite_session)

        app_config = _build_app_config()
        app_generate_entity = _build_generate_entity(app_config, file_upload_config=None)

        runner.organize_prompt_messages = MagicMock(return_value=([], None))
        runner.moderation_for_inputs = MagicMock(return_value=(None, app_generate_entity.inputs, "query"))
        runner.check_hosting_moderation = MagicMock(return_value=True)

        runner.run(app_generate_entity, MagicMock(), MagicMock(id="msg"), sqlite_session)

        assert (
            runner.organize_prompt_messages.call_args.kwargs["image_detail_config"]
            == ImagePromptMessageContent.DETAIL.LOW
        )
