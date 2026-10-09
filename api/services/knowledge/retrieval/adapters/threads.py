"""Carry invocation context into retrieval workers at the framework boundary."""

from collections.abc import Callable
from threading import Thread
from typing import Any, cast

from flask import current_app
from werkzeug.local import LocalProxy

from extensions.otel import propagate_context


def retrieval_thread(*, target: Callable[..., None], kwargs: dict[str, Any]) -> Thread:
    app = cast(LocalProxy, current_app)._get_current_object()

    @propagate_context
    def run() -> None:
        # Each worker owns its app context and any scoped dependencies downstream.
        with app.app_context():
            target(**kwargs)

    return Thread(target=run)
