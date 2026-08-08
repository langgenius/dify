"""Shared helpers for workflow file factory modules."""

from __future__ import annotations

from collections.abc import Mapping

from core.workflow.file_reference import resolve_file_record_id

FileMapping = Mapping[str, object]


def get_mapping_str(mapping: FileMapping, *keys: str) -> str | None:
    """Return the first non-empty string value stored under the provided keys."""

    for key in keys:
        raw_value = mapping.get(key)
        if isinstance(raw_value, str) and raw_value:
            return raw_value
    return None


def resolve_mapping_file_id(mapping: FileMapping, *keys: str) -> str | None:
    """Resolve historical file identifiers from persisted mapping payloads.

    Workflow and model payloads can outlive file schema changes. Older rows may
    still carry concrete identifiers in legacy fields such as ``related_id``,
    while newer payloads use opaque references. Keep this compatibility lookup in
    the factory layer so historical data remains readable without reintroducing
    storage details into graph-layer ``File`` values.
    """

    for raw_value in filter(None, (get_mapping_str(mapping, key) for key in (*keys, "reference", "related_id"))):
        resolved_value = resolve_file_record_id(raw_value)
        if resolved_value:
            return resolved_value
    return None
