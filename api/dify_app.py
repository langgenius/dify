from __future__ import annotations

import asyncio
import inspect
from typing import Any, TypeVar

from quart import Quart
from quart.testing import QuartClient
from quart.wrappers.request import Request as QuartRequest
from quart.wrappers.response import Response as QuartResponse

T = TypeVar("T")


def _resolve_awaitable(value: T) -> T:
    if not inspect.isawaitable(value):
        return value
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(value)  # type: ignore[return-value]
    return value  # type: ignore[return-value]


class DifyRequest(QuartRequest):
    """
    Quart request with sync-friendly accessors for legacy Flask-style code paths.

    In sync contexts (no running event loop), awaitables are executed immediately.
    In async contexts, the awaitable is returned and must be awaited by the caller.
    """

    def get_json(self, *args: Any, **kwargs: Any) -> Any:
        return _resolve_awaitable(super().get_json(*args, **kwargs))

    def get_data(self, *args: Any, **kwargs: Any) -> Any:
        return _resolve_awaitable(super().get_data(*args, **kwargs))

    @property
    def json(self) -> Any:
        return self.get_json()

    @property
    def data(self) -> Any:
        return self.get_data()

    @property
    def form(self) -> Any:
        return _resolve_awaitable(super().form)

    @property
    def files(self) -> Any:
        return _resolve_awaitable(super().files)


class _SyncAppContext:
    def __init__(self, context: Any) -> None:
        self._context = context

    def __getattr__(self, name: str) -> Any:
        return getattr(self._context, name)

    async def push(self) -> Any:
        return await self._context.push()

    async def pop(self, exc: BaseException | None = None) -> Any:
        return await self._context.pop(exc)

    async def __aenter__(self) -> Any:
        return await self._context.__aenter__()

    async def __aexit__(self, exc_type, exc, tb) -> Any:
        return await self._context.__aexit__(exc_type, exc, tb)

    def __enter__(self) -> Any:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self._context.__aenter__())
        raise RuntimeError("Use 'async with' when entering app context inside an event loop.")

    def __exit__(self, exc_type, exc, tb) -> Any:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self._context.__aexit__(exc_type, exc, tb))
        raise RuntimeError("Use 'async with' when exiting app context inside an event loop.")


def _run_sync(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    raise RuntimeError("Sync test client used inside a running event loop. Use the async client instead.")


class _SyncResponse:
    def __init__(self, response: QuartResponse) -> None:
        self._response = response

    def get_json(self, *args: Any, **kwargs: Any) -> Any:
        return _run_sync(self._response.get_json(*args, **kwargs))

    def get_data(self, *args: Any, **kwargs: Any) -> Any:
        return _run_sync(self._response.get_data(*args, **kwargs))

    def __getattr__(self, name: str) -> Any:
        return getattr(self._response, name)


class _SyncTestClient:
    def __init__(self, client: QuartClient) -> None:
        self._client = client

    def open(self, *args: Any, **kwargs: Any) -> _SyncResponse:
        response = _run_sync(self._client.open(*args, **kwargs))
        return _SyncResponse(response)

    def get(self, *args: Any, **kwargs: Any) -> _SyncResponse:
        return self.open(*args, method="GET", **kwargs)

    def post(self, *args: Any, **kwargs: Any) -> _SyncResponse:
        return self.open(*args, method="POST", **kwargs)

    def put(self, *args: Any, **kwargs: Any) -> _SyncResponse:
        return self.open(*args, method="PUT", **kwargs)

    def patch(self, *args: Any, **kwargs: Any) -> _SyncResponse:
        return self.open(*args, method="PATCH", **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> _SyncResponse:
        return self.open(*args, method="DELETE", **kwargs)

    def options(self, *args: Any, **kwargs: Any) -> _SyncResponse:
        return self.open(*args, method="OPTIONS", **kwargs)

    def head(self, *args: Any, **kwargs: Any) -> _SyncResponse:
        return self.open(*args, method="HEAD", **kwargs)

    def __enter__(self) -> _SyncTestClient:
        _run_sync(self._client.__aenter__())
        return self

    def __exit__(self, exc_type, exc, tb) -> Any:
        return _run_sync(self._client.__aexit__(exc_type, exc, tb))

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)


class DifyApp(Quart):
    request_class = DifyRequest

    def make_response(self, *args: Any, **kwargs: Any):
        """Allow Flask-style make_response signatures."""
        if len(args) == 1:
            return super().make_response(args[0], **kwargs)
        if len(args) == 2:
            return super().make_response((args[0], args[1]), **kwargs)
        if len(args) == 3:
            return super().make_response((args[0], args[1], args[2]), **kwargs)
        raise TypeError("make_response expects 1 to 3 positional arguments")

    def app_context(self) -> _SyncAppContext:
        return _SyncAppContext(super().app_context())

    def request_context(self, request: Any) -> _SyncAppContext:
        return _SyncAppContext(super().request_context(request))

    def test_request_context(self, *args: Any, **kwargs: Any) -> _SyncAppContext:
        return _SyncAppContext(super().test_request_context(*args, **kwargs))

    def test_client(self, *args: Any, **kwargs: Any) -> _SyncTestClient | QuartClient:
        sync = kwargs.pop("sync", True)
        client = super().test_client(*args, **kwargs)
        if sync:
            return _SyncTestClient(client)
        return client
