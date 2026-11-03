"""Restore Celery app ownership after tests initialize a real Flask-backed app."""

from collections.abc import Iterator
from typing import Protocol, runtime_checkable

import pytest
from celery import Celery, _state


class _CeleryThreadState(Protocol):
    current_app: Celery | None


@runtime_checkable
class _CeleryGlobalState(Protocol):
    default_app: Celery | None
    _tls: _CeleryThreadState

    def set_default_app(self, app: Celery | None) -> None: ...

    def _set_current_app(self, app: Celery | None) -> None: ...


@pytest.fixture
def preserve_celery_apps() -> Iterator[None]:
    # Celery owns these state exports; its bundled typing omits their private names.
    assert isinstance(_state, _CeleryGlobalState)
    state = _state
    previous_default = state.default_app
    previous_current = state._tls.current_app
    try:
        yield
    finally:
        created = {state.default_app, state._tls.current_app} - {previous_default, previous_current, None}
        state.set_default_app(previous_default)
        state._set_current_app(previous_current)
        for app in created:
            assert app is not None
            app.close()
