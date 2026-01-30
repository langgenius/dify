from __future__ import annotations

import asyncio
import inspect
from typing import Any, TypeVar

from quart import Quart
from quart.wrappers.request import Request as QuartRequest

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
