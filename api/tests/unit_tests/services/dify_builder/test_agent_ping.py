import pytest

from core.dify_builder.models import Inputs
from core.model_manager import ModelInstance
from extensions.application_services import dify_builder_cognition_policy as policy
from services.dify_builder.agent import ping
from tests.helpers.unit.core.model_fixtures import make_model_instance

MC = {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {"temperature": 0.0, "stop": ["x"]}}


def test_ping_success(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    instance = make_model_instance(provider="openai", model="gpt-4o")

    def fake_resolve(
        tenant_id: str, model_config: Inputs | None, *, account_id: str, app_id: str | None
    ) -> ModelInstance:
        assert (tenant_id, model_config, account_id, app_id) == ("t1", MC, "account", None)
        return instance

    def fake_invoke_text(
        instance: object,
        *,
        system: str,  # noqa: ARG001
        user: str,  # noqa: ARG001
        model_parameters: dict[str, object] | None = None,
        stop: list[str] | None = None,
    ) -> str:
        captured["instance"] = instance
        captured["params"] = model_parameters
        captured["stop"] = stop
        return "OK"

    monkeypatch.setattr(policy, "guarded_cognition_model", fake_resolve)
    monkeypatch.setattr(ping, "invoke_text", fake_invoke_text)

    result = ping.ping_model("t1", MC, account_id="account")
    assert result == {"ok": True, "model": {"provider": "openai", "name": "gpt-4o"}, "reply": "OK"}
    assert captured["instance"] is instance
    assert captured["params"] == {"temperature": 0.0}  # stop split out
    assert captured["stop"] == ["x"]


def test_ping_default_model_no_config(monkeypatch: pytest.MonkeyPatch) -> None:
    def resolve(tenant_id: str, model_config: Inputs | None, *, account_id: str, app_id: str | None) -> ModelInstance:
        assert (tenant_id, model_config, account_id, app_id) == ("t1", None, "account", None)
        return make_model_instance(provider="anthropic", model="claude-sonnet-5")

    monkeypatch.setattr(policy, "guarded_cognition_model", resolve)
    monkeypatch.setattr(
        ping,
        "invoke_text",
        lambda inst, *, system, user, model_parameters=None, stop=None: "OK",  # noqa: ARG005
    )
    result = ping.ping_model("t1", None, account_id="account")
    assert result["ok"] is True
    assert result["model"]["provider"] == "anthropic"
