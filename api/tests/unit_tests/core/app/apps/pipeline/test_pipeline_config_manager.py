from types import SimpleNamespace
from unittest.mock import MagicMock

from pytest_mock import MockerFixture

import core.app.apps.pipeline.pipeline_config_manager as module
from core.app.apps.pipeline.pipeline_config_manager import PipelineConfigManager
from models.model import AppMode


def test_get_pipeline_config(mocker: MockerFixture):
    pipeline = MagicMock(tenant_id="tenant", id="pipe1")
    workflow = MagicMock(id="wf1")

    mocker.patch.object(
        module.WorkflowVariablesConfigManager,
        "convert_rag_pipeline_variable",
        return_value=["var1"],
    )
    mocker.patch.object(module, "PipelineConfig", side_effect=lambda **kwargs: SimpleNamespace(**kwargs))

    result = PipelineConfigManager.get_pipeline_config(pipeline=pipeline, workflow=workflow, start_node_id="start")

    assert result.tenant_id == "tenant"
    assert result.app_id == "pipe1"
    assert result.workflow_id == "wf1"
    assert result.app_mode == AppMode.RAG_PIPELINE
    assert result.rag_pipeline_variables == ["var1"]


def test_config_validate_filters_related_keys(mocker: MockerFixture):
    config = {
        "file_upload": {"enabled": True},
        "tts": {"enabled": True},
        "moderation": {"enabled": True},
        "extra": "drop",
    }

    mocker.patch.object(
        module.FileUploadConfigManager,
        "validate_and_set_defaults",
        return_value=(config, ["file_upload"]),
    )
    mocker.patch.object(
        module.TextToSpeechConfigManager,
        "validate_and_set_defaults",
        return_value=(config, ["tts"]),
    )
    mocker.patch.object(
        module.SensitiveWordAvoidanceConfigManager,
        "validate_and_set_defaults",
        return_value=(config, ["moderation"]),
    )

    filtered = PipelineConfigManager.config_validate("tenant", config)

    assert set(filtered.keys()) == {"file_upload", "tts", "moderation"}
