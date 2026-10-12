"""Inner API endpoints for app DSL import/export.

Called by the enterprise admin-api service. Import requires ``creator_email``
to attribute the created app; workspace/membership validation is done by the
Go admin-api caller.
"""

from http import HTTPStatus
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, ValidationError, field_validator

from controllers.common.fields import SimpleMessageResponse
from controllers.common.schema import query_params_from_model, register_schema_model
from controllers.console.wraps import setup_required, validate_request
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.logging.context import get_request_id, get_trace_id
from extensions.ext_application_services import application_services
from fields.app_export_fields import AppExportResponse
from fields.base import ResponseModel
from libs.helper import dump_response
from services.entities.app_entities import AppExportOptions
from services.entities.dsl_entities import AppImportParams, Import, ImportMode, ImportStatus
from services.errors.app import AppDiscoveryNotFoundError, IsDraftWorkflowError, WorkflowNotFoundError


class InnerAppDSLImportPayload(BaseModel):
    yaml_content: str = Field(description="YAML DSL content")
    creator_email: str = Field(description="Email of the workspace member who will own the imported app")
    name: str | None = Field(default=None, description="Override app name from DSL")
    description: str | None = Field(default=None, description="Override app description from DSL")


class EnterpriseAppDSLExportQuery(BaseModel):
    include_secret: bool = Field(default=False, description="Whether to include secret values in the exported DSL")
    workflow_id: UUID | None = Field(default=None, description="Published workflow version ID to export")

    @field_validator("include_secret", mode="before")
    @classmethod
    def parse_include_secret(cls, value: object) -> bool:
        if isinstance(value, str):
            return value.lower() == "true"
        return bool(value)


class EnterpriseAppDSLWorkflowErrorResponse(ResponseModel):
    code: str
    message: str
    status: int


register_schema_model(inner_api_ns, InnerAppDSLImportPayload)


@inner_api_ns.route("/enterprise/workspaces/<string:workspace_id>/dsl/import")
class EnterpriseAppDSLImport(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc("enterprise_app_dsl_import")
    @inner_api_ns.expect(inner_api_ns.models[InnerAppDSLImportPayload.__name__])
    @inner_api_ns.doc(
        responses={
            HTTPStatus.OK: "Import completed",
            HTTPStatus.ACCEPTED: "Import pending (DSL version mismatch requires confirmation)",
            HTTPStatus.BAD_REQUEST: "Import failed (business error)",
            HTTPStatus.NOT_FOUND: "Creator account not found or inactive",
        }
    )
    def post(self, workspace_id: str):
        """Import a DSL into a workspace on behalf of a specified creator."""
        args = validate_request(InnerAppDSLImportPayload)
        result = application_services().apps.imports.import_as_creator(
            workspace_id=workspace_id,
            creator_email=args.creator_email,
            params=AppImportParams(
                mode=ImportMode.YAML_CONTENT,
                yaml_content=args.yaml_content,
                name=args.name,
                description=args.description,
            ),
            request_id=get_request_id(),
            trace_id=get_trace_id(),
        )
        if result is None:
            return dump_response(
                SimpleMessageResponse, {"message": f"account '{args.creator_email}' not found or inactive"}
            ), HTTPStatus.NOT_FOUND

        if result.status == ImportStatus.FAILED:
            return dump_response(Import, result), HTTPStatus.BAD_REQUEST
        if result.status == ImportStatus.PENDING:
            return dump_response(Import, result), HTTPStatus.ACCEPTED
        return dump_response(Import, result), HTTPStatus.OK


@inner_api_ns.route("/enterprise/apps/<string:app_id>/dsl")
class EnterpriseAppDSLExport(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc(
        "enterprise_app_dsl_export",
        params=query_params_from_model(EnterpriseAppDSLExportQuery),
        responses={
            200: "Export successful",
            400: "Invalid workflow ID or unpublished workflow version",
            404: "App or workflow version not found",
        },
    )
    def get(self, app_id: str):
        """Export an app's DSL as YAML."""
        try:
            query = EnterpriseAppDSLExportQuery.model_validate(request.args.to_dict(flat=True))
        except ValidationError:
            return dump_response(
                EnterpriseAppDSLWorkflowErrorResponse,
                {
                    "code": "invalid_workflow_id",
                    "message": "workflow_id must be a valid UUID",
                    "status": HTTPStatus.BAD_REQUEST,
                },
            ), HTTPStatus.BAD_REQUEST

        workflow_id = str(query.workflow_id) if query.workflow_id else None

        try:
            data = application_services().apps.exports.export_for_inner(
                app_id, AppExportOptions(include_secret=query.include_secret, workflow_id=workflow_id)
            )
        except AppDiscoveryNotFoundError:
            return dump_response(SimpleMessageResponse, {"message": "app not found"}), HTTPStatus.NOT_FOUND
        except WorkflowNotFoundError as exc:
            if not workflow_id:
                raise
            return dump_response(
                EnterpriseAppDSLWorkflowErrorResponse,
                {"code": "workflow_version_not_found", "message": str(exc), "status": HTTPStatus.NOT_FOUND},
            ), HTTPStatus.NOT_FOUND
        except IsDraftWorkflowError as exc:
            if not workflow_id:
                raise
            return dump_response(
                EnterpriseAppDSLWorkflowErrorResponse,
                {"code": "workflow_version_not_published", "message": str(exc), "status": HTTPStatus.BAD_REQUEST},
            ), HTTPStatus.BAD_REQUEST

        return dump_response(AppExportResponse, {"data": data}), HTTPStatus.OK
