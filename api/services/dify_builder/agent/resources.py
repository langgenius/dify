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
        return [
            ResourceRef(id=f"{t['provider_name']}/{t['tool_name']}", label=str(t.get("tool_label") or t["tool_name"]),
                        meta=str(t.get("description") or ""))
            for t in _list_tools(tenant_id)
        ]

    models = _safe(build_models, "models")
    datasets = _safe(build_datasets, "datasets")
    tools = _safe(build_tools, "tools")
    return TenantResources(models=models, datasets=datasets, tools=tools)
