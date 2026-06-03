"""Unit tests for input_schema derivation."""

from __future__ import annotations

import pytest

from controllers.openapi._input_schema import _form_to_jsonschema


def _wrap(component: dict) -> list[dict]:
    """user_input_form rows are single-key dicts: {"text-input": {...}}."""
    return [component]


def test_text_input_required() -> None:
    form = _wrap({"text-input": {"variable": "industry", "label": "Industry", "required": True, "max_length": 200}})
    props, required = _form_to_jsonschema(form)
    assert props == {"industry": {"type": "string", "title": "Industry", "maxLength": 200}}
    assert required == ["industry"]


def test_paragraph_optional() -> None:
    form = _wrap({"paragraph": {"variable": "context", "label": "Context", "required": False, "max_length": 4000}})
    props, required = _form_to_jsonschema(form)
    assert props["context"] == {"type": "string", "title": "Context", "maxLength": 4000}
    assert required == []


def test_select_enum() -> None:
    form = _wrap(
        {
            "select": {
                "variable": "tier",
                "label": "Tier",
                "required": True,
                "options": ["free", "pro", "enterprise"],
            }
        }
    )
    props, required = _form_to_jsonschema(form)
    assert props == {"tier": {"type": "string", "title": "Tier", "enum": ["free", "pro", "enterprise"]}}
    assert required == ["tier"]


def test_number() -> None:
    form = _wrap({"number": {"variable": "count", "label": "Count", "required": False}})
    props, _required = _form_to_jsonschema(form)
    assert props["count"] == {"type": "number", "title": "Count"}


def test_file() -> None:
    form = _wrap({"file": {"variable": "doc", "label": "Doc", "required": True}})
    props, required = _form_to_jsonschema(form)
    assert props["doc"]["type"] == "object"
    assert "title" in props["doc"]
    assert required == ["doc"]


def test_file_list() -> None:
    form = _wrap({"file-list": {"variable": "attachments", "label": "Attachments", "required": False}})
    props, _required = _form_to_jsonschema(form)
    assert props["attachments"]["type"] == "array"
    assert props["attachments"]["items"]["type"] == "object"


def test_unknown_type_skipped() -> None:
    """Forward-compat: unknown variable types are skipped, not 500'd."""
    form = _wrap({"future-type": {"variable": "x", "label": "X", "required": False}})
    props, required = _form_to_jsonschema(form)
    assert props == {}
    assert required == []


def test_required_order_preserved() -> None:
    form = [
        {"text-input": {"variable": "a", "label": "A", "required": True}},
        {"text-input": {"variable": "b", "label": "B", "required": False}},
        {"text-input": {"variable": "c", "label": "C", "required": True}},
    ]
    _props, required = _form_to_jsonschema(form)
    assert required == ["a", "c"]


def test_max_length_omitted_when_zero() -> None:
    form = _wrap({"text-input": {"variable": "x", "label": "X", "required": False, "max_length": 0}})
    props, _ = _form_to_jsonschema(form)
    assert "maxLength" not in props["x"]


from unittest.mock import MagicMock

from controllers.openapi._input_schema import EMPTY_INPUT_SCHEMA, build_input_schema
from controllers.service_api.app.error import AppUnavailableError
from models.model import AppMode


def _stub_app(mode: AppMode, *, form: list[dict] | None = None, has_workflow: bool | None = None):
    """Returns a MagicMock whose .mode + workflow / app_model_config branch is wired up."""
    app = MagicMock()
    app.mode = mode
    if mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
        if has_workflow is False:
            app.workflow = None
        else:
            app.workflow = MagicMock()
            app.workflow.user_input_form.return_value = form or []
            app.workflow.features_dict = {}
    else:
        if has_workflow is False:
            app.app_model_config = None
        else:
            app.app_model_config = MagicMock()
            app.app_model_config.to_dict.return_value = {"user_input_form": form or []}
    return app


def test_chat_mode_includes_query() -> None:
    app = _stub_app(AppMode.CHAT, form=[{"text-input": {"variable": "x", "label": "X", "required": True}}])
    schema = build_input_schema(app)
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert "query" in schema["properties"]
    assert schema["properties"]["query"]["type"] == "string"
    assert schema["properties"]["query"]["minLength"] == 1
    assert "query" in schema["required"]
    assert "inputs" in schema["required"]
    assert schema["properties"]["inputs"]["additionalProperties"] is False


def test_agent_chat_mode_includes_query() -> None:
    app = _stub_app(AppMode.AGENT_CHAT, form=[])
    schema = build_input_schema(app)
    assert "query" in schema["properties"]


def test_advanced_chat_mode_includes_query() -> None:
    app = _stub_app(AppMode.ADVANCED_CHAT, form=[])
    schema = build_input_schema(app)
    assert "query" in schema["properties"]


def test_workflow_mode_omits_query() -> None:
    app = _stub_app(AppMode.WORKFLOW, form=[])
    schema = build_input_schema(app)
    assert "query" not in schema["properties"]
    assert schema["required"] == ["inputs"]


def test_completion_mode_omits_query() -> None:
    app = _stub_app(AppMode.COMPLETION, form=[])
    schema = build_input_schema(app)
    assert "query" not in schema["properties"]
    assert schema["required"] == ["inputs"]


def test_inputs_required_driven_by_form() -> None:
    app = _stub_app(
        AppMode.CHAT,
        form=[
            {"text-input": {"variable": "industry", "label": "Industry", "required": True}},
            {"text-input": {"variable": "context", "label": "Context", "required": False}},
        ],
    )
    schema = build_input_schema(app)
    assert schema["properties"]["inputs"]["required"] == ["industry"]


def test_misconfigured_chat_raises_app_unavailable() -> None:
    app = _stub_app(AppMode.CHAT, has_workflow=False)
    with pytest.raises(AppUnavailableError):
        build_input_schema(app)


def test_misconfigured_workflow_raises_app_unavailable() -> None:
    app = _stub_app(AppMode.WORKFLOW, has_workflow=False)
    with pytest.raises(AppUnavailableError):
        build_input_schema(app)


def test_empty_input_schema_sentinel_shape() -> None:
    assert EMPTY_INPUT_SCHEMA["type"] == "object"
    assert EMPTY_INPUT_SCHEMA["properties"] == {}
    assert EMPTY_INPUT_SCHEMA["required"] == []
