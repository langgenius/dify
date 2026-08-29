"""Read-only tenant resource inventory for Dify Builder cognition/grounding.

One entry point -- list_tenant_resources -- returns the tenant's configured
models, datasets, and tools normalized to id+label. Each source degrades to
an empty list on failure so a missing provider never breaks the advance.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from core.workflow.generator.tool_catalogue import build_tool_catalogue
from extensions.ext_database import db
from services.dataset_service import DatasetService
from services.model_provider_service import ModelProviderService


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
        items, _total = DatasetService.get_datasets(1, 100, session, tenant_id=tenant_id)
        return list(items)


def _list_tools(tenant_id: str) -> list[dict]:
    return list(build_tool_catalogue(tenant_id))


def _safe(fn, tenant_id: str) -> list:
    try:
        return fn(tenant_id)
    except Exception:  # a missing/mis-configured source degrades to empty, never raises
        return []


def list_tenant_resources(tenant_id: str) -> TenantResources:
    models: list[ResourceRef] = []
    for prov in _safe(_list_models, tenant_id):
        for m in getattr(prov, "models", []):
            name = getattr(m, "model", "")
            models.append(ResourceRef(id=f"{prov.provider}/{name}", label=f"{prov.provider}/{name}"))
    datasets = [ResourceRef(id=str(d.id), label=str(d.name)) for d in _safe(_list_datasets, tenant_id)]
    tools = [
        ResourceRef(id=f"{t['provider_name']}/{t['tool_name']}", label=str(t.get("tool_label") or t["tool_name"]),
                    meta=str(t.get("description") or ""))
        for t in _safe(_list_tools, tenant_id)
    ]
    return TenantResources(models=models, datasets=datasets, tools=tools)
