"""Owned custom API facts and native definition binding; no credentials are decrypted.

A definition is execution evidence, never a permission or a semantic read verdict.
Only the selected tenant-owned operation is projected. Native admission compares
that same operation and encrypted credential version before credential access.
"""

from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.tools.entities.tool_bundle import ApiToolBundle
from models.tools import ApiToolProvider
from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest


def api_definition(provider_id: str, bundle: ApiToolBundle, credential_version: str) -> dict[str, Any]:
    """Accept a validated native bundle; return nonsecret facts bound to its account version."""
    return {
        "provider_id": provider_id,
        "bundle": bundle.model_dump(mode="json"),
        "credential_version": credential_version,
    }


def provider_definition(provider: ApiToolProvider, action: str) -> dict[str, Any] | None:
    """Project exactly one owned operation, or None for missing/ambiguous declarations."""
    matches = [tool for tool in provider.tools if tool.operation_id == action]
    if len(matches) != 1:
        return None
    return {
        **api_definition(provider.id, matches[0], canonical_digest(provider.credentials_str)),
        "account": provider.name,
    }


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


def admit_api_definition(provider: ApiToolProvider, action: str, expected: str) -> ApiToolBundle:
    """Before decryption, return exactly the approved operation or refuse without provider I/O."""
    try:
        definition = provider_definition(provider, action)
    except (ValueError, TypeError):
        definition = None
    if definition is None or canonical_digest(definition) != expected:
        raise BuilderExecutionPolicyError("api_tool_definition_stale")
    return ApiToolBundle.model_validate(definition["bundle"])
