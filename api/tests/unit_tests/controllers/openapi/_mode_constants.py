"""Shared mode lists for the openapi app-list query tests.

Single source so adding/removing a listable app type is a one-line change
across every query-validator test.
"""

from __future__ import annotations

LISTABLE_MODES = ["completion", "chat", "advanced-chat", "workflow", "agent-chat"]
NON_LISTABLE_MODES = ["rag-pipeline", "channel", "agent"]
