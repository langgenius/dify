"""Request-scoped, content-free diagnostics for the authenticated text bridge.

Provider exception messages can contain SQL, document content, URLs and credentials.
Keep exception types, database codes/names, cause chains and stack locations instead.
The same bounded event is included in text logs and structured log attributes.
"""

import json
import logging
import time
from collections import deque
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import PurePath
from traceback import walk_tb
from typing import TYPE_CHECKING, Literal

import httpx
import requests

from core.logging.context import get_request_id

if TYPE_CHECKING:
    from services.knowledge_fs.text_store import TextPayload

logger = logging.getLogger(__name__)


def _safe_errors(error: BaseException) -> list[dict[str, object]]:
    errors: list[dict[str, object]] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen and len(errors) < 4:
        seen.add(id(current))
        frames = deque[dict[str, object]](maxlen=8)
        for frame, line in walk_tb(current.__traceback__):
            frames.append(
                {"file": PurePath(frame.f_code.co_filename).name, "function": frame.f_code.co_name, "line": line}
            )
        entry: dict[str, object] = {
            "type": f"{type(current).__module__}.{type(current).__qualname__}",
            "frames": list(frames),
        }
        if isinstance(current, (requests.HTTPError, httpx.HTTPStatusError)) and current.response is not None:
            entry["http_status"] = current.response.status_code
        if (
            any(cls.__module__ == "pymysql.err" for cls in type(current).__mro__)
            and current.args
            and type(current.args[0]) is int
        ):
            # Import the optional driver only when this exception came from it.
            from pymysql.constants import CR, ER

            code = current.args[0]
            entry["db_error_code"] = code
            entry["db_error_name"] = next(
                (
                    name
                    for constants in (ER, CR)
                    for name, value in vars(constants).items()
                    if name.isupper() and value == code
                ),
                # PyMySQL's bundled server constants omit this newer MySQL/TiDB code.
                "INTERNAL_ERROR" if code == 1815 else "UNKNOWN",
            )
        errors.append(entry)
        current = current.__cause__ or (None if current.__suppress_context__ else current.__context__)
    return errors


@dataclass
class TextBackendDiagnostics:
    request_id: str
    payload: "TextPayload"
    provider: str
    started: float = field(default_factory=time.monotonic)
    failure_stage: str | None = None
    stage_elapsed_ms: float = 0

    def log_failure(self, error: Exception, *, outcome: Literal["pending", "failed"]) -> None:
        attributes: dict[str, object] = {
            "event": "knowledge_fs.text_backend_failure",
            "request_id": self.request_id,
            "dify_request_id": get_request_id(),
            "tenant_id": self.payload.scope.tenant_id,
            "knowledge_space_id": self.payload.scope.knowledge_space_id,
            "provider": self.provider,
            "operation": self.payload.operation,
            "stage": self.failure_stage or "request",
            "outcome": outcome,
            "elapsed_ms": round((time.monotonic() - self.started) * 1000, 3),
            "stage_elapsed_ms": self.stage_elapsed_ms,
            "errors": _safe_errors(error),
        }
        logger.log(
            logging.WARNING if outcome == "pending" else logging.ERROR,
            "knowledge_fs.text_backend_failure %s",
            json.dumps(attributes, separators=(",", ":")),
            extra={"attributes": attributes},
        )


_current: ContextVar[TextBackendDiagnostics | None] = ContextVar("knowledge_fs_text_diagnostics", default=None)


@contextmanager
def text_backend_diagnostics(
    request_id: str, payload: "TextPayload", provider: str
) -> Generator[TextBackendDiagnostics]:
    diagnostics = TextBackendDiagnostics(request_id, payload, provider)
    token = _current.set(diagnostics)
    try:
        yield diagnostics
    finally:
        _current.reset(token)


@contextmanager
def text_backend_stage(stage: str) -> Generator[None]:
    diagnostics = _current.get()
    if diagnostics is None:
        yield
        return
    started = time.monotonic()
    try:
        yield
    except Exception:
        # Nested stages must retain the deepest failure as contexts unwind.
        if diagnostics.failure_stage is None:
            diagnostics.failure_stage = stage
            diagnostics.stage_elapsed_ms = round((time.monotonic() - started) * 1000, 3)
        raise
