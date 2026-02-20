from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter

from constants import HIDDEN_VALUE
from fields.api_based_extension_fields import APIBasedExtensionList, APIBasedExtensionResponse
from libs.login import current_account_with_tenant, login_required
from models.api_based_extension import APIBasedExtension
from services.api_based_extension_service import APIBasedExtensionService
from services.code_based_extension_service import CodeBasedExtensionService

from ..common.schema import register_schema_models
from . import console_ns
from .wraps import account_initialization_required, setup_required


class CodeBasedExtensionQuery(BaseModel):
    module: str = Field(description="Extension module name")


class CodeBasedExtensionData(BaseModel):
    name: str = Field(description="Extension name")
    label: dict[str, Any] | None = Field(default=None, description="Extension label")
    form_schema: list[dict[str, Any]] | None = Field(default=None, description="Extension form schema")


class CodeBasedExtensionResponse(BaseModel):
    module: str = Field(description="Module name")
    data: list[CodeBasedExtensionData] = Field(description="Extension data")


class APIBasedExtensionPayload(BaseModel):
    name: str = Field(description="Extension name")
    api_endpoint: str = Field(description="API endpoint URL")
    api_key: str = Field(description="API key for authentication")


register_schema_models(
    console_ns,
    CodeBasedExtensionQuery,
    CodeBasedExtensionData,
    CodeBasedExtensionResponse,
    APIBasedExtensionPayload,
    APIBasedExtensionResponse,
    APIBasedExtensionList,
)


@console_ns.route("/code-based-extension")
class CodeBasedExtensionAPI(Resource):
    @console_ns.doc("get_code_based_extension")
    @console_ns.doc(description="Get code-based extension data by module name")
    @console_ns.doc(params={"module": "Extension module name"})
    @console_ns.response(200, "Success", console_ns.models[CodeBasedExtensionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        query = CodeBasedExtensionQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        extension_data = CodeBasedExtensionService.get_code_based_extension(query.module)
        extension_models = TypeAdapter(list[CodeBasedExtensionData]).validate_python(extension_data)
        response = CodeBasedExtensionResponse(module=query.module, data=extension_models)
        return response.model_dump(mode="json")


@console_ns.route("/api-based-extension")
class APIBasedExtensionAPI(Resource):
    @console_ns.doc("get_api_based_extensions")
    @console_ns.doc(description="Get all API-based extensions for current tenant")
    @console_ns.response(200, "Success", console_ns.models[APIBasedExtensionList.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()
        extensions = APIBasedExtensionService.get_all_by_tenant_id(tenant_id)
        adapter = TypeAdapter(list[APIBasedExtensionResponse])
        extension_models = adapter.validate_python(extensions, from_attributes=True)
        return adapter.dump_python(extension_models, mode="json")

    @console_ns.doc("create_api_based_extension")
    @console_ns.doc(description="Create a new API-based extension")
    @console_ns.expect(console_ns.models[APIBasedExtensionPayload.__name__])
    @console_ns.response(201, "Extension created successfully", console_ns.models[APIBasedExtensionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        payload = APIBasedExtensionPayload.model_validate(console_ns.payload or {})
        _, current_tenant_id = current_account_with_tenant()

        extension_data = APIBasedExtension(
            tenant_id=current_tenant_id,
            name=payload.name,
            api_endpoint=payload.api_endpoint,
            api_key=payload.api_key,
        )

        extension = APIBasedExtensionService.save(extension_data)
        return APIBasedExtensionResponse.model_validate(extension, from_attributes=True).model_dump(mode="json")


@console_ns.route("/api-based-extension/<uuid:id>")
class APIBasedExtensionDetailAPI(Resource):
    @console_ns.doc("get_api_based_extension")
    @console_ns.doc(description="Get API-based extension by ID")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.response(200, "Success", console_ns.models[APIBasedExtensionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, id):
        api_based_extension_id = str(id)
        _, tenant_id = current_account_with_tenant()

        extension = APIBasedExtensionService.get_with_tenant_id(tenant_id, api_based_extension_id)
        return APIBasedExtensionResponse.model_validate(extension, from_attributes=True).model_dump(mode="json")

    @console_ns.doc("update_api_based_extension")
    @console_ns.doc(description="Update API-based extension")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.expect(console_ns.models[APIBasedExtensionPayload.__name__])
    @console_ns.response(200, "Extension updated successfully", console_ns.models[APIBasedExtensionResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, id):
        api_based_extension_id = str(id)
        _, current_tenant_id = current_account_with_tenant()

        extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(current_tenant_id, api_based_extension_id)

        payload = APIBasedExtensionPayload.model_validate(console_ns.payload or {})

        extension_data_from_db.name = payload.name
        extension_data_from_db.api_endpoint = payload.api_endpoint

        if payload.api_key != HIDDEN_VALUE:
            extension_data_from_db.api_key = payload.api_key

        extension = APIBasedExtensionService.save(extension_data_from_db)
        return APIBasedExtensionResponse.model_validate(extension, from_attributes=True).model_dump(mode="json")

    @console_ns.doc("delete_api_based_extension")
    @console_ns.doc(description="Delete API-based extension")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.response(204, "Extension deleted successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, id):
        api_based_extension_id = str(id)
        _, current_tenant_id = current_account_with_tenant()

        extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(current_tenant_id, api_based_extension_id)

        APIBasedExtensionService.delete(extension_data_from_db)

        return {"result": "success"}, 204
