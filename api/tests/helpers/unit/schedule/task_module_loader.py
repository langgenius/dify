import importlib.util
import sys
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest

_SCHEDULE_DIR = Path(__file__).resolve().parents[4] / "schedule"


class _CeleryStub:
    def task(self, *_args: object, **_kwargs: object) -> Callable[[Callable[..., object]], Callable[..., object]]:
        def decorator(func: Callable[..., object]) -> Callable[..., object]:
            return func

        return decorator


class _AppStub(ModuleType):
    celery = _CeleryStub()


def load_schedule_module(monkeypatch: pytest.MonkeyPatch, name: str) -> ModuleType:
    # Importing a task module for real runs ``import app``, which builds the Flask app
    # and installs its logging filters for the rest of the test session.
    spec = importlib.util.spec_from_file_location(f"_test_{name}", _SCHEDULE_DIR / f"{name}.py")
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    with monkeypatch.context() as patch:
        patch.setitem(sys.modules, "app", _AppStub("app"))
        # Dataclasses in the module resolve their annotations through sys.modules.
        patch.setitem(sys.modules, spec.name, module)
        spec.loader.exec_module(module)
    return module
