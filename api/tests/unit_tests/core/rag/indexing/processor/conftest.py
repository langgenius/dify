from contextlib import AbstractContextManager, nullcontext
from typing import Any

import pytest


class _FakeFlaskApp:
    def app_context(self) -> AbstractContextManager[None]:
        return nullcontext()


class _FakeExecutor:
    def __init__(self, future: Any) -> None:
        self._future = future

    def __enter__(self) -> "_FakeExecutor":
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> bool:
        return False

    def submit(self, func: object, preview: object) -> Any:
        return self._future


@pytest.fixture
def fake_flask_app() -> _FakeFlaskApp:
    return _FakeFlaskApp()


@pytest.fixture
def fake_executor_cls() -> type[_FakeExecutor]:
    return _FakeExecutor
