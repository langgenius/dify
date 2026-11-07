"""Trusted endpoint for resolving a workspace datasource default to a concrete id."""

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field

from controllers.common.schema import register_response_schema_models, register_schema_model
from controllers.console.wraps import model_validate
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import plugin_inner_api_only
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from services.data_source.credential_metadata_service import DatasourceCredentialMetadataService


class InnerDatasourceDefaultCredentialPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str = Field(min_length=1, max_length=512, description="Workspace id.")
    plugin_id: str = Field(min_length=1, max_length=512, description="Datasource plugin id.")
    provider: str = Field(min_length=1, max_length=256, description="Datasource provider name.")


class InnerDatasourceCredentialMetadataResponse(ResponseModel):
    id: str
    name: str
    type: str
    is_default: bool


class InnerDatasourceDefaultCredentialResponse(ResponseModel):
    credential: InnerDatasourceCredentialMetadataResponse | None


register_schema_model(inner_api_ns, InnerDatasourceDefaultCredentialPayload)
register_response_schema_models(
    inner_api_ns,
    InnerDatasourceCredentialMetadataResponse,
    InnerDatasourceDefaultCredentialResponse,
)


@inner_api_ns.route("/datasource-credentials/default")
class InnerDatasourceDefaultCredentialApi(Resource):
    @plugin_inner_api_only
    @inner_api_ns.doc(
        "resolve_default_datasource_credential",
        description="Resolve the current workspace default datasource credential to a concrete id.",
        responses={
            200: "Default datasource credential resolved.",
            404: "Invalid plugin inner API key.",
        },
    )
    @inner_api_ns.expect(inner_api_ns.models[InnerDatasourceDefaultCredentialPayload.__name__])
    @inner_api_ns.response(
        200,
        "Default datasource credential resolved.",
        inner_api_ns.models[InnerDatasourceDefaultCredentialResponse.__name__],
    )
    @model_validate(InnerDatasourceDefaultCredentialPayload)
    def post(self, payload: InnerDatasourceDefaultCredentialPayload):
        credential = DatasourceCredentialMetadataService(
            credential_query=application_services().credential_queries
        ).resolve_default(
            tenant_id=payload.tenant_id,
            plugin_id=payload.plugin_id,
            provider=payload.provider,
        )
        return {
            "credential": (
                {
                    "id": credential.id,
                    "name": credential.name,
                    "type": credential.type,
                    "is_default": credential.is_default,
                }
                if credential is not None
                else None
            )
        }
