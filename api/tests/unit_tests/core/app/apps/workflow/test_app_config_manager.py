import json
from unittest.mock import patch

from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType


def _app() -> App:
    return App(id="app-1", tenant_id="tenant-1", name="Workflow App", mode=AppMode.WORKFLOW)


def _workflow() -> Workflow:
    return Workflow(
        id="wf-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features=json.dumps({}),
        created_by="account-1",
    )


class TestWorkflowAppConfigManager:
    def test_get_app_config(self):
        app_model = _app()
        workflow = _workflow()

        with (
            patch(
                "core.app.apps.workflow.app_config_manager.SensitiveWordAvoidanceConfigManager.convert",
                return_value=None,
            ),
            patch(
                "core.app.apps.workflow.app_config_manager.WorkflowVariablesConfigManager.convert",
                return_value=[],
            ),
        ):
            app_config = WorkflowAppConfigManager.get_app_config(app_model, workflow)

        assert app_config.workflow_id == "wf-1"
        assert app_config.app_mode == AppMode.WORKFLOW

    def test_config_validate_filters_keys(self):
        def _add_key(key, value):
            def _inner(*args, **kwargs):
                # Support both positional and keyword arguments for config
                if "config" in kwargs:
                    config = kwargs["config"]
                elif len(args) > 0:
                    config = args[0]
                else:
                    config = {}
                config[key] = value
                return config, [key]

            return _inner

        with (
            patch(
                "core.app.apps.workflow.app_config_manager.FileUploadConfigManager.validate_and_set_defaults",
                side_effect=_add_key("file_upload", 1),
            ),
            patch(
                "core.app.apps.workflow.app_config_manager.TextToSpeechConfigManager.validate_and_set_defaults",
                side_effect=_add_key("text_to_speech", 2),
            ),
            patch(
                "core.app.apps.workflow.app_config_manager.SensitiveWordAvoidanceConfigManager.validate_and_set_defaults",
                side_effect=_add_key("sensitive_word_avoidance", 3),
            ),
        ):
            filtered = WorkflowAppConfigManager.config_validate(tenant_id="t1", config={})

        assert filtered["file_upload"] == 1
        assert filtered["text_to_speech"] == 2
        assert filtered["sensitive_word_avoidance"] == 3
