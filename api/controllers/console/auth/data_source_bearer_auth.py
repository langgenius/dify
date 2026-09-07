from http import HTTPStatus
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field

from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.auth.error import (
    DataSourceApiKeyAuthCredentialsRejectedRequestError,
    DataSourceApiKeyAuthProviderNotSupportedError,
    DataSourceApiKeyAuthProviderUnavailableRequestError,
    InvalidDataSourceApiKeyAuthCredentialsRequestError,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, RBACResourceScope, model_validate
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.auth.errors import (
    DataSourceApiKeyAuthCredentialValidationError,
    DataSourceApiKeyAuthProviderUnavailableError,
    InvalidDataSourceApiKeyAuthCredentialsError,
    UnsupportedDataSourceApiKeyAuthProviderError,
)
from services.entities.data_source_api_key_auth_entities import (
    DataSourceApiKeyAuthBindingCreate,
    DataSourceApiKeyAuthCredentials,
)


class ApiKeyAuthConfigPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    api_key: str = Field(min_length=1)


class ApiKeyAuthCredentialsPayload(BaseModel):
    auth_type: str = Field(min_length=1)
    config: ApiKeyAuthConfigPayload


class ApiKeyAuthBindingPayload(BaseModel):
    category: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    credentials: ApiKeyAuthCredentialsPayload


class ApiKeyAuthDataSourceItem(ResponseModel):
    id: str
    category: str
    provider: str
    disabled: bool
    created_at: int
    updated_at: int


class ApiKeyAuthDataSourceListResponse(ResponseModel):
    sources: list[ApiKeyAuthDataSourceItem]


register_schema_models(console_ns, ApiKeyAuthBindingPayload)
register_response_schema_models(
    console_ns,
    SimpleResultResponse,
    ApiKeyAuthDataSourceItem,
    ApiKeyAuthDataSourceListResponse,
)


_ADMIN_OR_OWNER_ROLES = frozenset({TenantAccountRole.ADMIN, TenantAccountRole.OWNER})


@console_ns.route("/api-key-auth/data-source")
class ApiKeyAuthDataSource(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[ApiKeyAuthDataSourceListResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        bindings = application_services().data_source_api_key_auth.list_bindings(request_context)
        return dump_response(
            ApiKeyAuthDataSourceListResponse,
            {
                "sources": [
                    {
                        "id": binding.id,
                        "category": binding.category,
                        "provider": binding.provider,
                        "disabled": binding.disabled,
                        "created_at": int(binding.created_at.timestamp()),
                        "updated_at": int(binding.updated_at.timestamp()),
                    }
                    for binding in bindings
                ]
            },
        )


@console_ns.route("/api-key-auth/data-source/binding")
class ApiKeyAuthDataSourceBinding(Resource):
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.expect(console_ns.models[ApiKeyAuthBindingPayload.__name__])
    @console_account_admission(
        allowed_roles=_ADMIN_OR_OWNER_ROLES,
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.CREDENTIAL_CREATE,
        rbac_resource_required=False,
    )
    @model_validate(ApiKeyAuthBindingPayload)
    def post(self, req_data: ApiKeyAuthBindingPayload, request_context: RequestContext):
        credential_options = req_data.credentials.config.model_dump(exclude={"api_key"})
        command = DataSourceApiKeyAuthBindingCreate(
            category=req_data.category,
            provider=req_data.provider,
            credentials=DataSourceApiKeyAuthCredentials(
                auth_type=req_data.credentials.auth_type,
                api_key=req_data.credentials.config.api_key,
                options=credential_options,
            ),
        )
        try:
            application_services().data_source_api_key_auth.create_binding(request_context, command)
        except UnsupportedDataSourceApiKeyAuthProviderError as exc:
            raise DataSourceApiKeyAuthProviderNotSupportedError() from exc
        except InvalidDataSourceApiKeyAuthCredentialsError as exc:
            raise InvalidDataSourceApiKeyAuthCredentialsRequestError(description=str(exc)) from exc
        except DataSourceApiKeyAuthCredentialValidationError as exc:
            raise DataSourceApiKeyAuthCredentialsRejectedRequestError(description=str(exc)) from exc
        except DataSourceApiKeyAuthProviderUnavailableError as exc:
            raise DataSourceApiKeyAuthProviderUnavailableRequestError() from exc
        return dump_response(SimpleResultResponse, {"result": "success"}), HTTPStatus.OK


@console_ns.route("/api-key-auth/data-source/<uuid:binding_id>")
class ApiKeyAuthDataSourceBindingDelete(Resource):
    @console_ns.response(HTTPStatus.NO_CONTENT, "Binding deleted successfully")
    @console_account_admission(
        allowed_roles=_ADMIN_OR_OWNER_ROLES,
        rbac_resource_scope=RBACResourceScope.WORKSPACE,
        rbac_permission=RBACPermission.CREDENTIAL_MANAGE,
        rbac_resource_required=False,
    )
    def delete(self, request_context: RequestContext, binding_id: UUID):
        application_services().data_source_api_key_auth.delete_binding(request_context, str(binding_id))
        return "", HTTPStatus.NO_CONTENT
