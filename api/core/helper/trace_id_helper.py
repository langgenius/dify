import re
from collections.abc import Mapping
from typing import Any, Optional


def is_valid_trace_id(trace_id: str) -> bool:
    """
    Check if the trace_id is valid.

    Requirements: 1-128 characters, only letters, numbers, '-', and '_'.
    """
    return bool(re.match(r"^[a-zA-Z0-9\-_]{1,128}$", trace_id))


def get_external_trace_id(request: Any) -> Optional[str]:
    """
    Retrieve the trace_id from the request.

    Priority: header ('X-Trace-Id'), then parameters, then JSON body. Returns None if not provided or invalid.
    """
    trace_id = request.headers.get("X-Trace-Id")
    if not trace_id:
        trace_id = request.args.get("trace_id")
    if not trace_id and getattr(request, "is_json", False):
        json_data = getattr(request, "json", None)
        if json_data:
            trace_id = json_data.get("trace_id")
    if isinstance(trace_id, str) and is_valid_trace_id(trace_id):
        return trace_id
    return None


def extract_external_trace_id_from_args(args: Mapping[str, Any]) -> dict:
    """
    Extract 'external_trace_id' from args.

    Returns a dict suitable for use in extras. Returns an empty dict if not found.
    """
    trace_id = args.get("external_trace_id")
    if trace_id:
        return {"external_trace_id": trace_id}
    return {}
