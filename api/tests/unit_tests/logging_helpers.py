"""Reversible initialization of test-owned logging routes."""

import logging

import pytest

from libs.sensitive_http_telemetry import SensitiveHttpLogFilter


def protect_existing_log_routes(monkeypatch: pytest.MonkeyPatch, *, emitters: tuple[str, ...]) -> None:
    """Qualify imported SDK sinks for a test without changing runtime readiness.

    Provider collection imports SDKs that configure direct handlers: Langfuse
    uses httpx and MLflow uses sqlalchemy.engine. Test-owned logging must protect
    its existing routes as well as root sinks. Monkeypatch restores SDK setup.
    """
    for name, logger in logging.Logger.manager.loggerDict.copy().items():
        if isinstance(logger, logging.Logger) and any(
            name == emitter or name.startswith(emitter + ".") or emitter.startswith(name + ".") for emitter in emitters
        ):
            monkeypatch.setattr(logger, "propagate", True)
            monkeypatch.setattr(logger, "level", logging.NOTSET)
            for handler in logger.handlers:
                monkeypatch.setattr(handler, "filters", [*handler.filters, SensitiveHttpLogFilter()])
