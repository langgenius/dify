"""Propagate a request's remaining budget to each HTTPX/httpcore I/O operation.

HTTP/1.1 caches the read timeout for the response body. A NetworkBackend and
NetworkStream adapter enforce the budget when httpcore performs the actual I/O.
The budget is active only while sending a request or reading a raw response chunk.
Synchronous TCP connections use resolved socket addresses. Hostname lookups
share a bounded number of resolver slots and can finish after a request expires.
"""

from __future__ import annotations

import math
import socket
import ssl
import threading
import time
from collections.abc import AsyncIterator, Callable, Iterable, Iterator, Mapping
from contextlib import AbstractContextManager, asynccontextmanager, contextmanager, nullcontext
from contextvars import ContextVar
from ipaddress import IPv4Address, IPv6Address, ip_address
from typing import Any, override

import httpcore
import httpx
from httpcore._backends.sync import SyncStream

type RemainingTime = Callable[[], float]
type SocketOption = tuple[int, int, int] | tuple[int, int, bytes | bytearray] | tuple[int, int, None, int]
type _AddressInfo = tuple[
    socket.AddressFamily, socket.SocketKind, int, str, tuple[int, bytes] | tuple[str, int] | tuple[str, int, int, int]
]

_remaining_time: ContextVar[RemainingTime | None] = ContextVar("dify_agent_http_remaining_time", default=None)
_EXPIRED = "HTTP request exceeded its deadline"
_MAX_CONCURRENT_DNS_RESOLUTIONS = 32
_dns_resolution_semaphore = threading.BoundedSemaphore(_MAX_CONCURRENT_DNS_RESOLUTIONS)


@contextmanager
def _use_budget(budget: RemainingTime | None) -> Iterator[None]:
    token = _remaining_time.set(budget)
    try:
        yield
    finally:
        _remaining_time.reset(token)


def _normalize_phase_timeout(timeout: float | None, error_type: type[Exception]) -> float | None:
    """Use None for an unbounded phase and reject invalid numeric timeouts."""
    if timeout is None or timeout == math.inf:
        return None
    if math.isnan(timeout) or timeout < 0:
        raise error_type(_EXPIRED)
    return timeout


def _limit(timeout: float | None, error_type: type[Exception]) -> float | None:
    timeout = _normalize_phase_timeout(timeout, error_type)
    budget = _remaining_time.get()
    if budget is None:
        return timeout
    remaining = budget()
    if math.isnan(remaining) or remaining <= 0:
        raise error_type(_EXPIRED)
    if math.isinf(remaining):
        return timeout
    return remaining if timeout is None else min(timeout, remaining)


class _SyncStream(httpcore.NetworkStream):
    def __init__(self, stream: httpcore.NetworkStream) -> None:
        self._stream = stream

    @override
    def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return self._stream.read(max_bytes, timeout=_limit(timeout, httpcore.ReadTimeout))

    @override
    def write(self, buffer: bytes, timeout: float | None = None) -> None:
        if _remaining_time.get() is None:
            self._stream.write(buffer, timeout=timeout)
            return

        sock = self._stream.get_extra_info("socket")
        # TLS over an HTTPS proxy uses a separate SSLObject over the exposed
        # socket. Its stream must still perform the inner TLS encryption.
        if isinstance(sock, socket.socket) and not isinstance(self._stream.get_extra_info("ssl_object"), ssl.SSLObject):
            data = memoryview(buffer)
            try:
                while data:
                    sock.settimeout(_limit(timeout, httpcore.WriteTimeout))
                    sent = sock.send(data)
                    if sent == 0:
                        raise httpcore.WriteError("Socket closed during write")
                    data = data[sent:]
            except TimeoutError as exc:
                raise httpcore.WriteTimeout(str(exc)) from exc
            except OSError as exc:
                raise httpcore.WriteError(str(exc)) from exc
        else:
            self._stream.write(buffer, timeout=_limit(timeout, httpcore.WriteTimeout))
        _limit(None, httpcore.WriteTimeout)

    @override
    def start_tls(
        self, ssl_context: ssl.SSLContext, server_hostname: str | None = None, timeout: float | None = None
    ) -> httpcore.NetworkStream:
        return _SyncStream(
            self._stream.start_tls(ssl_context, server_hostname, _limit(timeout, httpcore.ConnectTimeout))
        )

    @override
    def close(self) -> None:
        self._stream.close()

    @override
    def get_extra_info(self, info: str) -> Any:
        return self._stream.get_extra_info(info)


class _AsyncStream(httpcore.AsyncNetworkStream):
    def __init__(self, stream: httpcore.AsyncNetworkStream) -> None:
        self._stream = stream

    @override
    async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return await self._stream.read(max_bytes, timeout=_limit(timeout, httpcore.ReadTimeout))

    @override
    async def write(self, buffer: bytes, timeout: float | None = None) -> None:
        await self._stream.write(buffer, timeout=_limit(timeout, httpcore.WriteTimeout))

    @override
    async def start_tls(
        self, ssl_context: ssl.SSLContext, server_hostname: str | None = None, timeout: float | None = None
    ) -> httpcore.AsyncNetworkStream:
        stream = await self._stream.start_tls(ssl_context, server_hostname, _limit(timeout, httpcore.ConnectTimeout))
        return _AsyncStream(stream)

    @override
    async def aclose(self) -> None:
        await self._stream.aclose()

    @override
    def get_extra_info(self, info: str) -> Any:
        return self._stream.get_extra_info(info)


class _SyncBackend(httpcore.NetworkBackend):
    def __init__(self, backend: httpcore.NetworkBackend) -> None:
        self._backend = backend

    @override
    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[SocketOption] | None = None,
    ) -> httpcore.NetworkStream:
        backend = self._backend
        if _remaining_time.get() is not None and isinstance(backend, httpcore.SyncBackend):
            stream = _connect_tcp_with_deadline(host, port, timeout, local_address, socket_options)
        else:
            stream = backend.connect_tcp(
                host, port, _limit(timeout, httpcore.ConnectTimeout), local_address, socket_options
            )
        return _SyncStream(stream)

    @override
    def connect_unix_socket(
        self, path: str, timeout: float | None = None, socket_options: Iterable[SocketOption] | None = None
    ) -> httpcore.NetworkStream:
        return _SyncStream(
            self._backend.connect_unix_socket(path, _limit(timeout, httpcore.ConnectTimeout), socket_options)
        )

    @override
    def sleep(self, seconds: float) -> None:
        self._backend.sleep(_limit(seconds, httpcore.ConnectTimeout) or 0.0)


def _resolve_tcp_addresses(host: str, port: int, timeout: float | None) -> list[_AddressInfo]:
    """Build numeric addresses directly or share one connect budget across slot wait and DNS."""
    raw_ip, separator, scope = host.partition("%")
    try:
        address = ip_address(raw_ip if ":" in host else host)
    except ValueError:
        address = None
    if isinstance(address, IPv4Address) and not separator:
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (str(address), port))]
    if isinstance(address, IPv6Address) and (not separator or (scope.isascii() and scope.isdigit())):
        scope_id = int(scope) if separator else 0
        return [(socket.AF_INET6, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (str(address), port, 0, scope_id))]

    timeout = _normalize_phase_timeout(timeout, httpcore.ConnectTimeout)
    initial_budget = _limit(None, httpcore.ConnectTimeout)
    started_at = time.monotonic()

    def remaining_resolve_timeout() -> float | None:
        current_budget = _limit(None, httpcore.ConnectTimeout)
        if timeout is None:
            return current_budget
        elapsed = (
            initial_budget - current_budget
            if initial_budget is not None and current_budget is not None
            else time.monotonic() - started_at
        )
        remaining = timeout - elapsed
        if remaining <= 0:
            raise httpcore.ConnectTimeout(_EXPIRED)
        return remaining if current_budget is None else min(remaining, current_budget)

    getaddrinfo = socket.getaddrinfo
    semaphore = _dns_resolution_semaphore
    finished = threading.Event()
    result: list[_AddressInfo] | BaseException | None = None

    def resolve() -> None:
        nonlocal result
        try:
            result = getaddrinfo(host, port, 0, socket.SOCK_STREAM)
        except BaseException as exc:
            result = exc
        finally:
            semaphore.release()
            finished.set()

    if not semaphore.acquire(timeout=remaining_resolve_timeout()):
        raise httpcore.ConnectTimeout(_EXPIRED)
    try:
        remaining_resolve_timeout()
        # Keep the slot until the lookup returns, even if the caller times out.
        threading.Thread(target=resolve, daemon=True).start()
    except BaseException:
        semaphore.release()
        raise
    resolve_wait = remaining_resolve_timeout()
    if not finished.wait(resolve_wait):
        raise httpcore.ConnectTimeout(_EXPIRED)
    if not isinstance(result, TimeoutError):
        remaining_resolve_timeout()
    if isinstance(result, BaseException):
        raise result
    assert result is not None
    return result


def _connect_tcp_with_deadline(
    host: str,
    port: int,
    timeout: float | None,
    local_address: str | None,
    socket_options: Iterable[SocketOption] | None,
) -> httpcore.NetworkStream:
    """Use the request deadline and connect to socket addresses without resolving them again."""
    resolve_timeout = _limit(timeout, httpcore.ConnectTimeout)
    try:
        addresses = _resolve_tcp_addresses(host, port, resolve_timeout)
    except TimeoutError as exc:
        raise httpcore.ConnectTimeout(str(exc)) from exc
    except OSError as exc:
        _limit(None, httpcore.ConnectTimeout)
        raise httpcore.ConnectError(str(exc)) from exc
    _limit(None, httpcore.ConnectTimeout)

    options = tuple(socket_options) if socket_options is not None else ()
    last_error: httpcore.ConnectError | httpcore.ConnectTimeout | None = None
    for family, socktype, protocol, _, address in addresses:
        connect_timeout = _limit(timeout, httpcore.ConnectTimeout)
        sock = None
        try:
            sock = socket.socket(family, socktype, protocol)
            sock.settimeout(connect_timeout)
            if local_address is not None:
                sock.bind((local_address, 0))
            sock.connect(address)
            for option in options:
                sock.setsockopt(*option)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            # Preserve httpcore 1.0.9's TLS and socket metadata behavior.
            stream = SyncStream(sock)
        except OSError as exc:
            if sock is not None:
                sock.close()
            _limit(None, httpcore.ConnectTimeout)
            error_type = httpcore.ConnectTimeout if isinstance(exc, TimeoutError) else httpcore.ConnectError
            last_error = error_type(str(exc))
            last_error.__cause__ = exc
        except BaseException:
            if sock is not None:
                sock.close()
            raise
        else:
            try:
                _limit(None, httpcore.ConnectTimeout)
            except httpcore.ConnectTimeout:
                stream.close()
                raise
            return stream
    if last_error is not None:
        raise last_error
    _limit(None, httpcore.ConnectTimeout)
    raise httpcore.ConnectError("getaddrinfo returned no TCP addresses")


class _AsyncBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, backend: httpcore.AsyncNetworkBackend) -> None:
        self._backend = backend

    @override
    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[SocketOption] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        stream = await self._backend.connect_tcp(
            host, port, _limit(timeout, httpcore.ConnectTimeout), local_address, socket_options
        )
        return _AsyncStream(stream)

    @override
    async def connect_unix_socket(
        self, path: str, timeout: float | None = None, socket_options: Iterable[SocketOption] | None = None
    ) -> httpcore.AsyncNetworkStream:
        stream = await self._backend.connect_unix_socket(path, _limit(timeout, httpcore.ConnectTimeout), socket_options)
        return _AsyncStream(stream)

    @override
    async def sleep(self, seconds: float) -> None:
        await self._backend.sleep(_limit(seconds, httpcore.ConnectTimeout) or 0.0)


def _optional_transport_attribute(owner: object, name: str) -> object:
    return getattr(owner, name, None)  # guard-ignore: no-new-getattr -- optional HTTPX/httpcore internals


def _instrument_network(owner: object) -> None:
    """Adapt one httpcore 1.0.9 pool or connection instance in place.

    HTTPX transport construction does not expose network_backend, so adapt pool
    and connection instances in place to retain mounts and open connections.
    The replacements satisfy the same httpcore interfaces and delegate unchanged
    when a request has no deadline.
    """
    attributes = _optional_transport_attribute(owner, "__dict__")
    if not isinstance(attributes, dict):
        return
    backend = attributes.get("_network_backend")
    if isinstance(backend, httpcore.NetworkBackend) and not isinstance(backend, _SyncBackend):
        attributes["_network_backend"] = _SyncBackend(backend)
    elif isinstance(backend, httpcore.AsyncNetworkBackend) and not isinstance(backend, _AsyncBackend):
        attributes["_network_backend"] = _AsyncBackend(backend)

    stream = attributes.get("_network_stream")
    if isinstance(stream, httpcore.NetworkStream) and not isinstance(stream, _SyncStream):
        attributes["_network_stream"] = _SyncStream(stream)
    elif isinstance(stream, httpcore.AsyncNetworkStream) and not isinstance(stream, _AsyncStream):
        attributes["_network_stream"] = _AsyncStream(stream)

    connection = attributes.get("_connection")
    if isinstance(connection, (httpcore.ConnectionInterface, httpcore.AsyncConnectionInterface)):
        _instrument_network(connection)


def _attach_deadline_backends(client: httpx.Client | httpx.AsyncClient) -> None:
    """Attach to the standard transports of the client serving a bounded request."""
    mounts = _optional_transport_attribute(client, "_mounts")
    mounted_transports = mounts.values() if isinstance(mounts, Mapping) else ()
    for transport in (_optional_transport_attribute(client, "_transport"), *mounted_transports):
        if isinstance(transport, (httpx.HTTPTransport, httpx.AsyncHTTPTransport)):
            pool = _optional_transport_attribute(transport, "_pool")
            if isinstance(pool, (httpcore.ConnectionPool, httpcore.AsyncConnectionPool)):
                lock = _optional_transport_attribute(pool, "_optional_thread_lock")
                with lock if isinstance(lock, AbstractContextManager) else nullcontext():
                    _instrument_network(pool)
                    connections = _optional_transport_attribute(pool, "connections")
                    if isinstance(connections, list):
                        for connection in connections:
                            _instrument_network(connection)


def _update_timeouts(request: httpx.Request, configured: httpx.Timeout) -> None:
    """Publish normalized phase timeouts and apply the current request budget."""
    remaining = _limit(None, httpx.ReadTimeout)
    for phase, timeout in configured.as_dict().items():
        limit = _normalize_phase_timeout(timeout, httpx.ReadTimeout)
        if remaining is not None:
            limit = remaining if limit is None else min(limit, remaining)
        if remaining is not None or limit != timeout:
            request.extensions.setdefault("timeout", {})[phase] = limit


class _SyncBody(httpx.SyncByteStream):
    def __init__(
        self, stream: httpx.SyncByteStream, request: httpx.Request, timeout: httpx.Timeout, budget: RemainingTime
    ) -> None:
        self._stream = stream
        self._request = request
        self._timeout = timeout
        self._budget = budget

    @override
    def __iter__(self) -> Iterator[bytes]:
        chunks = iter(self._stream)
        while True:
            with _use_budget(self._budget):
                _update_timeouts(self._request, self._timeout)
                chunk = next(chunks, None)
                _limit(None, httpx.ReadTimeout)
            if chunk is None:
                return
            yield chunk

    @override
    def close(self) -> None:
        self._stream.close()


class _AsyncBody(httpx.AsyncByteStream):
    def __init__(
        self, stream: httpx.AsyncByteStream, request: httpx.Request, timeout: httpx.Timeout, budget: RemainingTime
    ) -> None:
        self._stream = stream
        self._request = request
        self._timeout = timeout
        self._budget = budget

    @override
    async def __aiter__(self) -> AsyncIterator[bytes]:
        chunks = aiter(self._stream)
        while True:
            with _use_budget(self._budget):
                _update_timeouts(self._request, self._timeout)
                chunk = await anext(chunks, None)
                _limit(None, httpx.ReadTimeout)
            if chunk is None:
                return
            yield chunk

    @override
    async def aclose(self) -> None:
        await self._stream.aclose()


@contextmanager
def stream_sync(
    client: httpx.Client, request: httpx.Request, timeout: httpx.Timeout, budget: RemainingTime | None
) -> Iterator[httpx.Response]:
    """Open a synchronous response under the request budget and own its cleanup."""
    if budget is not None:
        _attach_deadline_backends(client)
    response: httpx.Response | None = None
    try:
        with _use_budget(budget):
            _update_timeouts(request, timeout)
            response = client.send(request, stream=True)
            _limit(None, httpx.ReadTimeout)
        if budget is not None and isinstance(response.stream, httpx.SyncByteStream):
            response.stream = _SyncBody(response.stream, response.request, timeout, budget)
        yield response
    finally:
        if response is not None:
            response.close()


@asynccontextmanager
async def stream_async(
    client: httpx.AsyncClient, request: httpx.Request, timeout: httpx.Timeout, budget: RemainingTime | None
) -> AsyncIterator[httpx.Response]:
    """Open an asynchronous response under the request budget and own its cleanup."""
    if budget is not None:
        _attach_deadline_backends(client)
    response: httpx.Response | None = None
    try:
        with _use_budget(budget):
            _update_timeouts(request, timeout)
            response = await client.send(request, stream=True)
            _limit(None, httpx.ReadTimeout)
        if budget is not None and isinstance(response.stream, httpx.AsyncByteStream):
            response.stream = _AsyncBody(response.stream, response.request, timeout, budget)
        yield response
    finally:
        if response is not None:
            await response.aclose()
