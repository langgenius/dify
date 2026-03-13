from flask import request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field

from constants import HIDDEN_VALUE
from fields.api_based_extension_fields import api_based_extension_fields
from libs.login import current_account_with_tenant, login_required
from models.api_based_extension import APIBasedExtension
from services.api_based_extension_service import APIBasedExtensionService
from services.code_based_extension_service import CodeBasedExtensionService

from ..common.schema import register_schema_models
from . import console_ns
from .wraps import account_initialization_required, setup_required


class CodeBasedExtensionQuery(BaseModel):
    module: str


class APIBasedExtensionPayload(BaseModel):
    name: str = Field(description="Extension name")
    api_endpoint: str = Field(description="API endpoint URL")
    api_key: str = Field(description="API key for authentication")


register_schema_models(console_ns, APIBasedExtensionPayload)


api_based_extension_model = console_ns.model("ApiBasedExtensionModel", api_based_extension_fields)

api_based_extension_list_model = fields.List(fields.Nested(api_based_extension_model))


@console_ns.route("/code-based-extension")
class CodeBasedExtensionAPI(Resource):
    @console_ns.doc("get_code_based_extension")
    @console_ns.doc(description="Get code-based extension data by module name")
    @console_ns.doc(params={"module": "Extension module name"})
    @console_ns.response(
        200,
        "Success",
        console_ns.model(
            "CodeBasedExtensionResponse",
            {"module": fields.String(description="Module name"), "data": fields.Raw(description="Extension data")},
        ),
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        query = CodeBasedExtensionQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        return {"module": query.module, "data": CodeBasedExtensionService.get_code_based_extension(query.module)}


@console_ns.route("/api-based-extension")
class APIBasedExtensionAPI(Resource):
    @console_ns.doc("get_api_based_extensions")
    @console_ns.doc(description="Get all API-based extensions for current tenant")
    @console_ns.response(200, "Success", api_based_extension_list_model)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_model)
    def get(self):
        _, tenant_id = current_account_with_tenant()
        return APIBasedExtensionService.get_all_by_tenant_id(tenant_id)

    @console_ns.doc("create_api_based_extension")
    @console_ns.doc(description="Create a new API-based extension")
    @console_ns.expect(console_ns.models[APIBasedExtensionPayload.__name__])
    @console_ns.response(201, "Extension created successfully", api_based_extension_model)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_model)
    def post(self):
        payload = APIBasedExtensionPayload.model_validate(console_ns.payload or {})
        _, current_tenant_id = current_account_with_tenant()

        extension_data = APIBasedExtension(
            tenant_id=current_tenant_id,
            name=payload.name,
            api_endpoint=payload.api_endpoint,
            api_key=payload.api_key,
        )

        return APIBasedExtensionService.save(extension_data)


@console_ns.route("/api-based-extension/<uuid:id>")
class APIBasedExtensionDetailAPI(Resource):
    @console_ns.doc("get_api_based_extension")
    @console_ns.doc(description="Get API-based extension by ID")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.response(200, "Success", api_based_extension_model)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_model)
    def get(self, id):
        api_based_extension_id = str(id)
        _, tenant_id = current_account_with_tenant()

        return APIBasedExtensionService.get_with_tenant_id(tenant_id, api_based_extension_id)

    @console_ns.doc("update_api_based_extension")
    @console_ns.doc(description="Update API-based extension")
    @console_ns.doc(params={"id": "Extension ID"})
    @console_ns.expect(console_ns.models[APIBasedExtensionPayload.__name__])
    @console_ns.response(200, "Extension updated successfully", api_based_extension_model)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_model)
    def post(self, id):
        api_based_extension_id = str(id)
        _, current_tenant_id = current_account_with_tenant()

        extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(current_tenant_id, api_based_extension_id)

        payload = APIBasedExtensionPayload.model_validate(console_ns.payload or {})

        extension_data_from_db.name = payload.name
        extension_data_from_db.api_endpoint = payload.api_endpoint

        if payload.api_key != HIDDEN_VALUE:
            extension_data_from_db.api_key = payload.api_key

        return APIBasedExtensionService.save(extension_data_from_db)

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
