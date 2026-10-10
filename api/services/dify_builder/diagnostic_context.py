"""Model-facing diagnostic copies; never rewrite persisted execution evidence.

This profile is broader than credential configuration redaction and does not
participate in configuration-write validation. It hides structured credentials
and known credential values repeated in text, not arbitrary unknown prose.
"""

import re
from copy import deepcopy
from typing import Any
from urllib.parse import unquote_plus

from core.dify_builder.models import Graph, NodeOutput, Run
from services.dify_builder.credentials import REDACTED

_SENSITIVE_FIELDS = frozenset(
    {
        "apikey",
        "accesstoken",
        "refreshtoken",
        "authtoken",
        "bearertoken",
        "token",
        "secret",
        "secretkey",
        "clientsecret",
        "password",
        "credential",
        "credentials",
        "privatekey",
        "xapikey",
    }
)
_CONTAINERS = frozenset({"headers", "params", "query", "queryparams", "queryparameters", "cookies"})


def _field_name(key: str) -> str:
    return "".join(char for char in key.lower() if char.isalnum())


def _hide(value: Any, known: set[str]) -> Any:
    if isinstance(value, dict):
        return {key: _hide(item, known) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_hide(item, known) for item in value]
    if isinstance(value, str) and value and value != REDACTED:
        known.add(value)
        stripped = value.strip()
        if stripped:
            known.add(stripped)
        scheme, separator, token = stripped.partition(" ")
        if separator and scheme.lower() in {"bearer", "basic"} and token.strip():
            known.add(token.strip())
    return REDACTED if value else value


def _container(value: Any, known: set[str], field: str) -> Any:
    if isinstance(value, str):
        if field.startswith("query") or (field == "params" and ":" not in value and "=" in value):
            parts = []
            for part in value.split("&"):
                name, separator, item = part.partition("=")
                if separator and item:
                    _hide(unquote_plus(item), known)
                    parts.append(f"{name}={_hide(item, known)}")
                else:
                    parts.append(part if separator else str(_hide(part, known)))
            return "&".join(parts)
        # Native HTTP headers/params are newline-delimited name:value pairs.
        lines = []
        for line in value.splitlines():
            name, separator, item = line.partition(":")
            if separator:
                lines.append(f"{name}:{_hide(item.strip(), known)}" if item.strip() else line)
            else:
                lines.append(str(_hide(line, known)))
        return "\n".join(lines)
    if isinstance(value, list):
        return [
            {key: item if key in {"key", "name"} else _hide(item, known) for key, item in row.items()}
            if isinstance(row, dict)
            else _hide(row, known)
            for row in value
        ]
    return _hide(value, known)


def _authorization(value: Any, known: set[str]) -> Any:
    if not isinstance(value, dict):
        return _hide(value, known)
    return {
        key: item
        if key in {"type", "header"}
        else _authorization(item, known)
        if key == "config"
        else _hide(item, known)
        for key, item in value.items()
    }


def _structured(value: Any, known: set[str]) -> Any:
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            field = _field_name(str(key))
            if field == "authorization":
                result[key] = _authorization(item, known)
            elif field in _CONTAINERS:
                result[key] = _container(item, known, field)
            elif field in _SENSITIVE_FIELDS:
                result[key] = _hide(item, known)
            else:
                result[key] = _structured(item, known)
        return result
    if isinstance(value, (list, tuple)):
        return [_structured(item, known) for item in value]
    return value


def _replace_text(text: str, known: list[str]) -> str:
    if not known:
        return text
    # Match whole existing sentinel spans before shorter secrets within them,
    # including sentinels inserted during structured redaction. One pass also
    # protects newly inserted sentinels. Longest first handles overlaps.
    protected = sorted({REDACTED, *known}, key=len, reverse=True)
    return re.sub("|".join(re.escape(secret) for secret in protected), lambda _: REDACTED, text)


def _replace_known(value: Any, known: list[str]) -> Any:
    if isinstance(value, str):
        return _replace_text(value, known)
    if isinstance(value, dict):
        return {
            _replace_text(key, known) if isinstance(key, str) else key: _replace_known(item, known)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_replace_known(item, known) for item in value]
    return value


def _known_credentials(failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> set[str]:
    """Collect from raw provenance before any projection discards values."""
    known: set[str] = set()
    _structured(graph, known)
    for output in [*failed_run.per_node, *node_outputs]:
        _structured(output.inputs, known)
        _structured(output.outputs, known)
    return known


def redact_diagnostic_text(text: str, failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> str:
    """Apply the complete graph/runtime credential policy to rendered prompt text."""
    known = _known_credentials(failed_run, graph, node_outputs)
    return _replace_text(text, sorted(known, key=len, reverse=True))


def redact_run_context(failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> tuple[Run, list[NodeOutput]]:
    """Return independent, sanitized diagnostic evidence before prompt truncation."""
    known = _known_credentials(failed_run, graph, node_outputs)
    safe_run, safe_outputs = deepcopy((failed_run, node_outputs))
    # Gather structured secrets first, so earlier error/body text can safely
    # repeat a credential held by a later node or output.
    for output in [*safe_run.per_node, *safe_outputs]:
        output.inputs = _structured(output.inputs, known)
        output.outputs = _structured(output.outputs, known)
    secrets = sorted(known, key=len, reverse=True)
    safe_run.error = _replace_text(safe_run.error, secrets)
    for output in [*safe_run.per_node, *safe_outputs]:
        output.title = _replace_text(output.title, secrets)
        output.error = _replace_text(output.error, secrets)
        output.inputs = _replace_known(output.inputs, secrets)
        output.outputs = _replace_known(output.outputs, secrets)
    return safe_run, safe_outputs
