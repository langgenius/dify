from datetime import datetime
from typing import Any
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter, field_validator

from constants import HIDDEN_VALUE
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import to_timestamp
from libs.login import login_required
from models.api_based_extension import APIBasedExtension
from services.api_based_extension_service import APIBasedExtensionService
from services.code_based_extension_service import CodeBasedExtensionService

from ..common.schema import DEFAULT_REF_TEMPLATE_OPENAPI_3_0, query_params_from_model, register_schema_models
from . import console_ns
from .wraps import account_initialization_required, setup_required, with_current_tenant_id


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


register_schema_models(
    console_ns,
    CodeBasedExtensionQuery,
    APIBasedExtensionPayload,
    CodeBasedExtensionResponse,
    APIBasedExtensionResponse,
)
console_ns.schema_model(
    "APIBasedExtensionListResponse",
    TypeAdapter(list[APIBasedExtensionResponse]).json_schema(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0),
)


def _serialize_api_based_extension(extension: APIBasedExtension) -> dict[str, Any]:
    return APIBasedExtensionResponse.model_validate(extension, from_attributes=True).model_dump(mode="json")


def _serialize_saved_api_based_extension(extension: APIBasedExtension, api_key: str) -> dict[str, Any]:
    """Serialize a saved extension with the plaintext key used for response masking only.

    APIBasedExtensionService.save mutates the ORM object to hold the encrypted token before returning it. The response
    contract, however, should match list/detail responses, where api_key is masked from the decrypted token.
    """
    return APIBasedExtensionResponse(
        id=extension.id,
        name=extension.name,
        api_endpoint=extension.api_endpoint,
        api_key=api_key,
        created_at=to_timestamp(extension.created_at),
    ).model_dump(mode="json")


@console_ns.route("/code-based-extension")
class CodeBasedExtensionAPI(Resource):
    @console_ns.doc("get_code_based_extension")
    @console_ns.doc(description="Get code-based extension data by module name")
    @console_ns.doc(params=query_params_from_model(CodeBasedExtensionQuery))
    @console_ns.response(
        200,
        "Success",
        console_ns.models[CodeBasedExtensionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        query = CodeBasedExtensionQuery.model_validate(request.args.to_dict(flat=True))

        return CodeBasedExtensionResponse(
            module=query.module,
            data=CodeBasedExtensionService.get_code_based_extension(query.module),
        ).model_dump(mode="json")


@console_ns.route("/api-based-extension")
class APIBasedExtensionAPI(Resource):
    @console_ns.doc("get_api_based_extensions")
    @console_ns.doc(description="Get all API-based extensions for current tenant")
    @console_ns.response(200, "Success", console_ns.models["APIBasedExtensionListResponse"])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        return [
            _serialize_api_based_extension(extension)
            for extension in APIBasedExtensionService.get_all_by_tenant_id(db.session(), current_tenant_id)
        ]

    @console_ns.doc("create_api_based_extension")
    @console_ns.doc(description="Create a new API-based extension")
    @console_ns.expect(console_ns.models[APIBasedExtensionPayload.__name__])
    @console_ns.response(201, "Extension created successfully", console_ns.models[APIBasedExtensionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        payload = APIBasedExtensionPayload.model_validate(console_ns.payload or {})

        extension_data = APIBasedExtension(
            tenant_id=current_tenant_id,
            name=payload.name,
            api_endpoint=payload.api_endpoint,
            api_key=payload.api_key,
        )

        return (
            _serialize_saved_api_based_extension(
                APIBasedExtensionService.save(db.session(), extension_data), payload.api_key
            ),
            201,
        )


@console_ns.route("/api-based-extension/<uuid:id>")
class APIBasedExtensionDetailAPI(Resource):
    @console_ns.doc("get_api_based_extension")
    @console_ns.doc(description="Get API-based extension by ID")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.response(200, "Success", console_ns.models[APIBasedExtensionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str, id: UUID):
        api_based_extension_id = str(id)

        return _serialize_api_based_extension(
            APIBasedExtensionService.get_with_tenant_id(db.session(), current_tenant_id, api_based_extension_id)
        )

    @console_ns.doc("update_api_based_extension")
    @console_ns.doc(description="Update API-based extension")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.expect(console_ns.models[APIBasedExtensionPayload.__name__])
    @console_ns.response(200, "Extension updated successfully", console_ns.models[APIBasedExtensionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, current_tenant_id: str, id: UUID):
        api_based_extension_id = str(id)

        extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(
            db.session(), current_tenant_id, api_based_extension_id
        )

        payload = APIBasedExtensionPayload.model_validate(console_ns.payload or {})
        api_key_for_response = extension_data_from_db.api_key

        extension_data_from_db.name = payload.name
        extension_data_from_db.api_endpoint = payload.api_endpoint

        if payload.api_key != HIDDEN_VALUE:
            extension_data_from_db.api_key = payload.api_key
            api_key_for_response = payload.api_key

        return _serialize_saved_api_based_extension(
            APIBasedExtensionService.save(db.session(), extension_data_from_db),
            api_key_for_response,
        )

    @console_ns.doc("delete_api_based_extension")
    @console_ns.doc(description="Delete API-based extension")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.response(204, "Extension deleted successfully")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, id: UUID):
        api_based_extension_id = str(id)

        extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(
            db.session(), current_tenant_id, api_based_extension_id
        )

        APIBasedExtensionService.delete(db.session(), extension_data_from_db)

        return "", 204
