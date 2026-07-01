from __future__ import annotations

import json
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from controllers.console.app import generator as generator_module
from controllers.console.app.error import ProviderNotInitializeError
from core.errors.error import ProviderTokenNotInitError


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


def test_rule_generate_success(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.RuleGenerateApi()
    method = unwrap(api.post)

    monkeypatch.setattr(generator_module.LLMGenerator, "generate_rule_config", lambda **_kwargs: {"rules": []})

    with app.test_request_context(
        "/console/api/rule-generate",
        method="POST",
        json={"instruction": "do it", "model_config": _model_config_payload()},
    ):
        response = method(api, "t1")

    assert response == {"rules": []}


def test_rule_code_generate_maps_token_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.RuleCodeGenerateApi()
    method = unwrap(api.post)

    def _raise(*_args, **_kwargs):
        raise ProviderTokenNotInitError("missing token")

    monkeypatch.setattr(generator_module.LLMGenerator, "generate_code", _raise)

    with app.test_request_context(
        "/console/api/rule-code-generate",
        method="POST",
        json={"instruction": "do it", "model_config": _model_config_payload()},
    ):
        with pytest.raises(ProviderNotInitializeError):
            method(api, "t1")


def test_instruction_generate_app_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = unwrap(api.post)

    session = MagicMock()
    session.scalar.return_value = None

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
        response, status = method(api, session, "t1")

    assert status == 400
    assert response["error"] == "app app-1 not found"
    stmt = session.scalar.call_args.args[0]
    compiled = stmt.compile()
    statement = str(compiled)
    assert "apps.id" in statement
    assert "apps.tenant_id" in statement
    assert "app-1" in compiled.params.values()
    assert "t1" in compiled.params.values()


def test_instruction_generate_workflow_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = unwrap(api.post)

    app_model = SimpleNamespace(id="app-1")
    session = SimpleNamespace(scalar=lambda *_args, **_kwargs: app_model)
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
        response, status = method(api, session, "t1")

    assert status == 400
    assert response["error"] == "workflow app-1 not found"


def test_instruction_generate_node_missing(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = unwrap(api.post)

    app_model = SimpleNamespace(id="app-1")
    session = SimpleNamespace(scalar=lambda *_args, **_kwargs: app_model)

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
        response, status = method(api, session, "t1")

    assert status == 400
    assert response["error"] == "node node-1 not found"


def test_instruction_generate_code_node(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = unwrap(api.post)

    app_model = SimpleNamespace(id="app-1")
    session = SimpleNamespace(scalar=lambda *_args, **_kwargs: app_model)

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
        response = method(api, session, "t1")

    assert response == {"code": "x"}
    assert workflow_service.app_model is app_model
    assert workflow_service.session is session


def test_instruction_generate_legacy_modify(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = unwrap(api.post)
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
        response = method(api, session, "t1")

    assert response == {"instruction": "ok"}


def test_instruction_generate_incompatible_params(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.InstructionGenerateApi()
    method = unwrap(api.post)
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
        response, status = method(api, session, "t1")

    assert status == 400
    assert response["error"] == "incompatible parameters"


def test_instruction_template_prompt(app: Flask) -> None:
    api = generator_module.InstructionGenerationTemplateApi()
    method = unwrap(api.post)

    with app.test_request_context(
        "/console/api/instruction-generate/template",
        method="POST",
        json={"type": "prompt"},
    ):
        response = method(api)

    assert "data" in response


def test_instruction_template_invalid_type(app: Flask) -> None:
    api = generator_module.InstructionGenerationTemplateApi()
    method = unwrap(api.post)

    with app.test_request_context(
        "/console/api/instruction-generate/template",
        method="POST",
        json={"type": "unknown"},
    ):
        with pytest.raises(ValueError):
            method(api)


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
        return returns or {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
        }

    monkeypatch.setattr(generator_module.WorkflowGeneratorService, "generate_workflow_graph", _call)


def test_workflow_generate_returns_service_result(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.WorkflowGenerateApi()
    method = unwrap(api.post)

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
        response = method(api, "t1")

    assert response == expected


def test_workflow_generate_maps_provider_token_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """ProviderTokenNotInitError → ProviderNotInitializeError so the frontend
    can render the same "provider missing" UX as /rule-generate."""
    api = generator_module.WorkflowGenerateApi()
    method = unwrap(api.post)

    _stub_workflow_service(monkeypatch, raises=ProviderTokenNotInitError("missing token"))

    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        with pytest.raises(ProviderNotInitializeError):
            method(api, "t1")


def test_workflow_generate_maps_quota_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    from controllers.console.app.error import ProviderQuotaExceededError
    from core.errors.error import QuotaExceededError

    api = generator_module.WorkflowGenerateApi()
    method = unwrap(api.post)

    _stub_workflow_service(monkeypatch, raises=QuotaExceededError())

    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        with pytest.raises(ProviderQuotaExceededError):
            method(api, "t1")


def test_workflow_generate_maps_model_not_support_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    from controllers.console.app.error import ProviderModelCurrentlyNotSupportError
    from core.errors.error import ModelCurrentlyNotSupportError

    api = generator_module.WorkflowGenerateApi()
    method = unwrap(api.post)

    _stub_workflow_service(monkeypatch, raises=ModelCurrentlyNotSupportError("not supported"))

    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        with pytest.raises(ProviderModelCurrentlyNotSupportError):
            method(api, "t1")


def test_workflow_generate_maps_invoke_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    from controllers.console.app.error import CompletionRequestError
    from graphon.model_runtime.errors.invoke import InvokeError

    api = generator_module.WorkflowGenerateApi()
    method = unwrap(api.post)

    _stub_workflow_service(monkeypatch, raises=InvokeError("LLM unreachable"))

    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        with pytest.raises(CompletionRequestError):
            method(api, "t1")


def test_workflow_generate_accepts_advanced_chat_mode(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """The payload Literal must accept advanced-chat as well as workflow."""
    api = generator_module.WorkflowGenerateApi()
    method = unwrap(api.post)

    captured: dict = {}

    def _capture(**kwargs):
        captured.update(kwargs)
        return {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
        }

    monkeypatch.setattr(generator_module.WorkflowGeneratorService, "generate_workflow_graph", _capture)

    payload = _workflow_generate_payload()
    payload["mode"] = "advanced-chat"
    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=payload,
    ):
        method(api, "t1")

    assert captured["mode"] == "advanced-chat"
    assert captured["instruction"] == "Summarize a URL"
    assert captured["ideal_output"] == "A 3-sentence summary."


def test_workflow_generate_forwards_current_graph_for_refine(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """cmd+k `/refine`: the optional current_graph field reaches the service."""
    api = generator_module.WorkflowGenerateApi()
    method = unwrap(api.post)

    captured: dict = {}

    def _capture(**kwargs):
        captured.update(kwargs)
        return {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
        }

    monkeypatch.setattr(generator_module.WorkflowGeneratorService, "generate_workflow_graph", _capture)

    graph = {"nodes": [{"id": "node1"}], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}}
    payload = _workflow_generate_payload()
    payload["current_graph"] = graph
    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=payload,
    ):
        method(api, "t1")

    assert captured["current_graph"] == graph


def test_workflow_generate_current_graph_defaults_to_none(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Omitting current_graph (the `/create` path) forwards None to the service."""
    api = generator_module.WorkflowGenerateApi()
    method = unwrap(api.post)

    captured: dict = {}

    def _capture(**kwargs):
        captured.update(kwargs)
        return {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
        }

    monkeypatch.setattr(generator_module.WorkflowGeneratorService, "generate_workflow_graph", _capture)

    with app.test_request_context(
        "/console/api/workflow-generate",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        method(api, "t1")

    assert captured["current_graph"] is None


def test_workflow_generate_accepts_auto_mode(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Task 3: the payload Literal must accept ``auto``; the controller forwards
    it unchanged (the service resolves it) and returns the resolved ``mode``."""
    api = generator_module.WorkflowGenerateApi()
    method = unwrap(api.post)

    captured: dict = {}

    def _capture(**kwargs):
        captured.update(kwargs)
        return {
            "graph": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 0.7}},
            "message": "",
            "error": "",
            "mode": "advanced-chat",
        }

    monkeypatch.setattr(generator_module.WorkflowGeneratorService, "generate_workflow_graph", _capture)

    payload = _workflow_generate_payload()
    payload["mode"] = "auto"
    with app.test_request_context("/console/api/workflow-generate", method="POST", json=payload):
        response = method(api, "t1")

    assert captured["mode"] == "auto"
    assert response["mode"] == "advanced-chat"


# ─ /workflow-generate/suggestions ─────────────────────────────────────────────


def test_generate_instruction_suggestions_parses_and_cleans(monkeypatch: pytest.MonkeyPatch) -> None:
    """Task 1c (i): a mocked default model returning a JSON array is parsed + cleaned."""
    from core.llm_generator import llm_generator as llm_gen_module

    instance = MagicMock()
    instance.invoke_llm.return_value.message.get_text_content.return_value = '["Summarize a URL", "Translate text"]'
    mock_manager = MagicMock()
    mock_manager.for_tenant.return_value.get_default_model_instance.return_value = instance
    monkeypatch.setattr(llm_gen_module, "ModelManager", mock_manager)
    monkeypatch.setattr(llm_gen_module.LLMGenerator, "_build_suggestion_context", staticmethod(lambda _tenant: ""))

    result = llm_gen_module.LLMGenerator.generate_workflow_instruction_suggestions(
        tenant_id="t1", mode="workflow", count=4
    )

    assert result == ["Summarize a URL", "Translate text"]


def test_generate_instruction_suggestions_dedupes_and_caps(monkeypatch: pytest.MonkeyPatch) -> None:
    """Whitespace / surrounding quotes are stripped, case-insensitive dupes dropped, capped to count."""
    from core.llm_generator import llm_generator as llm_gen_module

    instance = MagicMock()
    instance.invoke_llm.return_value.message.get_text_content.return_value = (
        '["  Summarize a URL  ", "summarize a URL", "\'Translate text\'", "Draft an email", "Extra idea"]'
    )
    mock_manager = MagicMock()
    mock_manager.for_tenant.return_value.get_default_model_instance.return_value = instance
    monkeypatch.setattr(llm_gen_module, "ModelManager", mock_manager)
    monkeypatch.setattr(llm_gen_module.LLMGenerator, "_build_suggestion_context", staticmethod(lambda _tenant: ""))

    result = llm_gen_module.LLMGenerator.generate_workflow_instruction_suggestions(
        tenant_id="t1", mode="advanced-chat", count=3
    )

    assert result == ["Summarize a URL", "Translate text", "Draft an email"]


def test_generate_instruction_suggestions_no_default_model_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """Task 1c (ii): a missing default model degrades to an empty list, never raising."""
    from core.llm_generator import llm_generator as llm_gen_module

    mock_manager = MagicMock()
    mock_manager.for_tenant.return_value.get_default_model_instance.side_effect = ProviderTokenNotInitError(
        "no default model"
    )
    monkeypatch.setattr(llm_gen_module, "ModelManager", mock_manager)

    result = llm_gen_module.LLMGenerator.generate_workflow_instruction_suggestions(tenant_id="t1", mode="workflow")

    assert result == []


def test_workflow_instruction_suggestions_route_returns_list(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Task 1c (iii): the route wraps the generator output in {"suggestions": [...]}."""
    api = generator_module.WorkflowInstructionSuggestionsApi()
    method = unwrap(api.post)

    captured: dict = {}

    def _suggest(**kwargs):
        captured.update(kwargs)
        return ["Summarize a URL", "Translate text"]

    monkeypatch.setattr(generator_module.LLMGenerator, "generate_workflow_instruction_suggestions", _suggest)

    with app.test_request_context(
        "/console/api/workflow-generate/suggestions",
        method="POST",
        json={"mode": "workflow", "language": "French", "count": 3},
    ):
        response = method(api, "t1")

    assert response == {"suggestions": ["Summarize a URL", "Translate text"]}
    assert captured["mode"] == "workflow"
    assert captured["language"] == "French"
    assert captured["count"] == 3


def test_workflow_instruction_suggestions_route_empty_is_valid_200(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Task 1c (iii): an empty list is a valid soft-fail response."""
    api = generator_module.WorkflowInstructionSuggestionsApi()
    method = unwrap(api.post)

    monkeypatch.setattr(
        generator_module.LLMGenerator,
        "generate_workflow_instruction_suggestions",
        lambda **_kwargs: [],
    )

    with app.test_request_context(
        "/console/api/workflow-generate/suggestions",
        method="POST",
        json={"mode": "advanced-chat"},
    ):
        response = method(api, "t1")

    assert response == {"suggestions": []}


# ─ /workflow-generate/stream ──────────────────────────────────────────────────


def _read_sse_frames(response) -> list[dict]:
    """Decode an SSE Response body into its parsed ``data:`` JSON frames."""
    body = response.get_data(as_text=True)
    frames = []
    for chunk in body.strip().split("\n\n"):
        chunk = chunk.strip()
        if chunk.startswith("data: "):
            frames.append(json.loads(chunk[len("data: ") :]))
    return frames


def test_workflow_generate_stream_emits_plan_then_result(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Task 2c: the stream endpoint writes one SSE frame per service event."""
    api = generator_module.WorkflowGenerateStreamApi()
    method = unwrap(api.post)

    def _stream(**_kwargs):
        yield ("plan", {"title": "Summarizer", "mode": "workflow", "nodes": []})
        yield ("result", {"graph": {"nodes": []}, "error": "", "mode": "workflow"})

    monkeypatch.setattr(generator_module.WorkflowGeneratorService, "generate_workflow_graph_stream", _stream)

    with app.test_request_context(
        "/console/api/workflow-generate/stream",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        response = method(api, "t1")
        assert response.mimetype == "text/event-stream"
        frames = _read_sse_frames(response)

    assert [f["event"] for f in frames] == ["plan", "result"]
    assert frames[0]["title"] == "Summarizer"
    assert frames[1]["mode"] == "workflow"


def test_workflow_generate_stream_provider_error_emits_result_event(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Task 2c: a provider-init error becomes a single MODEL_ERROR result frame, not a non-SSE error."""
    api = generator_module.WorkflowGenerateStreamApi()
    method = unwrap(api.post)

    def _stream(**_kwargs):
        raise ProviderTokenNotInitError("missing token")
        yield  # pragma: no cover - marks this a generator

    monkeypatch.setattr(generator_module.WorkflowGeneratorService, "generate_workflow_graph_stream", _stream)

    with app.test_request_context(
        "/console/api/workflow-generate/stream",
        method="POST",
        json=_workflow_generate_payload(),
    ):
        response = method(api, "t1")
        frames = _read_sse_frames(response)

    assert len(frames) == 1
    assert frames[0]["event"] == "result"
    assert frames[0]["errors"][0]["code"] == "MODEL_ERROR"
    assert frames[0]["graph"]["nodes"] == []


def test_workflow_generate_stream_rejects_empty_instruction(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Task 2c: empty instructions get a normal 400 JSON BEFORE the stream opens."""
    api = generator_module.WorkflowGenerateStreamApi()
    method = unwrap(api.post)

    payload = _workflow_generate_payload()
    payload["instruction"] = "   "
    with app.test_request_context("/console/api/workflow-generate/stream", method="POST", json=payload):
        response, status = method(api, "t1")

    assert status == 400
    assert response["errors"][0]["code"] == "EMPTY_INSTRUCTION"
