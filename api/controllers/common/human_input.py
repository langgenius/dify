import json

from pydantic import BaseModel, JsonValue


class HumanInputFormSubmitPayload(BaseModel):
    inputs: dict[str, JsonValue]
    action: str


def stringify_form_default_values(values: dict[str, object]) -> dict[str, str]:
    """Serialize default values into strings expected by human-input form clients."""
    result: dict[str, str] = {}
    for key, value in values.items():
        if value is None:
            result[key] = ""
        elif isinstance(value, (dict, list)):
            result[key] = json.dumps(value, ensure_ascii=False)
        else:
            result[key] = str(value)
    return result
