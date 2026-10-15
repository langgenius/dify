from __future__ import annotations

import sys
from contextlib import AbstractContextManager
from typing import TYPE_CHECKING, override

from flask import Flask
from flask.ctx import AppContext

if TYPE_CHECKING:
    from extensions.ext_login import DifyLoginManager


class DifyApp(Flask):
    """Flask application type with Dify-specific extension attributes."""

    login_manager: DifyLoginManager

    @override
    def app_context(self) -> AppContext:
        return _DifyAppContext(self)


class _DifyAppContext(AppContext):
    """Own file rendering for requests and background jobs using this application."""

    def __init__(self, app: Flask) -> None:
        super().__init__(app)
        self._file_scopes: list[AbstractContextManager[None]] = []

    @override
    def push(self) -> None:
        from core.app.workflow.file_runtime import bind_dify_workflow_file_runtime

        super().push()
        scope = bind_dify_workflow_file_runtime()
        try:
            scope.__enter__()
        except BaseException:
            super().pop(sys.exc_info()[1])
            raise
        self._file_scopes.append(scope)

    @override
    def pop(self, exc: BaseException | None = None) -> None:
        try:
            super().pop(exc if exc is not None else sys.exc_info()[1])
        finally:
            self._file_scopes.pop().__exit__(None, None, None)
