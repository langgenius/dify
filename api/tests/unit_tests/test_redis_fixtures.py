import sys
from types import ModuleType

import pytest

from tests.unit_tests.conftest import _patch_redis_clients_on_loaded_modules, redis_mock


@pytest.mark.parametrize("attribute", ["redis_client", "_pubsub_redis_client"])
def test_redis_rebinding_covers_new_globals_and_replaced_modules(
    monkeypatch: pytest.MonkeyPatch, attribute: str
) -> None:
    name = "_redis_fixture_probe"
    module = ModuleType(name)
    monkeypatch.setitem(sys.modules, name, module)
    _patch_redis_clients_on_loaded_modules()

    # A module can gain a reference after it was already seen by another test.
    setattr(module, attribute, object())
    _patch_redis_clients_on_loaded_modules()
    assert vars(module)[attribute] is redis_mock

    # Rebind on every test, even when the set of imported modules is unchanged.
    setattr(module, attribute, object())
    _patch_redis_clients_on_loaded_modules()
    assert vars(module)[attribute] is redis_mock

    replacement = ModuleType(name)
    setattr(replacement, attribute, object())
    monkeypatch.setitem(sys.modules, name, replacement)
    _patch_redis_clients_on_loaded_modules()
    assert vars(replacement)[attribute] is redis_mock


def test_redis_rebinding_does_not_resolve_lazy_module_attributes(monkeypatch: pytest.MonkeyPatch) -> None:
    module = ModuleType("_lazy_redis_fixture_probe")

    def resolve(name: str) -> object:
        pytest.fail(f"Redis rebinding must not import unrelated lazy attributes: {name}")

    vars(module)["__getattr__"] = resolve
    monkeypatch.setitem(sys.modules, module.__name__, module)
    _patch_redis_clients_on_loaded_modules()
