from collections.abc import Iterator
from importlib.metadata import EntryPoint

import pytest

from core.rag.datasource.vdb import vector_backend_registry as registry


class _AcmeFactory:
    """Stand-in factory loaded through a real entry point."""


@pytest.fixture
def installed(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[EntryPoint]]:
    """Replace the installed ``dify.vector_backends`` entry points for one test."""
    registry.clear_vector_factory_cache()
    entries: list[EntryPoint] = []

    class _Groups:
        def select(self, *, group: str) -> tuple[EntryPoint, ...]:
            return tuple(entries) if group == "dify.vector_backends" else ()

    monkeypatch.setattr(registry, "entry_points", lambda: _Groups())
    yield entries
    registry.clear_vector_factory_cache()


def _entry(name: str, value: str) -> EntryPoint:
    return EntryPoint(name=name, value=value, group="dify.vector_backends")


def test_find_returns_registered_factory_and_caches_it(installed: list[EntryPoint]) -> None:
    installed.append(_entry("acme", f"{__name__}:_AcmeFactory"))

    assert registry.find_vector_factory_class("acme") is _AcmeFactory
    installed.clear()
    assert registry.find_vector_factory_class("acme") is _AcmeFactory


def test_find_returns_none_when_not_installed(installed: list[EntryPoint]) -> None:
    installed.append(_entry("other", f"{__name__}:_AcmeFactory"))

    assert registry.find_vector_factory_class("acme") is None


def test_find_raises_when_installed_backend_fails_to_import(installed: list[EntryPoint]) -> None:
    installed.append(_entry("acme", "dify_vdb_acme_missing_module:AcmeFactory"))

    with pytest.raises(ModuleNotFoundError, match="dify_vdb_acme_missing_module"):
        registry.find_vector_factory_class("acme")


def test_get_raises_unsupported_when_not_installed(installed: list[EntryPoint]) -> None:
    installed.append(_entry("other", f"{__name__}:_AcmeFactory"))

    with pytest.raises(ValueError, match="Vector store 'acme' is not supported. Installed backends: other."):
        registry.get_vector_factory_class("acme")


def test_get_returns_registered_factory(installed: list[EntryPoint]) -> None:
    installed.append(_entry("acme", f"{__name__}:_AcmeFactory"))

    assert registry.get_vector_factory_class("acme") is _AcmeFactory


class _DeclaringFactory:
    @classmethod
    def supported_retrieval_methods(cls) -> list[str]:
        return ["semantic_search", "full_text_search"]


def test_declared_retrieval_methods_reads_the_factory_hook(installed: list[EntryPoint]) -> None:
    installed.append(_entry("acme", f"{__name__}:_DeclaringFactory"))

    assert registry.declared_retrieval_methods("acme") == ["semantic_search", "full_text_search"]


def test_declared_retrieval_methods_defaults_to_none(installed: list[EntryPoint]) -> None:
    from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory

    assert AbstractVectorFactory.supported_retrieval_methods() is None
    installed.append(_entry("plain", f"{__name__}:_AcmeFactory"))

    assert registry.declared_retrieval_methods("plain") is None
    assert registry.declared_retrieval_methods("missing") is None


def test_declared_retrieval_methods_propagates_import_errors(installed: list[EntryPoint]) -> None:
    installed.append(_entry("acme", "dify_vdb_acme_missing_module:AcmeFactory"))

    with pytest.raises(ModuleNotFoundError):
        registry.declared_retrieval_methods("acme")
