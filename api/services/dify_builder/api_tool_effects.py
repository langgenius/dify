"""Owned custom API selection and native definition projection; no credentials are decrypted.

A definition is execution evidence, never a permission or a semantic read verdict.
Only the selected tenant-owned operation is projected. Native admission compares
that same operation and encrypted credential version before credential access.
"""

from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.tools.custom_tool.definition_binding import admit_api_definition, api_definition, provider_definition
from models.tools import ApiToolProvider

__all__ = ["admit_api_definition", "api_definition", "is_api_tool", "owned_api_definitions", "provider_definition"]


def owned_api_definitions(session: Session, tenant_id: str, graph: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Read selected tenant-owned definitions only; invalid/missing metadata grants no authority."""
    selections = {
        str(node["id"]): node["data"]
        for node in graph.get("nodes", [])
        if isinstance(node, Mapping)
        and isinstance(node.get("id"), str)
        and isinstance(node.get("data"), Mapping)
        and is_api_tool(node["data"])
    }
    if not selections:
        return {}
    providers = session.scalars(
        select(ApiToolProvider).where(
            ApiToolProvider.tenant_id == tenant_id,
            ApiToolProvider.id.in_({str(data.get("provider_id", "")) for data in selections.values()}),
        )
    ).all()
    rows = {row.id: row for row in providers}
    result = {}
    for node_id, data in selections.items():
        provider = rows.get(data.get("provider_id"))
        if provider is not None:
            try:
                definition = provider_definition(provider, str(data.get("tool_name", "")))
            except (ValueError, TypeError):
                definition = None
            if definition is not None:
                result[node_id] = definition
    return result


def is_api_tool(data: Mapping[str, Any]) -> bool:
    """Recognize the native custom API capability, independent of its display name."""
    return data.get("type") == "tool" and data.get("provider_type") == "api"
