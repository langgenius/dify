"""Inner API endpoints for app DSL import/export.

Called by the enterprise admin-api service. Import requires ``creator_email``
to attribute the created app; workspace/membership validation is done by the
Go admin-api caller.
"""

import base64
from typing import Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_model,
)
from controllers.console.wraps import model_validate, setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from extensions.ext_database import db
from fields.base import ResponseModel
from models import Account, App
from models.account import AccountStatus
from services.app_dsl_service import AppDslService
from services.entities.dsl_entities import ImportStatus
from services.errors.app import IsDraftWorkflowError, WorkflowNotFoundError
from services.workflow_dsl_bundle import WorkflowDslBundleService


class InnerAppDSLImportPayload(BaseModel):
    mode: Literal["yaml-content", "bundle-content"] = "yaml-content"
    yaml_content: str = Field(description="YAML DSL text or base64-encoded ZIP for bundle-content")
    creator_email: str = Field(description="Email of the workspace member who will own the imported app")
    name: str | None = Field(default=None, description="Override app name from DSL")
    description: str | None = Field(default=None, description="Override app description from DSL")


class EnterpriseAppDSLExportQuery(BaseModel):
    include_workflow_tools: bool = Field(
        default=False, description="Package referenced workflow tools recursively in a ZIP"
    )
    include_secret: bool = Field(default=False, description="Whether to include secret values in the exported DSL")
    workflow_id: UUID | None = Field(default=None, description="Published workflow version ID to export")

    @field_validator("include_secret", mode="before")
    @classmethod
    def parse_include_secret(cls, value: object) -> bool:
        if isinstance(value, str):
            return value.lower() == "true"
        return bool(value)


class InnerAppDSLExportResponse(ResponseModel):
    data: str = Field(description="YAML DSL text, or base64-encoded ZIP when format is zip")
    format: Literal["yaml", "zip"] = "yaml"


register_schema_model(inner_api_ns, InnerAppDSLImportPayload)
register_response_schema_models(inner_api_ns, InnerAppDSLExportResponse)


@inner_api_ns.route("/enterprise/workspaces/<string:workspace_id>/dsl/import")
class EnterpriseAppDSLImport(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc("enterprise_app_dsl_import")
    @inner_api_ns.expect(inner_api_ns.models[InnerAppDSLImportPayload.__name__])
    @inner_api_ns.doc(
        responses={
            200: "Import completed",
            202: "Import pending (DSL version mismatch requires confirmation)",
            400: "Import failed (business error)",
            404: "Creator account not found or inactive",
        }
    )
    @model_validate(InnerAppDSLImportPayload)
    def post(self, args: InnerAppDSLImportPayload, workspace_id: str):
        """Import a DSL into a workspace on behalf of a specified creator."""

        account = _get_active_account(args.creator_email)
        if account is None:
            return {"message": f"account '{args.creator_email}' not found or inactive"}, 404

        with Session(db.engine, expire_on_commit=False) as session:
            account.set_tenant_id_with_session(workspace_id, session=session)
            dsl_service = AppDslService(session)
            result = dsl_service.import_app(
                account=account,
                import_mode=args.mode,
                yaml_content=args.yaml_content,
                name=args.name,
                description=args.description,
            )
            if result.status == ImportStatus.FAILED:
                session.rollback()
            else:
                session.commit()

        if result.status == ImportStatus.FAILED:
            return result.model_dump(mode="json"), 400
        if result.status == ImportStatus.PENDING:
            return result.model_dump(mode="json"), 202
        return result.model_dump(mode="json"), 200


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
    @inner_api_ns.response(200, "Export successful", inner_api_ns.models[InnerAppDSLExportResponse.__name__])
    def get(self, app_id: str):
        """Export an app as YAML or a ZIP containing its nested workflow tools."""
        try:
            query = EnterpriseAppDSLExportQuery.model_validate(request.args.to_dict(flat=True))
        except ValidationError:
            return {
                "code": "invalid_workflow_id",
                "message": "workflow_id must be a valid UUID",
                "status": 400,
            }, 400

        workflow_id = str(query.workflow_id) if query.workflow_id else None

        app_model = db.session.get(App, app_id)
        if not app_model:
            return {"message": "app not found"}, 404

        if query.include_workflow_tools:
            try:
                bundle = WorkflowDslBundleService(db.session()).export_bundle(
                    app_model=app_model,
                    account=None,
                    include_secret=query.include_secret,
                    workflow_id=workflow_id,
                )
            except WorkflowNotFoundError as exc:
                return {"code": "workflow_version_not_found", "message": str(exc), "status": 404}, 404
            except IsDraftWorkflowError as exc:
                return {"code": "workflow_version_not_published", "message": str(exc), "status": 400}, 400
            except ValueError as exc:
                return {"code": "invalid_workflow_bundle", "message": str(exc), "status": 400}, 400
            if bundle is not None:
                return InnerAppDSLExportResponse(
                    data=base64.b64encode(bundle).decode("ascii"), format="zip"
                ).model_dump(mode="json"), 200

        if not workflow_id:
            data = AppDslService.export_dsl(
                app_model=app_model,
                session=db.session(),
                include_secret=query.include_secret,
            )
        else:
            try:
                data = AppDslService.export_dsl(
                    app_model=app_model,
                    session=db.session(),
                    include_secret=query.include_secret,
                    workflow_id=workflow_id,
                )
            except WorkflowNotFoundError as exc:
                return {"code": "workflow_version_not_found", "message": str(exc), "status": 404}, 404
            except IsDraftWorkflowError as exc:
                return {"code": "workflow_version_not_published", "message": str(exc), "status": 400}, 400

        return InnerAppDSLExportResponse(data=data).model_dump(mode="json"), 200


def _get_active_account(email: str) -> Account | None:
    """Look up an active account by email.

    Workspace membership is already validated by the Go admin-api caller.
    """
    account = db.session.scalar(select(Account).where(Account.email == email).limit(1))
    if account is None or account.status != AccountStatus.ACTIVE:
        return None
    return account
