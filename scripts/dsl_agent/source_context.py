"""Compatibility shim — implementation moved to api/core/dsl_agent/source_context.py.

This forwarder keeps the standalone CLI scripts and smoke tests working with
their existing `from source_context import ...` calls. All logic now lives in the
`core.dsl_agent` package so the api service and the CLI share one source.
"""
import sys
from pathlib import Path

_API_DIR = Path(__file__).resolve().parents[2] / "api"
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

from core.dsl_agent import source_context as _impl  # noqa: E402

globals().update({_k: _v for _k, _v in vars(_impl).items() if not _k.startswith("__")})
