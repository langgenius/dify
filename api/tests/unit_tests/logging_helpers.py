"""Reversible initialization of test-owned logging routes."""

import logging

import pytest

from libs.sensitive_http_telemetry import SensitiveHttpLogFilter


class _LevelCacheReset:
    """Clear logging's per-logger enablement cache whenever ``armed`` is set or restored.

    Assigning ``Logger.level`` directly (as monkeypatch does) skips the cache clear
    that ``Logger.setLevel`` performs. ``isEnabledFor`` results computed under the
    patched levels then outlive ``monkeypatch.undo()``: a DEBUG root patch kept
    SQLAlchemy's Engine and pool loggers enabled for every later test in the worker,
    which logged SQL parameters (tracing secrets included) into their captured logs.
    """

    armed = False

    @staticmethod
    def _clear() -> None:
        root = logging.getLogger()
        root.setLevel(root.level)  # Same level; setLevel clears every logger's cache.

    def __setattr__(self, name: str, value: object) -> None:
        super().__setattr__(name, value)
        self._clear()

    def __delattr__(self, name: str) -> None:
        # monkeypatch undoes an attribute the instance did not own by deleting it.
        super().__delattr__(name)
        self._clear()


_LEVEL_CACHE_RESET = _LevelCacheReset()


def reset_logging_level_cache_on_undo(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear the level cache now and again after monkeypatch restores later level patches.

    Call before patching any ``Logger.level``: undo runs in reverse order, so this
    restore runs after every level patched later in the same test.
    """
    monkeypatch.setattr(_LEVEL_CACHE_RESET, "armed", True)


def protect_existing_log_routes(monkeypatch: pytest.MonkeyPatch, *, emitters: tuple[str, ...]) -> None:
    """Qualify imported SDK sinks for a test without changing runtime readiness.

    Provider collection imports SDKs that configure direct handlers: Langfuse
    uses httpx and MLflow uses sqlalchemy.engine. Test-owned logging must protect
    its existing routes as well as root sinks. Monkeypatch restores SDK setup,
    including logging's level cache, also for level patches the caller adds later.
    """
    reset_logging_level_cache_on_undo(monkeypatch)
    for name, logger in logging.Logger.manager.loggerDict.copy().items():
        if isinstance(logger, logging.Logger) and any(
            name == emitter or name.startswith(emitter + ".") or emitter.startswith(name + ".") for emitter in emitters
        ):
            monkeypatch.setattr(logger, "propagate", True)
            monkeypatch.setattr(logger, "level", logging.NOTSET)
            for handler in logger.handlers:
                monkeypatch.setattr(handler, "filters", [*handler.filters, SensitiveHttpLogFilter()])
