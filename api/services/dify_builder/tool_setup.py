"""Reconcile Builder-owned setup reminders without granting Tool execution.

Only verified installed inventory entries may reach this owner. Generated
credential IDs are untrusted: preserve an exact actor/provider/tenant-visible
selection, otherwise remove it and keep the real installed Tool unconfigured.
Descriptions preserve user text. Only unchanged recognizable generated blocks
are removed/replaced; edits to a block remain user text. Fresh native admission
never reads these descriptions or stores a readiness Boolean on the node.
"""

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from services.tools.draft_tool_setup import (
    ToolDeclaration,
    inventory_tool_nodes,
    selected_credential_is_available,
    tool_key,
)

if TYPE_CHECKING:
    from services.dify_builder.agent.resources import ResourceRef

_START = "[Builder tool setup]"
_END = "[/Builder tool setup]"
_SETUP_TEXT = "Configure or select authorized credentials before testing or publishing."
_UNVERIFIED_TEXT = (
    "Credential setup could not be verified. Configure or select authorized credentials before testing or publishing."
)


def _description(description: str, *, action: str, needs_setup: bool, unverified: bool) -> str:
    """Replace only exact generated blocks; leave modified text verbatim."""
    label = " ".join(action.split())
    blocks = [f"{_START}\n{label}: {text}\n{_END}" for text in (_SETUP_TEXT, _UNVERIFIED_TEXT)]
    for block in blocks:
        description = description.replace("\n\n" + block, "").replace(block, "")
    if needs_setup:
        note = blocks[1 if unverified else 0]
        return description + ("\n\n" if description else "") + note
    return description


def reconcile_generated_tool_setup(
    *,
    tenant_id: str,
    actor_id: str | None,
    graph: Mapping[str, Any],
    tools: Mapping[tuple[str, str], "ResourceRef"],
) -> None:
    """Sanitize generated references and annotate delayed setup before preflight."""
    for node in inventory_tool_nodes(graph):
        data = node["data"]
        ref = tools.get(tool_key(data))
        if ref is None:
            # Unknown installed identities will be refused by the generation
            # allowlist; do not echo a generated credential into diagnostics.
            data.pop("credential_id", None)
            continue
        declaration = ToolDeclaration(
            provider=tool_key(data)[0],
            action=tool_key(data)[1],
            label=ref.label,
            needs_credentials=ref.needs_credentials or ref.readiness == "missing_config",
            is_plugin=bool(ref.plugin_id),
        )
        unverified = False
        if not declaration.needs_credentials:
            # Native credential-free declarations do not use a selected ID.
            data.pop("credential_id", None)
            available = True
        else:
            try:
                from extensions.ext_application_services import application_services

                available = selected_credential_is_available(
                    query=application_services().credential_queries,
                    tenant_id=tenant_id,
                    actor_id=actor_id,
                    declaration=declaration,
                    credential_id=data.get("credential_id"),
                )
            except Exception:
                available = False
                unverified = True
            if not available:
                data.pop("credential_id", None)
        data["desc"] = _description(
            str(data.get("desc") or ""),
            action=ref.label,
            needs_setup=not available,
            unverified=unverified,
        )
