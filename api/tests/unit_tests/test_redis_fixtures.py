"""Redis rebinding must discover changes without invoking ordinary missing attributes."""

import sys
from types import ModuleType

import pytest

from tests.unit_tests.conftest import _patch_redis_clients_on_loaded_modules, redis_mock


def test_rebinds_both_clients_and_preserves_other_attributes(monkeypatch: pytest.MonkeyPatch) -> None:
    module = ModuleType("redis_fixture_probe")
    original = object()
    vars(module).update(redis_client=original, _pubsub_redis_client=original, unrelated=original)
    monkeypatch.setitem(sys.modules, module.__name__, module)

    _patch_redis_clients_on_loaded_modules()

    assert vars(module)["redis_client"] is redis_mock
    assert vars(module)["_pubsub_redis_client"] is redis_mock
    assert vars(module)["unrelated"] is original


def test_discovers_late_imports_replacements_and_new_attributes(monkeypatch: pytest.MonkeyPatch) -> None:
    name = "redis_fixture_probe"
    module = ModuleType(name)
    monkeypatch.setitem(sys.modules, name, module)
    _patch_redis_clients_on_loaded_modules()
    assert "redis_client" not in vars(module)

    vars(module)["redis_client"] = object()
    _patch_redis_clients_on_loaded_modules()
    assert vars(module)["redis_client"] is redis_mock

    replacement = ModuleType(name)
    vars(replacement)["redis_client"] = object()
    monkeypatch.setitem(sys.modules, name, replacement)
    _patch_redis_clients_on_loaded_modules()
    assert vars(replacement)["redis_client"] is redis_mock

    late = ModuleType("redis_fixture_late_import")
    vars(late)["_pubsub_redis_client"] = object()
    monkeypatch.setitem(sys.modules, late.__name__, late)
    _patch_redis_clients_on_loaded_modules()
    assert vars(late)["_pubsub_redis_client"] is redis_mock


def test_preserves_dynamic_module_exports(monkeypatch: pytest.MonkeyPatch) -> None:
    module = ModuleType("redis_fixture_dynamic")

    def dynamic_attribute(name: str) -> object:
        if name == "redis_client":
            return object()
        raise AttributeError(name)

    vars(module)["__getattr__"] = dynamic_attribute
    monkeypatch.setitem(sys.modules, module.__name__, module)
    _patch_redis_clients_on_loaded_modules()
    assert vars(module)["redis_client"] is redis_mock
    assert "_pubsub_redis_client" not in vars(module)


def test_preserves_custom_module_assignment(monkeypatch: pytest.MonkeyPatch) -> None:
    assignments: list[str] = []

    class CustomModule(ModuleType):
        def __setattr__(self, name: str, value: object) -> None:
            assignments.append(name)
            super().__setattr__(name, value)

    module = CustomModule("redis_fixture_custom")
    vars(module)["redis_client"] = object()
    monkeypatch.setitem(sys.modules, module.__name__, module)
    _patch_redis_clients_on_loaded_modules()
    assert assignments == ["redis_client"]
    assert vars(module)["redis_client"] is redis_mock
