from types import SimpleNamespace
from unittest.mock import MagicMock

from core.app.apps.completion.workflow_runner import CompletionWorkflowRunner
from core.moderation.base import ModerationError
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent


def _build_app_config(dataset=None, external_tools=None, additional_features=None):
    app_config = MagicMock()
    app_config.app_id = "app1"
    app_config.tenant_id = "tenant"
    app_config.prompt_template = MagicMock()
    app_config.dataset = dataset
    app_config.external_data_variables = external_tools or []
    app_config.additional_features = additional_features
    app_config.app_model_config_dict = {"file_upload": {"image": {"enabled": True}}}
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
        inputs={"qvar": "original_query_from_input"},
        query="original_query",
        files=[],
        file_upload_config=file_upload_config,
        stream=True,
        user_id="user",
        invoke_from=MagicMock(),
        trace_manager=None,
    )


def test_workflow_runner_direct_outputs_on_input_moderation() -> None:
    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    app_record = MagicMock(id="app1", tenant_id="tenant")
    app_generate_entity = _build_generate_entity(_build_app_config())
    queue_manager = MagicMock()
    message = MagicMock(id="msg")
    runner.organize_prompt_messages = MagicMock(return_value=([], None))
    runner.moderation_for_inputs = MagicMock(side_effect=ModerationError("blocked"))
    runner.direct_output = MagicMock()

    result = runner._run_input_moderation(
        app_record=app_record,
        application_generate_entity=app_generate_entity,
        queue_manager=queue_manager,
        message=message,
    )

    assert result.stopped is True
    runner.direct_output.assert_called_once()


def test_workflow_runner_uses_low_image_detail_default() -> None:
    runner = CompletionWorkflowRunner(runtime_workflow_builder=MagicMock())
    app_generate_entity = _build_generate_entity(_build_app_config(), file_upload_config=None)

    assert runner._resolve_image_detail_config(app_generate_entity) == ImagePromptMessageContent.DETAIL.LOW
