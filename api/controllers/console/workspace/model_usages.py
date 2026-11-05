from typing import Literal

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.rbac import RBACCheck, Workspace
from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, model_validate
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from services.model_provider.usage_query import ModelUsageSource

# Same gate as the model write endpoints: workspace owner and admin, or the plugin-preferences permission
# under RBAC. Under RBAC the listed apps also follow the Console app-list visibility (see the service).
_MODEL_MANAGER_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})


class ModelUsageQuery(BaseModel):
    model: str = Field(min_length=1, max_length=255, description="Model name")
    model_type: Literal["llm"] = Field(default="llm", description="Model type; only llm is supported")


class ModelUsageResponse(ResponseModel):
    app_id: str
    app_name: str
    app_mode: str
    source: ModelUsageSource
    node_id: str | None = None
    node_title: str | None = None
    node_type: str | None = None


class ModelUsageListResponse(ResponseModel):
    data: list[ModelUsageResponse]
    inaccessible_count: int = Field(description="Matching usages in apps the caller cannot view; not listed in data")


register_response_schema_models(console_ns, ModelUsageResponse, ModelUsageListResponse)


@console_ns.route("/workspaces/current/model-providers/<path:provider>/models/usages")
class ModelProviderModelUsageApi(Resource):
    @console_ns.doc("list_model_usages")
    @console_ns.doc(
        description=(
            "List the current workspace's apps and workflow nodes that select this LLM, read from draft and "
            "currently published workflows and app model configurations. Only apps the caller can view are listed."
        )
    )
    @console_ns.doc(params=query_params_from_model(ModelUsageQuery))
    @console_ns.response(200, "Model usages retrieved successfully", console_ns.models[ModelUsageListResponse.__name__])
    @console_account_admission(
        allowed_roles=_MODEL_MANAGER_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.PLUGIN_PREFERENCES, Workspace())],
    )
    @model_validate(ModelUsageQuery)
    def get(self, req_data: ModelUsageQuery, request_context: RequestContext, provider: str):
        result = application_services().model_usages.list_llm_usages(
            request_context, provider=provider, model=req_data.model
        )
        return dump_response(
            ModelUsageListResponse, {"data": result.usages, "inaccessible_count": result.inaccessible_count}
        )
