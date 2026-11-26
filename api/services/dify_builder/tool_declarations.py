"""Installed Tool identities and credential visibility for generated drafts."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from models.provider_ids import ToolProviderID
from services.credentials.query import CredentialQuery, ToolCredentialMetadata
from services.workflow_ref_service import WorkflowRef

INVENTORY_TOOL_PROVIDER_TYPES = frozenset({"builtin", "plugin"})


@dataclass(frozen=True, slots=True)
class ToolDeclaration:
    provider: str
    action: str
    label: str
    needs_credentials: bool
    is_plugin: bool


def inventory_tool_nodes(graph: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Existing built-in/plugin Tool nodes; other provider types keep their owners."""
    return [
        node
        for node in graph.get("nodes") or []
        if isinstance(node, dict)
        and isinstance(data := node.get("data"), dict)
        and data.get("type") == "tool"
        and str(data.get("provider_type") or "builtin") in INVENTORY_TOOL_PROVIDER_TYPES
    ]


def tool_key(data: Mapping[str, Any]) -> tuple[str, str]:
    return str(data.get("provider_id") or data.get("provider_name") or ""), str(data.get("tool_name") or "")


def _selected_credential_metadata(
    *,
    query: CredentialQuery,
    tenant_id: str,
    actor_id: str | None,
    declaration: ToolDeclaration,
    credential_id: object,
    workflow_ref: WorkflowRef | None = None,
    node_id: str | None = None,
) -> ToolCredentialMetadata | None:
    """Exact native selection and canonical provider chain; query failures propagate.

    ``None``/empty ID means the actual native default/oldest. A supplied invalid
    ID cannot silently fall back. No actor permits only team-shared metadata.
    """
    if not declaration.needs_credentials:
        return None
    selected_id = None
    if credential_id is not None and credential_id != "":
        if type(credential_id) is not str:
            return None
        try:
            if str(UUID(credential_id)) != credential_id:
                return None
        except ValueError:
            return None
        selected_id = credential_id
    metadata = None
    if (
        selected_id is not None
        and declaration.is_plugin
        and workflow_ref is not None
        and workflow_ref.tenant_id == tenant_id
        and node_id is not None
    ):
        metadata = query.resolve_workflow_tool_credential_metadata(
            workflow_ref=workflow_ref,
            node_id=node_id,
            provider=declaration.provider,
            action=declaration.action,
            credential_id=selected_id,
        )
    if metadata is None:
        legacy_provider = ToolProviderID(declaration.provider).provider_name if declaration.is_plugin else None
        metadata = query.resolve_tool_credential_metadata(
            workspace_id=tenant_id,
            provider=declaration.provider,
            legacy_provider=legacy_provider,
            actor_id=actor_id,
            credential_id=selected_id,
        )
    if not isinstance(metadata, ToolCredentialMetadata):
        return None
    if selected_id is not None and metadata.id != selected_id:
        return None
    if metadata.provider == declaration.provider:
        return metadata
    # A legacy short name is canonical only for its real native provider, not
    # another organization's plugin with the same provider-name suffix.
    if declaration.is_plugin:
        try:
            return metadata if str(ToolProviderID(metadata.provider)) == declaration.provider else None
        except ValueError:
            return None
    return None


def selected_credential_is_available(
    *,
    query: CredentialQuery,
    tenant_id: str,
    actor_id: str | None,
    declaration: ToolDeclaration,
    credential_id: object,
    workflow_ref: WorkflowRef | None = None,
    node_id: str | None = None,
) -> bool:
    return (
        not declaration.needs_credentials
        or _selected_credential_metadata(
            query=query,
            tenant_id=tenant_id,
            actor_id=actor_id,
            declaration=declaration,
            credential_id=credential_id,
            workflow_ref=workflow_ref,
            node_id=node_id,
        )
        is not None
    )
