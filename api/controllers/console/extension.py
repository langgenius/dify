from datetime import datetime
from typing import Any
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, RootModel, field_validator

from constants import HIDDEN_VALUE
from controllers.console.flask_admission import console_account_admission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from libs.login import login_required
from machinery.context import RequestContext
from services.api_based_extension_application_service import (
    APIBasedExtensionError,
    APIBasedExtensionInput,
    APIBasedExtensionRecord,
    APIBasedExtensionUpdate,
)
from services.code_based_extension_service import CodeBasedExtensionService

from ..common.schema import register_response_schema_models, register_schema_models
from . import console_ns
from .wraps import account_initialization_required, model_validate, setup_required


class CodeBasedExtensionQuery(BaseModel):
    module: str


class APIBasedExtensionPayload(BaseModel):
    name: str = Field(description="Extension name")
    api_endpoint: str = Field(description="API endpoint URL")
    api_key: str = Field(description="API key for authentication")


class CodeBasedExtensionResponse(ResponseModel):
    module: str = Field(description="Module name")
    data: Any = Field(description="Extension data")


def _mask_api_key(api_key: str) -> str:
    if not api_key:
        return api_key
    if len(api_key) <= 8:
        return api_key[0] + "******" + api_key[-1]
    return api_key[:3] + "******" + api_key[-3:]


class APIBasedExtensionResponse(ResponseModel):
    id: str
    name: str
    api_endpoint: str
    api_key: str
    created_at: int | None = None

    @field_validator("api_key", mode="before")
    @classmethod
    def _normalize_api_key(cls, value: str) -> str:
        return _mask_api_key(value)

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_created_at(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class APIBasedExtensionListResponse(RootModel[list[APIBasedExtensionResponse]]):
    pass


register_schema_models(
    console_ns,
    CodeBasedExtensionQuery,
    APIBasedExtensionPayload,
)
register_response_schema_models(
    console_ns,
    CodeBasedExtensionResponse,
    APIBasedExtensionResponse,
    APIBasedExtensionListResponse,
)


def _extension_response(extension: APIBasedExtensionRecord) -> dict[str, Any]:
    return dump_response(APIBasedExtensionResponse, extension)


@console_ns.route("/code-based-extension")
class CodeBasedExtensionAPI(Resource):
    @console_ns.doc("get_code_based_extension")
    @console_ns.doc(description="Get code-based extension data by module name")
    @console_ns.doc_query(CodeBasedExtensionQuery)
    @console_ns.response(
        200,
        "Success",
        console_ns.models[CodeBasedExtensionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @model_validate(CodeBasedExtensionQuery)
    def get(self, query: CodeBasedExtensionQuery):
        return CodeBasedExtensionResponse(
            module=query.module,
            data=CodeBasedExtensionService.get_code_based_extension(query.module),
        ).model_dump(mode="json")


@console_ns.route("/api-based-extension")
class APIBasedExtensionAPI(Resource):
    @console_ns.doc("get_api_based_extensions")
    @console_ns.doc(description="Get all API-based extensions for current tenant")
    @console_ns.response(200, "Success", console_ns.models[APIBasedExtensionListResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext):
        extensions = application_services().api_based_extensions.list_extensions(request_context)
        return dump_response(APIBasedExtensionListResponse, extensions)

    @console_ns.doc("create_api_based_extension")
    @console_ns.doc(description="Create a new API-based extension")
    @console_ns.expect_model(APIBasedExtensionPayload)
    @console_ns.response(201, "Extension created successfully", console_ns.models[APIBasedExtensionResponse.__name__])
    @console_account_admission()
    @model_validate(APIBasedExtensionPayload)
    def post(self, req_data: APIBasedExtensionPayload, request_context: RequestContext):
        try:
            extension = application_services().api_based_extensions.create_extension(
                request_context,
                APIBasedExtensionInput(
                    name=req_data.name,
                    api_endpoint=req_data.api_endpoint,
                    api_key=req_data.api_key,
                ),
            )
        except APIBasedExtensionError as error:
            # Legacy clients receive the 400 `invalid_param` envelope for every extension failure.
            raise ValueError(str(error)) from None

        return _extension_response(extension), 201


@console_ns.route("/api-based-extension/<uuid:id>")
class APIBasedExtensionDetailAPI(Resource):
    @console_ns.doc("get_api_based_extension")
    @console_ns.doc(description="Get API-based extension by ID")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.response(200, "Success", console_ns.models[APIBasedExtensionResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext, id: UUID):
        try:
            extension = application_services().api_based_extensions.get_extension(request_context, str(id))
        except APIBasedExtensionError as error:
            raise ValueError(str(error)) from None

        return _extension_response(extension)

    @console_ns.doc("update_api_based_extension")
    @console_ns.doc(description="Update API-based extension")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.expect_model(APIBasedExtensionPayload)
    @console_ns.response(200, "Extension updated successfully", console_ns.models[APIBasedExtensionResponse.__name__])
    @console_account_admission()
    @model_validate(APIBasedExtensionPayload)
    def post(self, req_data: APIBasedExtensionPayload, request_context: RequestContext, id: UUID):
        try:
            extension = application_services().api_based_extensions.update_extension(
                request_context,
                str(id),
                APIBasedExtensionUpdate(
                    name=req_data.name,
                    api_endpoint=req_data.api_endpoint,
                    # The console echoes the masked key back; keep the stored key when it is sent unchanged.
                    api_key=None if req_data.api_key == HIDDEN_VALUE else req_data.api_key,
                ),
            )
        except APIBasedExtensionError as error:
            raise ValueError(str(error)) from None

        return _extension_response(extension)

    @console_ns.doc("delete_api_based_extension")
    @console_ns.doc(description="Delete API-based extension")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.response(204, "Extension deleted successfully")
    @console_account_admission()
    def delete(self, request_context: RequestContext, id: UUID):
        try:
            application_services().api_based_extensions.delete_extension(request_context, str(id))
        except APIBasedExtensionError as error:
            raise ValueError(str(error)) from None

        return "", 204
