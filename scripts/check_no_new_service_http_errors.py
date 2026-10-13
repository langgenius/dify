#!/usr/bin/env python3
"""Block net-new HTTP exceptions raised or defined in service and core code.

Services and core raise domain exceptions; controllers translate them into HTTP
errors at the boundary (see api/AGENTS.md). An HTTP exception raised inside a
service is also invisible to the API error contract lint when reached through
dynamic dispatch, so its status and code go undocumented.
"""

from __future__ import annotations

import re
from pathlib import Path

from ast_grep_guard import Match, has_reasoned_guard_ignore, rule_path, run_guard

RULE_ID = "no-new-service-http-error"
RULE_PATH = rule_path("no_new_service_http_error.yml")
SCANNED_ROOTS = (Path("api/services"), Path("api/core"))
VIOLATION_MESSAGE = (
    "no-new-service-http-error net-new HTTP exception in service or core code"
)

# Werkzeug's HTTP exceptions plus the controller-layer base classes.
HTTP_ERROR_NAMES = frozenset(
    {
        "HTTPException",
        "BaseHTTPException",
        "BadRequest",
        "Unauthorized",
        "Forbidden",
        "NotFound",
        "MethodNotAllowed",
        "NotAcceptable",
        "RequestTimeout",
        "Conflict",
        "Gone",
        "PreconditionFailed",
        "RequestEntityTooLarge",
        "UnsupportedMediaType",
        "UnprocessableEntity",
        "TooManyRequests",
        "InternalServerError",
        "BadGateway",
        "ServiceUnavailable",
        "GatewayTimeout",
    }
)
_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*$")


def is_service_python_source_path(path: str) -> bool:
    source_path = Path(path)
    return source_path.suffix in {".py", ".pyi"} and any(
        source_path.is_relative_to(root) for root in SCANNED_ROOTS
    )


def _last_name(expression: str) -> str:
    match = _NAME.search(expression.strip().split("(", 1)[0])
    return match.group(0) if match else ""


def is_http_error(match: Match) -> bool:
    text = match.text.strip()
    if text.startswith("abort("):
        return True
    if text.startswith("class "):
        bases = (
            match.meta_variables.get("BASES") or text.split("(", 1)[-1].split(")", 1)[0]
        )
        return any(_last_name(base) in HTTP_ERROR_NAMES for base in bases.split(","))
    error = match.meta_variables.get("ERROR") or text.removeprefix("raise ").strip()
    return _last_name(error) in HTTP_ERROR_NAMES


def is_reportable_match(match: Match) -> bool:
    return is_http_error(match) and not has_reasoned_guard_ignore(
        match.source_line, RULE_ID
    )


def main() -> int:
    return run_guard(
        description=__doc__,
        rule=RULE_PATH,
        is_scanned_path=is_service_python_source_path,
        is_reportable_match=is_reportable_match,
        violation_message=VIOLATION_MESSAGE,
    )


if __name__ == "__main__":
    raise SystemExit(main())
