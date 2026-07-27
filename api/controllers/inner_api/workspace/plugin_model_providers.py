from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field

from controllers.common.schema import register_schema_model
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.plugin.plugin_service import PluginService


class InvalidatePluginModelProvidersCachePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_ids: list[str] = Field(default_factory=list, description="Workspace ids whose cache should be invalidated")


register_schema_model(inner_api_ns, InvalidatePluginModelProvidersCachePayload)


@inner_api_ns.route("/enterprise/workspace/plugin-model-providers/invalidate")
class EnterprisePluginModelProvidersCacheInvalidate(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc(
        "enterprise_invalidate_plugin_model_providers_cache",
        responses={
            200: "Cache invalidated",
            400: "Invalid request",
            401: "Unauthorized - invalid API key",
        },
    )
    @inner_api_ns.expect(inner_api_ns.models[InvalidatePluginModelProvidersCachePayload.__name__])
    def post(self):
        args = InvalidatePluginModelProvidersCachePayload.model_validate(inner_api_ns.payload or {})

        for tenant_id in args.tenant_ids:
            PluginService.invalidate_plugin_model_providers_cache(tenant_id)

        return {"result": "success"}, 200
