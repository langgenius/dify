from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

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
        app_model = None
        session = None

        def get_draft_workflow(self, app_model, session=None):
            self.app_model = app_model
            self.session = session
            return workflow

    service = _Service()
    monkeypatch.setattr(generator_module, "WorkflowService", lambda: service)
    return service


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

    session = MagicMock()
    session.get.return_value = None

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
        response, status = method(session, "t1")

    assert status == 400
    assert response["error"] == "app app-1 not found"
    session.get.assert_called_once_with(generator_module.App, "app-1")


def test_instruction_generate_workflow_not_found(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)

    app_model = SimpleNamespace(id="app-1")
    session = SimpleNamespace(get=lambda *_args, **_kwargs: app_model)
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
        response, status = method(session, "t1")

    assert status == 400
    assert response["error"] == "workflow app-1 not found"


def test_instruction_generate_node_missing(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)

    app_model = SimpleNamespace(id="app-1")
    session = SimpleNamespace(get=lambda *_args, **_kwargs: app_model)

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
        response, status = method(session, "t1")

    assert status == 400
    assert response["error"] == "node node-1 not found"


def test_instruction_generate_code_node(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)

    app_model = SimpleNamespace(id="app-1")
    session = SimpleNamespace(get=lambda *_args, **_kwargs: app_model)

    workflow = SimpleNamespace(
        graph_dict={
            "nodes": [
                {"id": "node-1", "data": {"type": "code"}},
            ]
        }
    )
    workflow_service = _install_workflow_service(monkeypatch, workflow=workflow)
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
        response = method(session, "t1")

    assert response == {"code": "x"}
    assert workflow_service.app_model is app_model
    assert workflow_service.session is session


def test_instruction_generate_legacy_modify(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)
    session = SimpleNamespace()

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
        response = method(session, "t1")

    assert response == {"instruction": "ok"}


def test_instruction_generate_incompatible_params(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = _unwrap(api.post)
    session = SimpleNamespace()

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
        response, status = method(session, "t1")

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
