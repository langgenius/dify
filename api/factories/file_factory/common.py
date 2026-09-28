"""Shared helpers for workflow file factory modules."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from core.workflow.file_reference import resolve_file_record_id


def resolve_mapping_file_id(mapping: Mapping[str, Any], *keys: str) -> str | None:
    """Resolve historical file identifiers from persisted mapping payloads.

    Workflow and model payloads can outlive file schema changes. Older rows may
    still carry concrete identifiers in legacy fields such as ``related_id``,
    while newer payloads use opaque references. Keep this compatibility lookup in
    the factory layer so historical data remains readable without reintroducing
    storage details into graph-layer ``File`` values.
    """

    for key in (*keys, "reference", "related_id"):
        raw_value = mapping.get(key)
        if isinstance(raw_value, str) and raw_value:
            resolved_value = resolve_file_record_id(raw_value)
            if resolved_value:
                return resolved_value
    return None
