"""Restore Celery app ownership after tests initialize a real Flask-backed app."""

from collections.abc import Iterator

import pytest
from celery import _state


@pytest.fixture
def preserve_celery_apps() -> Iterator[None]:
    previous_default = _state.default_app
    previous_current = _state._tls.current_app
    try:
        yield
    finally:
        created = {_state.default_app, _state._tls.current_app} - {previous_default, previous_current, None}
        _state.set_default_app(previous_default)
        _state._set_current_app(previous_current)
        for app in created:
            app.close()
