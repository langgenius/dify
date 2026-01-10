from __future__ import annotations

import ast
import json

from core.model_runtime.errors.invoke import InvokeError


def _try_parse_payload(value: object) -> dict[str, object] | None:
    """
    Attempt to parse a structured error payload from common shapes:
    - dict already
    - JSON string
    - Python-literal dict string (e.g. \"{'code': 'x', 'message': 'y'}\")
    """
    if isinstance(value, dict):
        return value

    if not isinstance(value, str):
        return None

    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None

    try:
        parsed = ast.literal_eval(value)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _extract_code_message(payload: dict[str, object]) -> tuple[str | None, str | None]:
    """
    Extract (code, message) from payload, supporting both:
    - {"code": "...", "message": "..."}
    - {"error": {"code": "...", "message": "..."}}
    """
    raw_error = payload.get("error")
    if isinstance(raw_error, dict):
        payload = raw_error

    code = payload.get("code")
    message = payload.get("message")
    if isinstance(code, str) and isinstance(message, str):
        return code, message

    return None, None


def maybe_convert_upstream_error(*, provider_name: str, error: Exception) -> InvokeError | None:
    """
    Convert upstream/provider error payloads (commonly returned by plugin-based providers)
    into a unified InvokeError with a stable `error_code`.
    """
    if not isinstance(error, ValueError) or not getattr(error, "args", None):
        return None

    payload = _try_parse_payload(error.args[0])
    if payload is None:
        return None

    code, message = _extract_code_message(payload)
    if code is None or message is None:
        return None

    # Keep the upstream message for frontend i18n/customization; only stabilize the error code.
    return InvokeError(description=f"[{provider_name}] {message}", error_code=code)
