"""Unit tests for input_schema derivation."""

from __future__ import annotations

import pytest

from controllers.openapi._input_schema import _form_to_jsonschema, build_input_schema
from models.model import AppMode


def _wrap(component: dict[str, object]) -> list[dict[str, object]]:
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


@pytest.mark.parametrize(
    ("mode", "has_query"),
    [
        (AppMode.CHAT, True),
        (AppMode.AGENT_CHAT, True),
        (AppMode.ADVANCED_CHAT, True),
        (AppMode.WORKFLOW, False),
        (AppMode.COMPLETION, False),
    ],
)
def test_input_schema_depends_only_on_mode_and_materialized_form(mode: AppMode, has_query: bool) -> None:
    schema = build_input_schema(
        mode,
        [
            {"text-input": {"variable": "industry", "label": "Industry", "required": True}},
            {"text-input": {"variable": "context", "label": "Context", "required": False}},
        ],
    )
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert ("query" in schema["properties"]) == has_query
    assert schema["required"] == (["query", "inputs"] if has_query else ["inputs"])
    assert schema["properties"]["inputs"]["required"] == ["industry"]
    assert schema["properties"]["inputs"]["additionalProperties"] is False
