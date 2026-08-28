from services.dify_builder.agent import ping

MC = {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {"temperature": 0.0, "stop": ["x"]}}


def test_ping_success(monkeypatch):
    captured = {}

    def fake_resolve(tenant_id, model_config): return "INSTANCE"  # noqa: ARG001
    def fake_names(tenant_id, model_config): return {"provider": "openai", "name": "gpt-4o"}  # noqa: ARG001

    def fake_invoke_text(instance, *, system, user, model_parameters=None, stop=None):  # noqa: ARG001
        captured["instance"] = instance
        captured["params"] = model_parameters
        captured["stop"] = stop
        return "OK"

    monkeypatch.setattr(ping, "resolve_model_instance", fake_resolve)
    monkeypatch.setattr(ping, "resolved_model_names", fake_names)
    monkeypatch.setattr(ping, "invoke_text", fake_invoke_text)

    result = ping.ping_model("t1", MC)
    assert result == {"ok": True, "model": {"provider": "openai", "name": "gpt-4o"}, "reply": "OK"}
    assert captured["instance"] == "INSTANCE"
    assert captured["params"] == {"temperature": 0.0}   # stop split out
    assert captured["stop"] == ["x"]


def test_ping_default_model_no_config(monkeypatch):
    monkeypatch.setattr(ping, "resolve_model_instance", lambda t, m: "INSTANCE")  # noqa: ARG005
    monkeypatch.setattr(
        ping, "resolved_model_names", lambda t, m: {"provider": "anthropic", "name": "claude-sonnet-5"}  # noqa: ARG005
    )
    monkeypatch.setattr(
        ping, "invoke_text", lambda inst, *, system, user, model_parameters=None, stop=None: "OK"  # noqa: ARG005
    )
    result = ping.ping_model("t1", None)
    assert result["ok"] is True
    assert result["model"]["provider"] == "anthropic"
