from __future__ import annotations

import sys
import types

import quart_flask_patch  # noqa: F401
from quart_flask_patch import request as flask_request


def _install_flask_views_shim() -> None:
    http_method_funcs = frozenset({"get", "post", "head", "options", "delete", "put", "trace", "patch"})

    class View:
        methods = None
        provide_automatic_options = None
        decorators = ()

        def dispatch_request(self, *args, **kwargs):  # pragma: no cover
            raise NotImplementedError()

        @classmethod
        def as_view(cls, name, *class_args, **class_kwargs):
            def view(*args, **kwargs):
                self = view.view_class(*class_args, **class_kwargs)
                return self.dispatch_request(*args, **kwargs)

            view.view_class = cls
            view.__name__ = name
            view.__doc__ = cls.__doc__
            view.__module__ = cls.__module__

            methods = cls.methods
            if methods is None:
                methods = {m.upper() for m in http_method_funcs if hasattr(cls, m)}
            view.methods = methods

            if cls.decorators:
                for decorator in cls.decorators:
                    view = decorator(view)
            return view

    class MethodView(View):
        def dispatch_request(self, *args, **kwargs):
            method = flask_request.method.lower()
            handler = getattr(self, method, None)
            if handler is None and method == "head":
                handler = getattr(self, "get", None)
            if handler is None:
                raise AttributeError(f"Unimplemented method '{flask_request.method}'")
            return handler(*args, **kwargs)

    module = types.ModuleType("flask.views")
    module.View = View
    module.MethodView = MethodView
    module.http_method_funcs = http_method_funcs
    sys.modules["flask.views"] = module


_install_flask_views_shim()

from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from celery import Celery

    celery: Celery


def is_db_command() -> bool:
    if len(sys.argv) > 1 and sys.argv[0].endswith("quart") and sys.argv[1] == "db":
        return True
    return False


# create app
if is_db_command():
    from app_factory import create_migrations_app

    app = create_migrations_app()
else:
    # Gunicorn and Celery handle monkey patching automatically in production by
    # specifying the `gevent` worker class. Manual monkey patching is not required here.
    #
    # See `api/docker/entrypoint.sh` (lines 33 and 47) for details.
    #
    # For third-party library patching, refer to `gunicorn.conf.py` and `celery_entrypoint.py`.

    from app_factory import create_app

    app = create_app()
    celery = cast("Celery", app.extensions["celery"])

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
