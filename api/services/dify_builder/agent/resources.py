"""Read-only tenant resource inventory for Dify Builder cognition/grounding.

One entry point -- list_tenant_resources -- returns the tenant's configured
models, datasets, and tools normalized to id+label. Each source degrades to
an empty list on failure so a missing provider never breaks the advance.
"""

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.tools.tool_manager import ToolManager
from core.workflow.generator.tool_catalogue import build_tool_catalogue
from extensions.ext_database import db
from models.dataset import Dataset
from services.model_provider_service import ModelProviderService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResourceRef:
    id: str
    label: str
    meta: str = ""
    readiness: str = "ready"


@dataclass(frozen=True)
class TenantResources:
    models: list[ResourceRef]
    datasets: list[ResourceRef]
    tools: list[ResourceRef]


def _list_models(tenant_id: str) -> list[Any]:
    return ModelProviderService().get_models_by_model_type(tenant_id=tenant_id, model_type="llm")


def _list_datasets(tenant_id: str) -> list[Any]:
    with Session(db.engine) as session:
        return list(session.scalars(select(Dataset).where(Dataset.tenant_id == tenant_id)).all())


def _list_tools(tenant_id: str) -> list[dict]:
    return list(build_tool_catalogue(tenant_id))


def _authorized_providers(tenant_id: str) -> set[str]:
    """Providers with a credential row, i.e. authorized for this tenant.

    Mirrors ``ToolTransformService.builtin_provider_to_user_provider``
    (api/services/tools/tools_transform_service.py) so the Builder and the
    console's own tools page can never disagree about what is usable: a
    provider is usable when it needs no credentials, or when a
    ``tool_builtin_providers`` row exists for it.
    """
    return {str(p.provider) for p in ToolManager.list_default_builtin_providers(tenant_id)}


def _tool_readiness(entry: dict, authorized: set[str] | None) -> str:
    """"ready" unless the tool needs credentials it doesn't have.

    ``authorized is None`` means the authorization lookup itself failed
    (see the ``build_tools`` try/except below) -- distinct from a
    successful lookup that simply found zero rows. We fail OPEN in that
    case: reporting every credentialed tool "missing_config" on a
    transient DB error would hide tools the tenant genuinely has
    configured, which is a worse failure than occasionally recommending
    one we can't currently confirm. A real credential gap still surfaces
    the next time the lookup succeeds, and the actual authorization check
    happens again at tool-execution time regardless of this label.
    """
    if not entry.get("needs_credentials"):
        return "ready"
    if authorized is None:
        return "ready"
    return "ready" if entry["provider_name"] in authorized else "missing_config"


def _safe(build, source: str) -> list:
    try:
        return build()
    except Exception:  # a missing/mis-configured source degrades to empty, never raises
        logger.warning(
            "Dify Builder: resource source %r failed for the current tenant; treating as empty",
            source,
            exc_info=True,
        )
        return []


def list_tenant_resources(tenant_id: str) -> TenantResources:
    def build_models():
        models: list[ResourceRef] = []
        for prov in _list_models(tenant_id):
            for m in getattr(prov, "models", []):
                name = getattr(m, "model", "")
                model_id = f"{prov.provider}/{name}"
                models.append(ResourceRef(id=model_id, label=model_id))
        return models

    def build_datasets():
        return [ResourceRef(id=str(d.id), label=str(d.name)) for d in _list_datasets(tenant_id)]

    def build_tools():
        tools = _list_tools(tenant_id)
        # Only pay for the authorization query when some listed tool would
        # actually be gated on it -- a tenant with no credentialed tools
        # installed never needs to touch tool_builtin_providers.
        authorized: set[str] | None = None
        if any(t.get("needs_credentials") for t in tools):
            try:
                authorized = _authorized_providers(tenant_id)
            except Exception:  # the lookup degrades to "unknown", not "none authorized"
                logger.warning(
                    "Dify Builder: resource source %r failed for the current tenant; treating as empty",
                    "tool authorization",
                    exc_info=True,
                )
                authorized = None
        return [
            ResourceRef(id=f"{t['provider_name']}/{t['tool_name']}", label=str(t.get("tool_label") or t["tool_name"]),
                        meta=str(t.get("description") or ""), readiness=_tool_readiness(t, authorized))
            for t in tools
        ]

    models = _safe(build_models, "models")
    datasets = _safe(build_datasets, "datasets")
    tools = _safe(build_tools, "tools")
    return TenantResources(models=models, datasets=datasets, tools=tools)
