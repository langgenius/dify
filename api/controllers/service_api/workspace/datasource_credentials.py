"""Service API for listing datasource credential ids in the current workspace."""

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_model,
)
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import validate_dataset_token
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from services.data_source.credential_metadata_service import DatasourceCredentialMetadataService


class DatasourceCredentialsQuery(BaseModel):
    plugin_id: str = Field(min_length=1, max_length=512, description="Datasource plugin id.")
    provider: str = Field(min_length=1, max_length=256, description="Datasource provider name.")


class DatasourceCredentialMetadataResponse(ResponseModel):
    id: str
    name: str
    type: str
    is_default: bool


class DatasourceCredentialListResponse(ResponseModel):
    data: list[DatasourceCredentialMetadataResponse]


register_schema_model(service_api_ns, DatasourceCredentialsQuery)
register_response_schema_models(
    service_api_ns,
    DatasourceCredentialMetadataResponse,
    DatasourceCredentialListResponse,
)


@service_api_ns.route("/datasource-credentials")
class DatasourceCredentialsApi(Resource):
    @service_api_ns.doc(
        summary="List Datasource Credentials",
        description=(
            "List datasource credential metadata for the current workspace. Credential values are never returned; "
            "use `id` as `credentialId` when creating a source connection."
        ),
        tags=["Datasource Credentials"],
        params=query_params_from_model(DatasourceCredentialsQuery),
        responses={
            200: "Datasource credential metadata retrieved successfully.",
            401: "Unauthorized - invalid API token.",
            403: "The API key is scoped to specific knowledge bases.",
        },
    )
    @service_api_ns.response(
        200,
        "Datasource credential metadata retrieved successfully.",
        service_api_ns.models[DatasourceCredentialListResponse.__name__],
    )
    @validate_dataset_token
    def get(self, tenant_id: str):
        query = query_params_from_request(DatasourceCredentialsQuery)
        credentials = DatasourceCredentialMetadataService(
            credential_query=application_services().credential_queries
        ).list(
            tenant_id=tenant_id,
            plugin_id=query.plugin_id,
            provider=query.provider,
        )
        return {
            "data": [
                {
                    "id": credential.id,
                    "name": credential.name,
                    "type": credential.type,
                    "is_default": credential.is_default,
                }
                for credential in credentials
            ]
        }
