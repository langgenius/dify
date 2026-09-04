from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol, runtime_checkable

from flask import g
from werkzeug.exceptions import NotFound

from core.rbac import RBACResourceScope
from services.rbac_resource_service import RBACResourceService

if TYPE_CHECKING:
    from models.agent import Agent

__all__ = [
    "AgentBehindApp",
    "AgentId",
    "DatasetByPipeline",
    "DatasetId",
    "PlainApp",
    "ResourceIdentity",
    "ResourceLocator",
    "Workspace",
    "agent_binding",
]

_AGENT_BINDING_CACHE_KEY = "_rbac_agent_bindings"


@dataclass(frozen=True)
class ResourceIdentity:
    scope: RBACResourceScope
    id: str


@runtime_checkable
class ResourceLocator(Protocol):
    scope: RBACResourceScope

    def locate(self, tenant_id: str, path_args: Mapping[str, object]) -> ResourceIdentity | None: ...

    def owner_id(self, tenant_id: str, identity: ResourceIdentity) -> str | None: ...


def _required(path_args: Mapping[str, object], param: str) -> str:
    value = path_args.get(param)
    if not value:
        raise ValueError(f"Missing {param} in request path")
    return str(value)


def agent_binding(tenant_id: str, app_id: str) -> "Agent | None":
    cache: dict[tuple[str, str], Agent | None] = g.setdefault(_AGENT_BINDING_CACHE_KEY, {})
    key = (tenant_id, app_id)
    if key not in cache:
        cache[key] = RBACResourceService.get_app_agent_binding(tenant_id, app_id)
    return cache[key]


class Workspace:
    scope = RBACResourceScope.WORKSPACE

    def locate(self, tenant_id: str, path_args: Mapping[str, object]) -> ResourceIdentity | None:
        return ResourceIdentity(self.scope, "")

    def owner_id(self, tenant_id: str, identity: ResourceIdentity) -> str | None:
        return None

    def __repr__(self) -> str:
        return "Workspace()"


class _ParamLocator:
    scope: RBACResourceScope
    default_param: str

    def __init__(self, param: str | None = None):
        self.param = param or self.default_param

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.param!r})"


class AgentId(_ParamLocator):
    scope = RBACResourceScope.AGENT
    default_param = "agent_id"

    def locate(self, tenant_id: str, path_args: Mapping[str, object]) -> ResourceIdentity | None:
        return ResourceIdentity(self.scope, _required(path_args, self.param))

    def owner_id(self, tenant_id: str, identity: ResourceIdentity) -> str | None:
        return None


class PlainApp(_ParamLocator):
    scope = RBACResourceScope.APP
    default_param = "app_id"

    def locate(self, tenant_id: str, path_args: Mapping[str, object]) -> ResourceIdentity | None:
        app_id = _required(path_args, self.param)
        if agent_binding(tenant_id, app_id) is not None:
            return None
        return ResourceIdentity(self.scope, app_id)

    def owner_id(self, tenant_id: str, identity: ResourceIdentity) -> str | None:
        return RBACResourceService.get_app_maintainer(tenant_id, identity.id)


class AgentBehindApp(_ParamLocator):
    scope = RBACResourceScope.AGENT
    default_param = "app_id"

    def locate(self, tenant_id: str, path_args: Mapping[str, object]) -> ResourceIdentity | None:
        from models.agent import AgentScope

        binding = agent_binding(tenant_id, _required(path_args, self.param))
        if binding is None or binding.scope == AgentScope.WORKFLOW_ONLY:
            return None
        return ResourceIdentity(self.scope, str(binding.id))

    def owner_id(self, tenant_id: str, identity: ResourceIdentity) -> str | None:
        return None


class DatasetId(_ParamLocator):
    scope = RBACResourceScope.DATASET
    default_param = "dataset_id"

    def locate(self, tenant_id: str, path_args: Mapping[str, object]) -> ResourceIdentity | None:
        return ResourceIdentity(self.scope, _required(path_args, self.param))

    def owner_id(self, tenant_id: str, identity: ResourceIdentity) -> str | None:
        return RBACResourceService.get_dataset_maintainer(tenant_id, identity.id)


class DatasetByPipeline(DatasetId):
    default_param = "pipeline_id"

    def locate(self, tenant_id: str, path_args: Mapping[str, object]) -> ResourceIdentity | None:
        pipeline_id = _required(path_args, self.param)
        dataset_id = RBACResourceService.get_dataset_id_by_pipeline(tenant_id, pipeline_id)
        if dataset_id is None:
            raise NotFound("Dataset not found for pipeline")
        return ResourceIdentity(self.scope, dataset_id)
