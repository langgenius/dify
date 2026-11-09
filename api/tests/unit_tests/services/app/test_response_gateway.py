"""Response gateway behavior at the app service boundary."""

from machinery.context import RequestContext
from models.model import AppMode
from services.app.response_gateway import AppResponseGateway
from services.entities.app_entities import AppRecord


def test_mask_record_omits_unverified_tool_parameters_without_mutating_record() -> None:
    agent_mode = {
        "enabled": True,
        "tools": [
            {
                "provider_type": "invalid",
                "provider_id": "provider",
                "tool_name": "tool",
                "tool_parameters": {"api_key": "secret"},
            }
        ],
    }
    app = AppRecord(
        id="app",
        name="Agent",
        mode_compatible_with_agent=AppMode.AGENT_CHAT,
        app_model_config={"agent_mode": agent_mode},
    )
    context = RequestContext("request", None, "account", "tenant")

    masked = AppResponseGateway.mask_record(context, app)

    assert masked is not app
    assert masked.app_model_config is not None
    assert masked.app_model_config["agent_mode"]["tools"][0]["tool_parameters"] == {}
    assert agent_mode["tools"][0]["tool_parameters"] == {"api_key": "secret"}
