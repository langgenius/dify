"""Unit tests for SupportedAppType — the listable subset of AppMode that the
openapi `app` face (`get app`) exposes and the CLI `--mode` whitelist derives from.
"""

from __future__ import annotations

from controllers.openapi._models import SUPPORTED_APP_TYPES, SupportedAppType
from models.model import AppMode


def test_supported_app_type_is_the_listable_subset_of_app_mode():
    """SupportedAppType (and the derived SUPPORTED_APP_TYPES tuple) is exactly the
    curated, listable subset of AppMode; non-app/runtime modes stay out."""
    assert {t.value for t in SupportedAppType} == {
        "completion",
        "chat",
        "advanced-chat",
        "workflow",
        "agent-chat",
    }
    assert set(SUPPORTED_APP_TYPES) <= set(AppMode)
    assert AppMode.AGENT not in SUPPORTED_APP_TYPES
    assert AppMode.RAG_PIPELINE not in SUPPORTED_APP_TYPES
    assert AppMode.CHANNEL not in SUPPORTED_APP_TYPES
