from __future__ import annotations

import asyncio
import inspect
import sys
from typing import Any, TypeVar

from quart import Quart
from quart.ctx import AppContext as QuartAppContext
from quart.ctx import RequestContext as QuartRequestContext
from quart.ctx import _cv_app, _cv_request, appcontext_popped, appcontext_pushed
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
    def __init__(self, context: QuartAppContext) -> None:
        self._context = context
        self._token = None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._context, name)

    def __enter__(self) -> Any:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            self._token = _cv_app.set(self._context)
            _run_sync(appcontext_pushed.send_async(self._context.app, _sync_wrapper=self._context.app.ensure_async))
            return self._context
        raise RuntimeError("Use 'async with' when entering app context inside an event loop.")

    def __exit__(self, exc_type, exc, tb) -> Any:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            if self._token is None:
                return None
            exc_value = exc if exc is not None else sys.exc_info()[1]
            _run_sync(self._context.app.do_teardown_appcontext(exc_value))
            ctx = _cv_app.get()
            _cv_app.reset(self._token)
            if ctx is not self._context:
                raise AssertionError(f"Popped wrong app context. ({ctx!r} instead of {self._context!r})")
            _run_sync(appcontext_popped.send_async(self._context.app, _sync_wrapper=self._context.app.ensure_async))
            return None
        raise RuntimeError("Use 'async with' when exiting app context inside an event loop.")


class _SyncRequestContext:
    def __init__(self, context: QuartRequestContext) -> None:
        self._context = context
        self._token = None
        self._app_ctx: _SyncAppContext | None = None

    def __getattr__(self, name: str) -> Any:
        return getattr(self._context, name)

    def __enter__(self) -> Any:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            app_ctx = _cv_app.get(None)
            if app_ctx is None or app_ctx.app is not self._context.app:
                self._app_ctx = _SyncAppContext(self._context.app.app_context())
                self._app_ctx.__enter__()
            self._token = _cv_request.set(self._context)
            _run_sync(self._context._push())
            return self._context
        raise RuntimeError("Use 'async with' when entering request context inside an event loop.")

    def __exit__(self, exc_type, exc, tb) -> Any:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            if self._token is None:
                return None
            exc_value = exc if exc is not None else sys.exc_info()[1]
            _run_sync(self._context.app.do_teardown_request(exc_value, self._context))
            request_close = getattr(self._context.request_websocket, "close", None)
            if request_close is not None:
                _run_sync(request_close())
            ctx = _cv_request.get()
            _cv_request.reset(self._token)
            if ctx is not self._context:
                raise AssertionError(f"Popped wrong request context. ({ctx!r} instead of {self._context!r})")
            if self._app_ctx is not None:
                self._app_ctx.__exit__(exc_type, exc, tb)
            return None
        raise RuntimeError("Use 'async with' when exiting request context inside an event loop.")


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
        context = super().request_context(request)
        if isinstance(context, QuartRequestContext):
            return _SyncRequestContext(context)
        return _SyncAppContext(context)

    def test_request_context(self, *args: Any, **kwargs: Any) -> _SyncAppContext:
        context = super().test_request_context(*args, **kwargs)
        if isinstance(context, QuartRequestContext):
            return _SyncRequestContext(context)
        return _SyncAppContext(context)

    def test_client(self, *args: Any, **kwargs: Any) -> _SyncTestClient | QuartClient:
        sync = kwargs.pop("sync", True)
        client = super().test_client(*args, **kwargs)
        if sync:
            return _SyncTestClient(client)
        return client
