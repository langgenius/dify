"""Public installed API metadata for Builder discovery, without authorization.

Only stored public columns and validated tool bundles are read. Native API
controllers own credential handling and execution; constructing one here
would cross the discovery boundary. Provider UUIDs identify native actions,
while provider names and descriptions supply readable capability metadata.
"""

import json
import logging
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select

from core.db.session_factory import session_factory
from core.tools.entities.tool_bundle import ApiToolBundle
from models.tools import ApiToolProvider

if TYPE_CHECKING:
    from core.workflow.generator.tool_catalogue import ToolCatalogueEntry

logger = logging.getLogger(__name__)


def list_api_tool_metadata(tenant_id: str) -> list["ToolCatalogueEntry"]:
    """Return tenant-wide native API declarations, isolated per provider/action.

    Creator identity is irrelevant to workspace visibility. Authorization is
    explicitly unverified: the conservative ``needs_credentials`` flag must
    never be interpreted as a known auth requirement or resolved with builtin
    credentials. The resource owner handles this metadata state separately.
    Query failures propagate to the catalogue caller's source-level guard.
    """
    statement = select(
        ApiToolProvider.id,
        ApiToolProvider.tenant_id,
        ApiToolProvider.name,
        ApiToolProvider.description,
        ApiToolProvider.tools_str,
    ).where(ApiToolProvider.tenant_id == tenant_id)
    with session_factory.create_session() as session:
        rows = session.execute(statement).mappings().all()

    entries: list[ToolCatalogueEntry] = []
    for row in rows:
        provider_id = row["id"]
        try:
            if row["tenant_id"] != tenant_id:
                continue
            # Preserve the complete native key; never turn the readable name
            # into an identifier or silently repair malformed identifiers.
            if not isinstance(provider_id, str) or str(UUID(provider_id)) != provider_id:
                continue
            if not isinstance(row["name"], str) or not isinstance(row["description"], str):
                continue
            bundles = json.loads(row["tools_str"])
            if not isinstance(bundles, list):
                raise ValueError("API bundles must be a list")
        except (TypeError, ValueError):
            logger.warning("Workflow generator: invalid public API provider metadata; skipping provider")
            continue

        for raw_bundle in bundles:
            try:
                bundle = ApiToolBundle.model_validate(raw_bundle)
                action = bundle.operation_id or "default_tool"
                summary = (bundle.summary or "").strip()
                declared_description = bundle.openapi.get("description")
                description = summary
                if isinstance(declared_description, str) and declared_description.strip():
                    declared_description = declared_description.strip()
                    if declared_description != summary:
                        description = " — ".join(part for part in (summary, declared_description) if part)
                entries.append(
                    {
                        "provider_name": provider_id,
                        "provider_type": "api",
                        "plugin_id": "",
                        "tool_name": action,
                        "tool_label": action,
                        "description": description,
                        "provider_label": row["name"],
                        "provider_description": row["description"],
                        "parameters": [parameter.model_dump(mode="json") for parameter in bundle.parameters or []],
                        # Native ApiTool's ToolEntity exposes generic text/json;
                        # response declarations never create dynamic selectors.
                        "output_schema": {},
                        "needs_credentials": True,
                        "authorization_metadata": "unverified",
                    }
                )
            except (TypeError, ValueError):
                logger.warning("Workflow generator: invalid public API action metadata in provider %s", provider_id)
                continue
    return entries
