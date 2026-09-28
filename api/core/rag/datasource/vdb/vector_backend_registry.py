"""Vector store backend discovery.

Backends live in workspace packages under ``api/packages/dify-vdb-*/src/dify_vdb_*``. Each package
declares third-party dependencies and registers ``importlib`` entry points in group
``dify.vector_backends`` (see each package's ``pyproject.toml``).

Shared types and the :class:`~core.rag.datasource.vdb.vector_factory.AbstractVectorFactory` protocol
remain in this package (``vector_base``, ``vector_factory``, ``vector_type``, ``field``).

Optional **built-in** targets in ``_BUILTIN_VECTOR_FACTORY_TARGETS`` (normally empty) load without a
distribution; entry points take precedence when both exist.

After changing packages, run ``uv sync`` so installed dist-info entry points match ``pyproject.toml``.
"""

from __future__ import annotations

import importlib
import logging
from importlib.metadata import entry_points
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory

logger = logging.getLogger(__name__)

_VECTOR_FACTORY_CACHE: dict[str, type[AbstractVectorFactory]] = {}

# module_path:class_name — optional fallback when no distribution registers the backend.
_BUILTIN_VECTOR_FACTORY_TARGETS: dict[str, str] = {}


def clear_vector_factory_cache() -> None:
    """Drop lazily loaded factories (for tests or plugin reload)."""
    _VECTOR_FACTORY_CACHE.clear()


def _vector_backend_entry_points():
    return entry_points().select(group="dify.vector_backends")


def _load_plugin_factory(vector_type: str) -> type[AbstractVectorFactory] | None:
    for ep in _vector_backend_entry_points():
        if ep.name != vector_type:
            continue
        try:
            loaded = ep.load()
        except Exception:
            logger.exception("Failed to load vector backend entry point %s", ep.name)
            raise
        return loaded  # type: ignore[return-value]
    return None


def _unsupported(vector_type: str) -> ValueError:
    installed = sorted(ep.name for ep in _vector_backend_entry_points())
    available_msg = f" Installed backends: {', '.join(installed)}." if installed else " No backends installed."
    return ValueError(
        f"Vector store {vector_type!r} is not supported.{available_msg} "
        "Install a plugin (uv sync --group vdb-all, or vdb-<backend> per api/pyproject.toml), "
        "or register a dify.vector_backends entry point."
    )


def _load_builtin_factory(vector_type: str) -> type[AbstractVectorFactory]:
    target = _BUILTIN_VECTOR_FACTORY_TARGETS.get(vector_type)
    if not target:
        raise _unsupported(vector_type)
    module_path, _, attr = target.partition(":")
    module = importlib.import_module(module_path)
    return getattr(module, attr)  # type: ignore[no-any-return]


def get_vector_factory_class(vector_type: str) -> type[AbstractVectorFactory]:
    """Resolve :class:`AbstractVectorFactory` for a :class:`~VectorType` string value."""
    if vector_type in _VECTOR_FACTORY_CACHE:
        return _VECTOR_FACTORY_CACHE[vector_type]

    plugin_cls = _load_plugin_factory(vector_type)
    if plugin_cls is not None:
        _VECTOR_FACTORY_CACHE[vector_type] = plugin_cls
        return plugin_cls

    cls = _load_builtin_factory(vector_type)
    _VECTOR_FACTORY_CACHE[vector_type] = cls
    return cls
