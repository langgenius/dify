"""Canonical bounded Run header parsing; the parsed value grants no authority."""

import base64
import binascii
import json

from dify_agent.protocol.native_testing import (
    MAX_AGENT_CONTROL_BYTES,
    AgentRunTransportSelection,
)
from services.dify_builder.execution_contracts import BuilderExecutionPolicyError


def parse_agent_run_selection(headers) -> AgentRunTransportSelection:
    values = headers.getlist("X-Dify-Agent-Run")
    if len(values) != 1:
        raise BuilderExecutionPolicyError("native_agent_selection_invalid")
    encoded = values[0]
    try:
        if not encoded or len(encoded) > (MAX_AGENT_CONTROL_BYTES * 4 + 2) // 3:
            raise ValueError("invalid selection size")
        raw = base64.b64decode(
            encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True
        )
        if len(raw) > MAX_AGENT_CONTROL_BYTES:
            raise ValueError("invalid selection size")
        value = AgentRunTransportSelection.model_validate_json(raw)
        canonical = json.dumps(
            value.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
        if raw != canonical or encoded != base64.urlsafe_b64encode(canonical).rstrip(
            b"="
        ).decode("ascii"):
            raise ValueError("noncanonical selection")
        return value
    except (ValueError, UnicodeError, binascii.Error):
        raise BuilderExecutionPolicyError("native_agent_selection_invalid") from None
