from types import SimpleNamespace
from unittest.mock import MagicMock

from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.plugin.backwards_invocation.app import PluginAppBackwardsInvocation
from models.model import AppMode


def test_invoke_chat_app_advanced_chat_injects_pause_state_config(mocker):
    workflow = MagicMock()
    workflow.created_by = "owner-id"

    app = MagicMock()
    app.mode = AppMode.ADVANCED_CHAT
    app.workflow = workflow

    mocker.patch(
        "core.plugin.backwards_invocation.app.db",
        SimpleNamespace(engine=MagicMock()),
    )
    generator_spy = mocker.patch(
        "core.plugin.backwards_invocation.app.AdvancedChatAppGenerator.generate",
        return_value={"result": "ok"},
    )

    result = PluginAppBackwardsInvocation.invoke_chat_app(
        app=app,
        user=MagicMock(),
        conversation_id="conv-1",
        query="hello",
        stream=False,
        inputs={"k": "v"},
        files=[],
    )

    assert result == {"result": "ok"}
    call_kwargs = generator_spy.call_args.kwargs
    pause_state_config = call_kwargs.get("pause_state_config")
    assert isinstance(pause_state_config, PauseStateLayerConfig)
    assert pause_state_config.state_owner_user_id == "owner-id"


def test_invoke_workflow_app_injects_pause_state_config(mocker):
    workflow = MagicMock()
    workflow.created_by = "owner-id"

    app = MagicMock()
    app.mode = AppMode.WORKFLOW
    app.workflow = workflow

    mocker.patch(
        "core.plugin.backwards_invocation.app.db",
        SimpleNamespace(engine=MagicMock()),
    )
    generator_spy = mocker.patch(
        "core.plugin.backwards_invocation.app.WorkflowAppGenerator.generate",
        return_value={"result": "ok"},
    )

    result = PluginAppBackwardsInvocation.invoke_workflow_app(
        app=app,
        user=MagicMock(),
        stream=False,
        inputs={"k": "v"},
        files=[],
    )

    assert result == {"result": "ok"}
    call_kwargs = generator_spy.call_args.kwargs
    pause_state_config = call_kwargs.get("pause_state_config")
    assert isinstance(pause_state_config, PauseStateLayerConfig)
    assert pause_state_config.state_owner_user_id == "owner-id"
