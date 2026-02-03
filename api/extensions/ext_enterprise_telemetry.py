"""Flask extension for enterprise telemetry lifecycle management.

Initializes the EnterpriseExporter singleton during ``create_app()`` (single-threaded),
registers blinker event handlers, and hooks atexit for graceful shutdown.

Skipped entirely when ``ENTERPRISE_ENABLED`` and ``ENTERPRISE_TELEMETRY_ENABLED`` are false (``is_enabled()`` gate).
"""

from __future__ import annotations

import atexit
import logging
from typing import TYPE_CHECKING

from configs import dify_config

if TYPE_CHECKING:
    from dify_app import DifyApp
    from enterprise.telemetry.exporter import EnterpriseExporter

logger = logging.getLogger(__name__)

_exporter: EnterpriseExporter | None = None


def is_enabled() -> bool:
    return bool(dify_config.ENTERPRISE_ENABLED and dify_config.ENTERPRISE_TELEMETRY_ENABLED)


def init_app(app: DifyApp) -> None:
    global _exporter

    if not is_enabled():
        return

    from enterprise.telemetry.exporter import EnterpriseExporter

    _exporter = EnterpriseExporter(dify_config)
    atexit.register(_exporter.shutdown)

    # Import to trigger @signal.connect decorator registration
    import enterprise.telemetry.event_handlers  # noqa: F401  # type: ignore[reportUnusedImport]

    logger.info("Enterprise telemetry initialized")


def get_enterprise_exporter() -> EnterpriseExporter | None:
    return _exporter
