import inspect

from flask import current_app, request
from flask_restx import Resource

from dify_app import DifyApp


def _patch_flask_restx_async_dispatch() -> None:
    if getattr(Resource, "_dify_async_dispatch", False):
        return

    def dispatch_request(self, *args, **kwargs):  # type: ignore[override]
        method = getattr(self, request.method.lower(), None)
        if method is None and request.method == "HEAD":
            method = getattr(self, "get", None)

        assert method is not None, f"Unimplemented method {request.method!r}"

        for decorator in getattr(self, "method_decorators", []) or []:
            method = decorator(method)

        for decorator in getattr(self, "decorators", []) or []:
            method = decorator(method)

        async def invoke():
            result = method(*args, **kwargs)
            if inspect.isawaitable(result):
                return await result
            return result

        return current_app.ensure_sync(invoke)()

    Resource.dispatch_request = dispatch_request  # type: ignore[assignment]
    Resource._dify_async_dispatch = True


def init_app(app: DifyApp):
    _patch_flask_restx_async_dispatch()
    from events import event_handlers  # noqa: F401
