from collections.abc import Callable
from unittest.mock import patch

from core.app.apps.workflow.app_config_manager import WorkflowAppConfigManager
from models.model import App, AppMode
from models.workflow import Workflow
from tests.helpers.unit.model_factories import make_app, make_workflow


def _app() -> App:
    return make_app(name="Workflow App", mode=AppMode.WORKFLOW, icon_type=None)


def _workflow() -> Workflow:
    return make_workflow(workflow_id="wf-1", graph="{}")


class TestWorkflowAppConfigManager:
    def test_get_app_config(self) -> None:
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

    def test_config_validate_filters_keys(self) -> None:
        def _add_key(key: str, value: object) -> Callable[..., tuple[dict[str, object], list[str]]]:
            def _inner(config: dict[str, object], **_: object) -> tuple[dict[str, object], list[str]]:
                # Support both positional and keyword arguments for config
                return {**config, key: value}, [key]

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
