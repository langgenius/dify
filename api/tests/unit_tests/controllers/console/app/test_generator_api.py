from __future__ import annotations

from types import SimpleNamespace

import pytest

from controllers.console.app import generator as generator_module
from controllers.console.app.error import ProviderNotInitializeError
from core.errors.error import ProviderTokenNotInitError


def _unwrap(func):
    bound_self = getattr(func, "__self__", None)
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    if bound_self is not None:
        return func.__get__(bound_self, bound_self.__class__)
    return func


def _model_config_payload():
    return {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}


def _install_workflow_service(monkeypatch: pytest.MonkeyPatch, workflow):
    class _Service:
        def get_draft_workflow(self, app_model):
            return workflow

    monkeypatch.setattr(generator_module, "WorkflowService", lambda: _Service())


def test_rule_generate_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.RuleGenerateApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(generator_module.LLMGenerator, "generate_rule_config", lambda **_kwargs: {"rules": []})

    with app.test_request_context(
        "/console/api/rule-generate",
        method="POST",
        json={"instruction": "do it", "model_config": _model_config_payload()},
    ):
        response = method("t1")

    assert response == {"rules": []}


def test_rule_code_generate_maps_token_error(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.RuleCodeGenerateApi()
    method = _unwrap(api.post)

    def _raise(*_args, **_kwargs):
        raise ProviderTokenNotInitError("missing token")

    monkeypatch.setattr(generator_module.LLMGenerator, "generate_code", _raise)

    with app.test_request_context(
        "/console/api/rule-code-generate",
        method="POST",
        json={"instruction": "do it", "model_config": _model_config_payload()},
    ):
        with pytest.raises(ProviderNotInitializeError):
            method("t1")


def test_instruction_generate_app_not_found(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(generator_module.db, "session", SimpleNamespace(get=lambda *_args, **_kwargs: None))

    with app.test_request_context(
        "/console/api/instruction-generate",
        method="POST",
        json={
            "flow_id": "app-1",
            "node_id": "node-1",
            "instruction": "do",
            "model_config": _model_config_payload(),
        },
    ):
        response, status = method("t1")

    assert status == 400
    assert response["error"] == "app app-1 not found"


def test_instruction_generate_workflow_not_found(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)

    app_model = SimpleNamespace(id="app-1")
    monkeypatch.setattr(generator_module.db, "session", SimpleNamespace(get=lambda *_args, **_kwargs: app_model))
    _install_workflow_service(monkeypatch, workflow=None)

    with app.test_request_context(
        "/console/api/instruction-generate",
        method="POST",
        json={
            "flow_id": "app-1",
            "node_id": "node-1",
            "instruction": "do",
            "model_config": _model_config_payload(),
        },
    ):
        response, status = method("t1")

    assert status == 400
    assert response["error"] == "workflow app-1 not found"


def test_instruction_generate_node_missing(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)

    app_model = SimpleNamespace(id="app-1")
    monkeypatch.setattr(generator_module.db, "session", SimpleNamespace(get=lambda *_args, **_kwargs: app_model))

    workflow = SimpleNamespace(graph_dict={"nodes": []})
    _install_workflow_service(monkeypatch, workflow=workflow)

    with app.test_request_context(
        "/console/api/instruction-generate",
        method="POST",
        json={
            "flow_id": "app-1",
            "node_id": "node-1",
            "instruction": "do",
            "model_config": _model_config_payload(),
        },
    ):
        response, status = method("t1")

    assert status == 400
    assert response["error"] == "node node-1 not found"


def test_instruction_generate_code_node(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)

    app_model = SimpleNamespace(id="app-1")
    monkeypatch.setattr(generator_module.db, "session", SimpleNamespace(get=lambda *_args, **_kwargs: app_model))

    workflow = SimpleNamespace(
        graph_dict={
            "nodes": [
                {"id": "node-1", "data": {"type": "code"}},
            ]
        }
    )
    _install_workflow_service(monkeypatch, workflow=workflow)
    monkeypatch.setattr(generator_module.LLMGenerator, "generate_code", lambda **_kwargs: {"code": "x"})

    with app.test_request_context(
        "/console/api/instruction-generate",
        method="POST",
        json={
            "flow_id": "app-1",
            "node_id": "node-1",
            "instruction": "do",
            "model_config": _model_config_payload(),
        },
    ):
        response = method("t1")

    assert response == {"code": "x"}


def test_instruction_generate_legacy_modify(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)

    monkeypatch.setattr(
        generator_module.LLMGenerator,
        "instruction_modify_legacy",
        lambda **_kwargs: {"instruction": "ok"},
    )

    with app.test_request_context(
        "/console/api/instruction-generate",
        method="POST",
        json={
            "flow_id": "app-1",
            "node_id": "",
            "current": "old",
            "instruction": "do",
            "model_config": _model_config_payload(),
        },
    ):
        response = method("t1")

    assert response == {"instruction": "ok"}


def test_instruction_generate_incompatible_params(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)

    with app.test_request_context(
        "/console/api/instruction-generate",
        method="POST",
        json={
            "flow_id": "app-1",
            "node_id": "",
            "current": "",
            "instruction": "do",
            "model_config": _model_config_payload(),
        },
    ):
        response, status = method("t1")

    assert status == 400
    assert response["error"] == "incompatible parameters"


def test_instruction_template_prompt(app) -> None:
    api = generator_module.InstructionGenerationTemplateApi()
    method = _unwrap(api.post)

    with app.test_request_context(
        "/console/api/instruction-generate/template",
        method="POST",
        json={"type": "prompt"},
    ):
        response = method()

    assert "data" in response


def test_instruction_template_invalid_type(app) -> None:
    api = generator_module.InstructionGenerationTemplateApi()
    method = _unwrap(api.post)

    with app.test_request_context(
        "/console/api/instruction-generate/template",
        method="POST",
        json={"type": "unknown"},
    ):
        with pytest.raises(ValueError):
            method()


# ─ /workflow-generate ─────────────────────────────────────────────────────────


def _workflow_generate_payload() -> dict:
    return {
        "mode": "workflow",
        "instruction": "Summarize a URL",
        "ideal_output": "A 3-sentence summary.",
        "model_config": _model_config_payload(),
    }


def _stub_workflow_service(monkeypatch: pytest.MonkeyPatch, returns=None, raises: Exception | None = None):
    def _call(**_kwargs):
        if raises is not None:
            raise raises
        return returns or {"graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
                           "message": "", "error": ""}

    monkeypatch.setattr(generator_module.WorkflowGeneratorService, "generate_workflow_graph", _call)


def test_workflow_generate_returns_service_result(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.WorkflowGenerateApi()
    method = _unwrap(api.post)

    expected = {
        "graph": {"nodes": [{"id": "node-1"}], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
        "message": "Summarize",
        "error": "",
    }
    _stub_workflow_service(monkeypatch, returns=expected)

    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        response = method("t1")

    assert response == expected


def test_workflow_generate_maps_provider_token_error(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """ProviderTokenNotInitError → ProviderNotInitializeError so the frontend
    can render the same "provider missing" UX as /rule-generate."""
    api = generator_module.WorkflowGenerateApi()
    method = _unwrap(api.post)

    _stub_workflow_service(monkeypatch, raises=ProviderTokenNotInitError("missing token"))

    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        with pytest.raises(ProviderNotInitializeError):
            method("t1")


def test_workflow_generate_maps_quota_error(app, monkeypatch: pytest.MonkeyPatch) -> None:
    from controllers.console.app.error import ProviderQuotaExceededError
    from core.errors.error import QuotaExceededError

    api = generator_module.WorkflowGenerateApi()
    method = _unwrap(api.post)

    _stub_workflow_service(monkeypatch, raises=QuotaExceededError())

    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        with pytest.raises(ProviderQuotaExceededError):
            method("t1")


def test_workflow_generate_maps_model_not_support_error(app, monkeypatch: pytest.MonkeyPatch) -> None:
    from controllers.console.app.error import ProviderModelCurrentlyNotSupportError
    from core.errors.error import ModelCurrentlyNotSupportError

    api = generator_module.WorkflowGenerateApi()
    method = _unwrap(api.post)

    _stub_workflow_service(monkeypatch, raises=ModelCurrentlyNotSupportError("not supported"))

    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        with pytest.raises(ProviderModelCurrentlyNotSupportError):
            method("t1")


def test_workflow_generate_maps_invoke_error(app, monkeypatch: pytest.MonkeyPatch) -> None:
    from controllers.console.app.error import CompletionRequestError
    from graphon.model_runtime.errors.invoke import InvokeError

    api = generator_module.WorkflowGenerateApi()
    method = _unwrap(api.post)

    _stub_workflow_service(monkeypatch, raises=InvokeError("LLM unreachable"))

    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        with pytest.raises(CompletionRequestError):
            method("t1")


def test_workflow_generate_accepts_advanced_chat_mode(app, monkeypatch: pytest.MonkeyPatch) -> None:
    """The payload Literal must accept advanced-chat as well as workflow."""
    api = generator_module.WorkflowGenerateApi()
    method = _unwrap(api.post)

    captured: dict = {}

    def _capture(**kwargs):
        captured.update(kwargs)
        return {"graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
                "message": "", "error": ""}

    monkeypatch.setattr(generator_module.WorkflowGeneratorService, "generate_workflow_graph", _capture)

    payload = _workflow_generate_payload()
    payload["mode"] = "advanced-chat"
    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=payload,
    ):
        method("t1")

    assert captured["mode"] == "advanced-chat"
    assert captured["instruction"] == "Summarize a URL"
    assert captured["ideal_output"] == "A 3-sentence summary."
