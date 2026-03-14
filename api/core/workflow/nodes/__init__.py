"""Workflow node implementations that remain under the legacy core.workflow namespace."""

from __future__ import annotations

import importlib
import pkgutil
from functools import lru_cache


@lru_cache(maxsize=1)
def register_core_nodes() -> None:
    """Import all core workflow node modules so they self-register with ``Node``."""
    for _, module_name, _ in pkgutil.walk_packages(__path__, __name__ + "."):
        importlib.import_module(module_name)
