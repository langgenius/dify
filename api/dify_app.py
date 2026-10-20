from __future__ import annotations

from contextlib import AbstractContextManager, nullcontext
from typing import TYPE_CHECKING, Any, override

from flask import Flask
from flask.ctx import AppContext

from graphon.file.runtime import use_workflow_file_runtime

if TYPE_CHECKING:
    from extensions.ext_login import DifyLoginManager


class DifyApp(Flask):
    """Flask application type with Dify-specific extension attributes."""

    login_manager: DifyLoginManager

    @override
    def app_context(self) -> AppContext:
        return DifyAppContext(self)


class DifyAppContext(AppContext):
    """Keep the file adapter available through Flask teardown, including failures."""

    def __init__(self, app: DifyApp) -> None:
        super().__init__(app)
        self._file_scopes: list[AbstractContextManager[None]] = []

    @override
    def push(self) -> None:
        super().push()
        runtime = self.app.extensions.get("workflow_file_runtime")
        scope = use_workflow_file_runtime(runtime) if runtime is not None else nullcontext()
        scope.__enter__()
        self._file_scopes.append(scope)

    @override
    def pop(self, *args: Any, **kwargs: Any) -> None:
        # Forward omitted arguments unchanged so Flask can infer the active exception.
        try:
            super().pop(*args, **kwargs)
        finally:
            self._file_scopes.pop().__exit__(None, None, None)
