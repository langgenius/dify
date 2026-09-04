"""Normalize LLM-generated form schemas against their concrete values."""

from typing import Any

FORM_FIELD_TYPE_GUIDANCE = (
    "Allowed field types are text, textarea, select, bool, number, json, and json_object. "
    "The field type must match its JSON value: use bool for booleans, number for numbers, "
    "json_object for objects, json for arrays, and text, textarea, or select only for strings. "
    "For select fields, include the current string value in options. "
)

_STRING_FIELD_TYPES = {"select", "text", "textarea"}


def reconcile_form_fields(fields: list[Any], values: dict[str, Any]) -> list[Any]:
    """Return field specs whose types preserve the corresponding JSON values.

    A missing or null value provides no runtime type evidence, so its declared
    type is left unchanged. The known value is the source of truth otherwise.
    """
    reconciled: list[Any] = []
    for field in fields:
        if not isinstance(field, dict):
            reconciled.append(field)
            continue

        raw_key = field.get("key")
        if raw_key is None:
            reconciled.append(field)
            continue
        key = str(raw_key)
        if key not in values or values[key] is None:
            reconciled.append(field)
            continue

        value = values[key]
        if isinstance(value, bool):
            field_type = "bool"
        elif isinstance(value, (int, float)):
            field_type = "number"
        elif isinstance(value, dict):
            field_type = "json_object"
        elif isinstance(value, list):
            field_type = "json"
        elif isinstance(value, str):
            declared_type = field.get("type")
            field_type = declared_type if declared_type in _STRING_FIELD_TYPES else "text"
        else:
            reconciled.append(field)
            continue

        updated = {**field, "type": field_type}
        if field_type == "select":
            raw_options = field.get("options")
            options = list(raw_options) if isinstance(raw_options, list) else []
            if not any(str(option) == value for option in options):
                options.append(value)
            updated["options"] = options
        reconciled.append(updated)

    return reconciled
