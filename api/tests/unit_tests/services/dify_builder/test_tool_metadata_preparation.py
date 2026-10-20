import pytest

from core.tools.errors import ToolProviderCredentialValidationError
from services.dify_builder.native_launch_observation import NativeLaunchObservation, begin_preparation
from services.tools import draft_tool_setup as setup

PROVIDER = "langgenius/json_process/json_process"
GRAPH = {
    "nodes": [
        {
            "id": "parse",
            "data": {"type": "tool", "provider_type": "builtin", "provider_id": PROVIDER, "tool_name": "parse"},
        }
    ]
}


def test_unavailable_tool_inventory_is_not_successfully_empty_or_uninstalled(monkeypatch):
    def unavailable(_tenant, *, on_source_error=None):
        if on_source_error:
            on_source_error("plugin_inventory")
        return []

    monkeypatch.setattr(setup, "build_tool_catalogue", unavailable)
    observation = NativeLaunchObservation()
    with observation.track():
        begin_preparation()
        with pytest.raises(ToolProviderCredentialValidationError, match="metadata service unavailable") as caught:
            setup.admit_draft_tool_setup(tenant_id="tenant", graph=GRAPH, actor_id="actor")
        assert observation.resource_for(caught.value) == ("tool", PROVIDER, "parse")


def test_successfully_empty_tool_inventory_retains_uninstalled_classification(monkeypatch):
    monkeypatch.setattr(setup, "build_tool_catalogue", lambda _tenant, **_kwargs: [])
    with pytest.raises(ToolProviderCredentialValidationError, match="not verified as installed"):
        setup.admit_draft_tool_setup(tenant_id="tenant", graph=GRAPH, actor_id="actor")


def test_partial_inventory_failure_keeps_matching_credential_free_tool_usable(monkeypatch):
    def partial(_tenant, *, on_source_error=None):
        if on_source_error:
            on_source_error("unrelated_provider")
        return [
            {
                "provider_name": PROVIDER,
                "tool_name": "parse",
                "tool_label": "JSON Parse",
                "needs_credentials": False,
                "plugin_id": "langgenius/json_process",
            }
        ]

    monkeypatch.setattr(setup, "build_tool_catalogue", partial)
    declarations = setup.prepare_tool_declarations(tenant_id="tenant", graph=GRAPH)
    assert declarations.source_unavailable is True
    assert len(declarations.tools) == 1
    setup.validate_tool_setup(tenant_id="tenant", graph=GRAPH, actor_id="actor", declarations=declarations)
