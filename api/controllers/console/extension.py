from flask_restx import Resource, fields, marshal_with, reqparse

from constants import HIDDEN_VALUE
from controllers.console import api, console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from fields.api_based_extension_fields import api_based_extension_fields
from libs.login import current_account_with_tenant, login_required
from models.api_based_extension import APIBasedExtension
from services.api_based_extension_service import APIBasedExtensionService
from services.code_based_extension_service import CodeBasedExtensionService


@console_ns.route("/code-based-extension")
class CodeBasedExtensionAPI(Resource):
    @api.doc("get_code_based_extension")
    @api.doc(description="Get code-based extension data by module name")
    @api.expect(
        api.parser().add_argument("module", type=str, required=True, location="args", help="Extension module name")
    )
    @api.response(
        200,
        "Success",
        api.model(
            "CodeBasedExtensionResponse",
            {"module": fields.String(description="Module name"), "data": fields.Raw(description="Extension data")},
        ),
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser().add_argument("module", type=str, required=True, location="args")
        args = parser.parse_args()

        return {"module": args["module"], "data": CodeBasedExtensionService.get_code_based_extension(args["module"])}


@console_ns.route("/api-based-extension")
class APIBasedExtensionAPI(Resource):
    @api.doc("get_api_based_extensions")
    @api.doc(description="Get all API-based extensions for current tenant")
    @api.response(200, "Success", fields.List(fields.Nested(api_based_extension_fields)))
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_fields)
    def get(self):
        _, tenant_id = current_account_with_tenant()
        return APIBasedExtensionService.get_all_by_tenant_id(tenant_id)

    @api.doc("create_api_based_extension")
    @api.doc(description="Create a new API-based extension")
    @api.expect(
        api.model(
            "CreateAPIBasedExtensionRequest",
            {
                "name": fields.String(required=True, description="Extension name"),
                "api_endpoint": fields.String(required=True, description="API endpoint URL"),
                "api_key": fields.String(required=True, description="API key for authentication"),
            },
        )
    )
    @api.response(201, "Extension created successfully", api_based_extension_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_fields)
    def post(self):
        args = api.payload
        _, current_tenant_id = current_account_with_tenant()

        extension_data = APIBasedExtension(
            tenant_id=current_tenant_id,
            name=args["name"],
            api_endpoint=args["api_endpoint"],
            api_key=args["api_key"],
        )

        return APIBasedExtensionService.save(extension_data)


@console_ns.route("/api-based-extension/<uuid:id>")
class APIBasedExtensionDetailAPI(Resource):
    @api.doc("get_api_based_extension")
    @api.doc(description="Get API-based extension by ID")
    @api.doc(params={"id": "Extension ID"})
    @api.response(200, "Success", api_based_extension_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_fields)
    def get(self, id):
        api_based_extension_id = str(id)
        _, tenant_id = current_account_with_tenant()

        return APIBasedExtensionService.get_with_tenant_id(tenant_id, api_based_extension_id)

    @api.doc("update_api_based_extension")
    @api.doc(description="Update API-based extension")
    @api.doc(params={"id": "Extension ID"})
    @api.expect(
        api.model(
            "UpdateAPIBasedExtensionRequest",
            {
                "name": fields.String(required=True, description="Extension name"),
                "api_endpoint": fields.String(required=True, description="API endpoint URL"),
                "api_key": fields.String(required=True, description="API key for authentication"),
            },
        )
    )
    @api.response(200, "Extension updated successfully", api_based_extension_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(api_based_extension_fields)
    def post(self, id):
        api_based_extension_id = str(id)
        _, current_tenant_id = current_account_with_tenant()

        extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(current_tenant_id, api_based_extension_id)

        args = api.payload

        extension_data_from_db.name = args["name"]
        extension_data_from_db.api_endpoint = args["api_endpoint"]

        if args["api_key"] != HIDDEN_VALUE:
            extension_data_from_db.api_key = args["api_key"]

        return APIBasedExtensionService.save(extension_data_from_db)

    @api.doc("delete_api_based_extension")
    @api.doc(description="Delete API-based extension")
    @api.doc(params={"id": "Extension ID"})
    @api.response(204, "Extension deleted successfully")
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, id):
        api_based_extension_id = str(id)
        _, current_tenant_id = current_account_with_tenant()

        extension_data_from_db = APIBasedExtensionService.get_with_tenant_id(current_tenant_id, api_based_extension_id)

        APIBasedExtensionService.delete(extension_data_from_db)

        return {"result": "success"}, 204
