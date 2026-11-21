"""One-shot, byte- and wall-clock-bounded SSRF HTTP transport.

Every request uses max_retries=0 and follow_redirects=False. A bounded daemon
I/O permit is retained until underlying socket cleanup, including after the
caller deadline, so slow peers cannot create unbounded orphan threads.
"""

import math
import threading
import time
from collections.abc import Callable
from contextlib import suppress
from contextvars import copy_context
from dataclasses import dataclass
from typing import Protocol

import httpx


class Requester(Protocol):
    def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        """Return an open response through the deployment's SSRF policy."""
        ...


class SSRFRequester:
    def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        """Perform real network I/O through the existing SSRF owner, without retries."""
        from core.helper import ssrf_proxy

        return ssrf_proxy.make_request(method, url, **kwargs)  # type: ignore[arg-type]


@dataclass(frozen=True, slots=True)
class HTTPReply:
    status: int
    headers: dict[str, str]
    body: bytes
    listen_window_ended: bool = False


class TransportError(ValueError):
    """A safe failure code without raw peer content or credential-bearing URL."""

    def __init__(self, code: str, partial_reply: HTTPReply | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.partial_reply = partial_reply


class BoundedTransport:
    def __init__(
        self,
        requester: Requester,
        *,
        max_concurrent_io: int = 32,
        connect_timeout_seconds: float = 5,
        request_timeout_seconds: float = 30,
        clock: Callable[[], float] = time.monotonic,
    ):
        """Require an SSRF requester; retain at most max_concurrent_io live operations."""
        if max_concurrent_io < 1:
            raise ValueError("A positive I/O concurrency limit is required")
        if not (
            math.isfinite(connect_timeout_seconds)
            and math.isfinite(request_timeout_seconds)
            and 0 < connect_timeout_seconds <= request_timeout_seconds <= 30
        ):
            raise ValueError("HTTP timeouts must satisfy 0 < connect <= request <= 30 seconds")
        self._requester = requester
        self._permits = threading.BoundedSemaphore(max_concurrent_io)
        self._connect_timeout = connect_timeout_seconds
        self._request_timeout = request_timeout_seconds
        self._clock = clock

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        body: bytes | None,
        timeout_seconds: float,
        max_bytes: int,
        streaming: bool = False,
    ) -> HTTPReply:
        """Return bounded identity bytes or a safe failure; never follow redirects/retry.

        A listening cutoff returns only bytes already received, which may contain
        a known Task. The gateway owns strict SSE parsing and known-task recovery.
        No success is inferred from a partial ordinary JSON body.
        """
        if not math.isfinite(timeout_seconds) or timeout_seconds <= 0 or max_bytes <= 0:
            raise TransportError("deadline_exceeded")
        if not self._permits.acquire(blocking=False):
            raise TransportError("io_capacity_exhausted")
        done = threading.Event()
        stop = threading.Event()
        lock = threading.Lock()
        effective_timeout = min(timeout_seconds, self._request_timeout)
        deadline = self._clock() + effective_timeout
        chunks: list[bytes] = []
        state: dict[str, object] = {}

        def run() -> None:
            response: httpx.Response | None = None
            try:
                response = self._requester.request(
                    method,
                    url,
                    headers=headers,
                    content=body,
                    timeout=httpx.Timeout(effective_timeout, connect=min(effective_timeout, self._connect_timeout)),
                    max_retries=0,
                    stream_response=True,
                    follow_redirects=False,
                    ssl_verify=True,
                )
                with lock:
                    state["status"] = response.status_code
                    state["headers"] = dict(response.headers)
                if response.headers.get("content-encoding", "identity").lower() not in ("identity", ""):
                    raise TransportError("unsupported_content_encoding")
                content_length = response.headers.get("content-length")
                if content_length is not None and (not content_length.isdigit() or int(content_length) > max_bytes):
                    raise TransportError("response_too_large")
                size = 0
                iterator = response.iter_raw() if not response.is_stream_consumed else iter((response.content,))
                for chunk in iterator:
                    if stop.is_set() or self._clock() >= deadline:
                        return
                    size += len(chunk)
                    if size > max_bytes:
                        raise TransportError("response_too_large")
                    with lock:
                        chunks.append(chunk)
            except Exception as error:
                with lock:
                    state["error"] = error.code if isinstance(error, TransportError) else "network_failure"
            finally:
                if response is not None:
                    with suppress(Exception):
                        response.close()
                self._permits.release()
                done.set()

        context = copy_context()
        threading.Thread(target=lambda: context.run(run), daemon=True, name="a2a-bounded-io").start()
        completed = done.wait(max(0.0, deadline - self._clock()))
        if not completed:
            stop.set()
        with lock:
            error = state.get("error")
            status = state.get("status")
            response_headers = state.get("headers")
            received = b"".join(chunks)
        if isinstance(error, str):
            partial = (
                HTTPReply(status, response_headers, received, True)
                if streaming and isinstance(status, int) and isinstance(response_headers, dict)
                else None
            )
            raise TransportError(error, partial)
        if not isinstance(status, int) or not isinstance(response_headers, dict):
            raise TransportError("deadline_exceeded" if not completed else "network_failure")
        if not completed and not streaming:
            raise TransportError("deadline_exceeded")
        return HTTPReply(status, response_headers, received, listen_window_ended=not completed)
