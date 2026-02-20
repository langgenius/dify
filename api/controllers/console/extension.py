from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from constants import HIDDEN_VALUE
from controllers.fastopenapi import console_router
from libs.login import current_account_with_tenant, login_required
from models.api_based_extension import APIBasedExtension
from services.api_based_extension_service import APIBasedExtensionService
from services.code_based_extension_service import CodeBasedExtensionService, Extension

from .wraps import account_initialization_required, setup_required


class CodeBasedExtensionQuery(BaseModel):
    module: str


class APIBasedExtensionPayload(BaseModel):
    name: str = Field(description="Extension name")
    api_endpoint: str = Field(description="API endpoint URL")
    api_key: str = Field(description="API key for authentication")


class CodeBasedExtensionResponse(BaseModel):
    module: str = Field(description="Module name")
    data: list[Extension] = Field(description="Extension data")


class APIBasedExtensionResponse(BaseModel):
    id: str
    name: str
    api_endpoint: str
    api_key: str
    created_at: int | None = None

    @field_validator("api_key", mode="before")
    @classmethod
    def mask_api_key(cls, value: str) -> str:
        if not value:
            return ""
        if len(value) <= 8:
            return f"{value[0]}******{value[-1]}"
        return f"{value[:3]}******{value[-3:]}"

    @field_validator("created_at", mode="before")
    @classmethod
    def normalize_created_at(cls, value: datetime | int | None) -> int | None:
        if isinstance(value, datetime):
            return int(value.timestamp())
        return value


class APIBasedExtensionListResponse(BaseModel):
    extensions: list[APIBasedExtensionResponse]


class DeleteResponse(BaseModel):
    result: str = Field(description="Deletion result", examples=["success"])


def _to_api_based_extension_response(extension: APIBasedExtension) -> APIBasedExtensionResponse:
    return APIBasedExtensionResponse.model_validate(extension, from_attributes=True)


@console_router.get(
    "/code-based-extension",
    response_model=CodeBasedExtensionResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def get_code_based_extension(query: CodeBasedExtensionQuery) -> CodeBasedExtensionResponse:
    return CodeBasedExtensionResponse(
        module=query.module,
        data=CodeBasedExtensionService.get_code_based_extension(query.module),
    )


@console_router.get(
    "/api-based-extension",
    response_model=APIBasedExtensionListResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def get_api_based_extensions() -> APIBasedExtensionListResponse:
    _, tenant_id = current_account_with_tenant()
    extensions = APIBasedExtensionService.get_all_by_tenant_id(tenant_id)
    return APIBasedExtensionListResponse(extensions=[_to_api_based_extension_response(item) for item in extensions])


@console_router.post(
    "/api-based-extension",
    response_model=APIBasedExtensionResponse,
    tags=["console"],
    status_code=201,
)
@setup_required
@login_required
@account_initialization_required
def create_api_based_extension(payload: APIBasedExtensionPayload) -> APIBasedExtensionResponse:
    _, current_tenant_id = current_account_with_tenant()

    extension_data = APIBasedExtension(
        tenant_id=current_tenant_id,
        name=payload.name,
        api_endpoint=payload.api_endpoint,
        api_key=payload.api_key,
    )

    return _to_api_based_extension_response(APIBasedExtensionService.save(extension_data))


@console_router.get(
    "/api-based-extension/<uuid:extension_id>",
    response_model=APIBasedExtensionResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def get_api_based_extension(extension_id: UUID) -> APIBasedExtensionResponse:
    api_based_extension_id = str(extension_id)
    _, tenant_id = current_account_with_tenant()

    return _to_api_based_extension_response(
        APIBasedExtensionService.get_with_tenant_id(tenant_id, api_based_extension_id)
    )


@console_router.post(
    "/api-based-extension/<uuid:extension_id>",
    response_model=APIBasedExtensionResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def update_api_based_extension(
    extension_id: UUID,
    payload: APIBasedExtensionPayload,
) -> APIBasedExtensionResponse:
    api_based_extension_id = str(extension_id)
    _, current_tenant_id = current_account_with_tenant()

    extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(current_tenant_id, api_based_extension_id)

    extension_data_from_db.name = payload.name
    extension_data_from_db.api_endpoint = payload.api_endpoint

    if payload.api_key != HIDDEN_VALUE:
        extension_data_from_db.api_key = payload.api_key

    return _to_api_based_extension_response(APIBasedExtensionService.save(extension_data_from_db))


@console_router.delete(
    "/api-based-extension/<uuid:extension_id>",
    tags=["console"],
    status_code=204,
)
@setup_required
@login_required
@account_initialization_required
def delete_api_based_extension(extension_id: UUID) -> tuple[DeleteResponse, int]:
    api_based_extension_id = str(extension_id)
    _, current_tenant_id = current_account_with_tenant()

    extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(current_tenant_id, api_based_extension_id)

    APIBasedExtensionService.delete(extension_data_from_db)

    return DeleteResponse(result="success"), 204
