"""Unit tests for the Workflow Copilot controller's request/response glue.

``WorkflowCopilotService.generate`` needs a real model + DB, so it's mocked
here; these tests pin the *controller* contract that sits around it:

- app ``mode`` is normalized to exactly "workflow" | "advanced-chat";
- the JSON envelope forwards reply/graph/error/errors from the service result
  and no longer carries a ``usage`` field (token tracking was removed);
- provider errors from the service map to the shared HTTP error envelope.

Follows the ``test_generator_api`` pattern: unwrap the decorated ``post`` and
drive it inside a Flask ``test_request_context`` with the service monkeypatched.
"""

from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace

import pytest
from flask import Flask

from controllers.console.app import copilot as copilot_module
from controllers.console.app.error import ProviderNotInitializeError
from core.errors.error import ProviderTokenNotInitError


def _model_config_payload() -> dict[str, object]:
    return {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}


def _install_service(
    monkeypatch: pytest.MonkeyPatch, *, capture: dict[str, object], result: dict[str, object]
) -> None:
    """Stub WorkflowCopilotService.generate, recording the kwargs it received."""

    def _generate(**kwargs: object) -> tuple[str, dict[str, object]]:
        capture.update(kwargs)
        return "conv-1", result

    monkeypatch.setattr(copilot_module.WorkflowCopilotService, "generate", staticmethod(_generate))
    # current_user.id is read for account scoping; a bare stub is enough.
    monkeypatch.setattr(copilot_module, "current_user", SimpleNamespace(id="acc-1"))


def _post_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "app_id": "app-1",
        "message": "add an llm node",
        "model_config": _model_config_payload(),
    }
    body.update(overrides)
    return body


def test_post_forwards_envelope_without_usage(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    capture: dict[str, object] = {}
    _install_service(
        monkeypatch,
        capture=capture,
        result={
            "message": "done",
            "graph": {"nodes": [{"id": "node1"}], "edges": []},
            "error": "",
            "errors": [],
            # A stale service result may still carry usage; the controller must
            # not surface it (token tracking was removed end to end).
            "usage": {"total_tokens": 42},
        },
    )
    api = copilot_module.WorkflowCopilotApi()
    method = unwrap(api.post)

    with app.test_request_context("/console/api/workflow-copilot", method="POST", json=_post_body()):
        response = method(api, "t1")

    assert response["conversation_id"] == "conv-1"
    assert response["reply"] == "done"
    assert response["graph"] == {"nodes": [{"id": "node1"}], "edges": []}
    assert response["error"] == ""
    assert response["errors"] == []
    assert "usage" not in response


def test_post_defaults_reply_and_errors(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    # A result missing optional keys must still yield a well-formed envelope.
    _install_service(monkeypatch, capture={}, result={"graph": None})
    api = copilot_module.WorkflowCopilotApi()
    method = unwrap(api.post)

    with app.test_request_context("/console/api/workflow-copilot", method="POST", json=_post_body()):
        response = method(api, "t1")

    assert response["reply"] == ""
    assert response["error"] == ""
    assert response["errors"] == []
    assert response["graph"] is None


@pytest.mark.parametrize(
    ("requested_mode", "expected_mode"),
    [
        ("advanced-chat", "advanced-chat"),
        ("workflow", "workflow"),
        # Anything that isn't exactly "advanced-chat" collapses to "workflow".
        ("chatflow", "workflow"),
        ("", "workflow"),
    ],
)
def test_post_normalizes_mode(
    app: Flask, monkeypatch: pytest.MonkeyPatch, requested_mode: str, expected_mode: str
) -> None:
    capture: dict[str, object] = {}
    _install_service(monkeypatch, capture=capture, result={"message": "", "graph": None, "errors": []})
    api = copilot_module.WorkflowCopilotApi()
    method = unwrap(api.post)

    body = _post_body(mode=requested_mode) if requested_mode else _post_body()
    if not requested_mode:
        body["mode"] = ""

    with app.test_request_context("/console/api/workflow-copilot", method="POST", json=body):
        method(api, "t1")

    assert capture["mode"] == expected_mode


def test_post_forwards_current_graph_and_context_ids(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    capture: dict[str, object] = {}
    _install_service(monkeypatch, capture=capture, result={"message": "", "graph": None, "errors": []})
    api = copilot_module.WorkflowCopilotApi()
    method = unwrap(api.post)

    graph: dict[str, object] = {"nodes": [{"id": "n1", "data": {"type": "start"}}], "edges": []}
    body = _post_body(current_graph=graph, context_node_ids=["n1"], conversation_id="conv-9")

    with app.test_request_context("/console/api/workflow-copilot", method="POST", json=body):
        method(api, "t1")

    assert capture["current_graph"] == graph
    assert capture["context_node_ids"] == ["n1"]
    assert capture["conversation_id"] == "conv-9"
    assert capture["tenant_id"] == "t1"
    assert capture["account_id"] == "acc-1"


def test_post_maps_provider_token_error(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(**_kwargs: object) -> None:
        raise ProviderTokenNotInitError("missing token")

    monkeypatch.setattr(copilot_module.WorkflowCopilotService, "generate", staticmethod(_raise))
    monkeypatch.setattr(copilot_module, "current_user", SimpleNamespace(id="acc-1"))
    api = copilot_module.WorkflowCopilotApi()
    method = unwrap(api.post)

    with app.test_request_context("/console/api/workflow-copilot", method="POST", json=_post_body()):
        with pytest.raises(ProviderNotInitializeError):
            method(api, "t1")
