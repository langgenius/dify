"""Server-side JSON Schema derivation from Dify `user_input_form`."""

from __future__ import annotations

from typing import Any, cast

from controllers.service_api.app.error import AppUnavailableError
from models import App
from models.model import AppMode

JSON_SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema"

EMPTY_INPUT_SCHEMA: dict[str, Any] = {
    "$schema": JSON_SCHEMA_DRAFT,
    "type": "object",
    "properties": {},
    "required": [],
}

_CHAT_FAMILY = frozenset({AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT})


def _file_object_shape() -> dict[str, Any]:
    """Single-file value shape. Forward-compat placeholder; refine when file-API contract pins."""
    return {
        "type": "object",
        "properties": {
            "type": {"type": "string"},
            "transfer_method": {"type": "string"},
            "url": {"type": "string"},
            "upload_file_id": {"type": "string"},
        },
        "additionalProperties": True,
    }


def _row_to_schema(row_type: str, row: dict[str, Any]) -> dict[str, Any] | None:
    label = row.get("label") or row.get("variable", "")
    base: dict[str, Any] = {"title": label} if label else {}

    if row_type in ("text-input", "paragraph"):
        out: dict[str, Any] = {"type": "string"} | base
        max_length = row.get("max_length")
        if isinstance(max_length, int) and max_length > 0:
            out["maxLength"] = max_length
        return out

    if row_type == "select":
        return {"type": "string"} | base | {"enum": list(row.get("options") or [])}

    if row_type == "number":
        return {"type": "number"} | base

    if row_type == "file":
        return _file_object_shape() | base

    if row_type == "file-list":
        return {
            "type": "array",
            "items": _file_object_shape(),
        } | base

    return None


def _form_to_jsonschema(form: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    """Translate a user_input_form row list into (properties, required-list).

    Each row is a single-key dict: `{"text-input": {variable, label, required, ...}}`.
    Unknown variable types are skipped (forward-compat).
    """
    properties: dict[str, Any] = {}
    required: list[str] = []
    for row in form:
        if not isinstance(row, dict) or len(row) != 1:
            continue
        ((row_type, row_body),) = row.items()
        if not isinstance(row_body, dict):
            continue
        variable = row_body.get("variable")
        if not variable:
            continue
        schema = _row_to_schema(row_type, row_body)
        if schema is None:
            continue
        properties[variable] = schema
        if row_body.get("required"):
            required.append(variable)
    return properties, required


def resolve_app_config(app: App) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Resolve `(features_dict, user_input_form)` for parameters / schema derivation.

    Raises `AppUnavailableError` on misconfigured apps.
    """
    if app.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
        workflow = app.workflow
        if workflow is None:
            raise AppUnavailableError()
        return (
            workflow.features_dict,
            cast(list[dict[str, Any]], workflow.user_input_form(to_old_structure=True)),
        )

    app_model_config = app.app_model_config
    if app_model_config is None:
        raise AppUnavailableError()
    features_dict = cast(dict[str, Any], app_model_config.to_dict())
    return features_dict, cast(list[dict[str, Any]], features_dict.get("user_input_form", []))


def build_input_schema(app: App) -> dict[str, Any]:
    """Derive Draft 2020-12 JSON Schema from `user_input_form` + app mode.

    chat / agent-chat / advanced-chat: top-level `query` (required, minLength=1) + `inputs` object.
    completion / workflow: `inputs` object only.
    Raises `AppUnavailableError` on misconfigured apps.
    """
    _, user_input_form = resolve_app_config(app)
    inputs_props, inputs_required = _form_to_jsonschema(user_input_form)

    properties: dict[str, Any] = {}
    required: list[str] = []

    if app.mode in _CHAT_FAMILY:
        properties["query"] = {"type": "string", "minLength": 1}
        required.append("query")

    properties["inputs"] = {
        "type": "object",
        "properties": inputs_props,
        "required": inputs_required,
        "additionalProperties": False,
    }
    required.append("inputs")

    return {
        "$schema": JSON_SCHEMA_DRAFT,
        "type": "object",
        "properties": properties,
        "required": required,
    }
