"""Inner API endpoints for app DSL import/export.

Called by the enterprise admin-api service. Import requires ``creator_email``
to attribute the created app; workspace/membership validation is done by the
Go admin-api caller.
"""

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.common.schema import register_schema_model
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from extensions.ext_database import db
from models import Account, App
from models.account import AccountStatus
from services.app_dsl_service import AppDslService, ImportMode, ImportStatus


class InnerAppDSLImportPayload(BaseModel):
    yaml_content: str = Field(description="YAML DSL content")
    creator_email: str = Field(description="Email of the workspace member who will own the imported app")
    name: str | None = Field(default=None, description="Override app name from DSL")
    description: str | None = Field(default=None, description="Override app description from DSL")


register_schema_model(inner_api_ns, InnerAppDSLImportPayload)


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
    def post(self, workspace_id: str):
        """Import a DSL into a workspace on behalf of a specified creator."""
        args = InnerAppDSLImportPayload.model_validate(inner_api_ns.payload or {})

        account = _get_active_account(args.creator_email)
        if account is None:
            return {"message": f"account '{args.creator_email}' not found or inactive"}, 404

        account.set_tenant_id(workspace_id)

        with Session(db.engine) as session:
            dsl_service = AppDslService(session)
            result = dsl_service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=args.yaml_content,
                name=args.name,
                description=args.description,
            )
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
        responses={
            200: "Export successful",
            404: "App not found",
        },
    )
    def get(self, app_id: str):
        """Export an app's DSL as YAML."""
        include_secret = request.args.get("include_secret", "false").lower() == "true"

        app_model = db.session.get(App, app_id)
        if not app_model:
            return {"message": "app not found"}, 404

        data = AppDslService.export_dsl(
            app_model=app_model,
            include_secret=include_secret,
        )

        return {"data": data}, 200


def _get_active_account(email: str) -> Account | None:
    """Look up an active account by email.

    Workspace membership is already validated by the Go admin-api caller.
    """
    account = db.session.scalar(select(Account).where(Account.email == email).limit(1))
    if account is None or account.status != AccountStatus.ACTIVE:
        return None
    return account
