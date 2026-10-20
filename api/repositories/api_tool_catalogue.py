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

_MAX_RESPONSE_SCHEMA_DEPTH = 12
_MAX_RESPONSE_SCHEMA_NODES = 512
_MAX_RESPONSE_SCHEMA_BYTES = 8192


def _response_schema_state(schema: object) -> str:
    """Bound directly declared JSON without resolving refs or dropping fields."""
    if not isinstance(schema, dict):
        return "unsupported"
    pending: list[tuple[object, int]] = [(schema, 0)]
    visited = 0
    while pending:
        value, depth = pending.pop()
        visited += 1
        if depth > _MAX_RESPONSE_SCHEMA_DEPTH or visited > _MAX_RESPONSE_SCHEMA_NODES:
            return "oversized"
        if isinstance(value, dict):
            if "$ref" in value:
                return "unsupported"
            if len(value) > _MAX_RESPONSE_SCHEMA_NODES:
                return "oversized"
            for key, child in value.items():
                if not isinstance(key, str):
                    return "unsupported"
                if len(key) > _MAX_RESPONSE_SCHEMA_BYTES:
                    return "oversized"
                pending.append((child, depth + 1))
        elif isinstance(value, list):
            if len(value) > _MAX_RESPONSE_SCHEMA_NODES:
                return "oversized"
            pending.extend((child, depth + 1) for child in value)
        elif isinstance(value, str):
            if len(value) > _MAX_RESPONSE_SCHEMA_BYTES:
                return "oversized"
        elif value is not None and not isinstance(value, (bool, int, float)):
            return "unsupported"
    try:
        serialized = json.dumps(schema, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return "unsupported"
    return "declared" if len(serialized.encode()) <= _MAX_RESPONSE_SCHEMA_BYTES else "oversized"


def _response_contracts(operation: dict[str, object]) -> dict[str, object]:
    """Keep one directly declared successful JSON body schema as public facts.

    Absent, ambiguous, referenced or oversized declarations establish no body
    shape. These are HTTP response facts, never native Tool output selectors.
    """
    responses = operation.get("responses")
    empty: list[dict[str, object]] = []
    if not isinstance(responses, dict):
        return {"state": "absent", "schemas": empty}
    if len(responses) > 64:
        return {"state": "oversized", "schemas": empty}
    schemas: list[dict[str, object]] = []
    for status, response in responses.items():
        if not isinstance(status, str) or not (
            (len(status) == 3 and status.isdigit() and 200 <= int(status) < 300) or status.upper() == "2XX"
        ):
            continue
        if not isinstance(response, dict):
            continue
        content = response.get("content")
        media = content.get("application/json") if isinstance(content, dict) else None
        if not isinstance(media, dict) or "schema" not in media:
            continue
        schemas.append({"status": status, "media_type": "application/json", "schema": media["schema"]})
    if not schemas:
        return {"state": "absent", "schemas": empty}
    if len(schemas) != 1:
        return {"state": "ambiguous", "schemas": empty}
    state = _response_schema_state(schemas[0]["schema"])
    return {"state": state, "schemas": schemas if state == "declared" else empty}


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
                        "response_contracts": _response_contracts(bundle.openapi),
                        "needs_credentials": True,
                        "authorization_metadata": "unverified",
                    }
                )
            except (TypeError, ValueError):
                logger.warning("Workflow generator: invalid public API action metadata in provider %s", provider_id)
                continue
    return entries
