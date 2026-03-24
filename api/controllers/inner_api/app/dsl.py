"""Inner API endpoints for app DSL import/export.

Called by the enterprise admin-api service to import and export
app definitions as YAML DSL files. These endpoints delegate to
:class:`~services.app_dsl_service.AppDslService` for the actual work.

Import requires a ``creator_email`` identifying the workspace member who
will create the imported app. The caller (admin-api) is responsible for
deciding which user to attribute the operation to.
"""

from flask import request
from flask_restx import Resource
from pydantic import BaseModel
from sqlalchemy.orm import Session

from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from extensions.ext_database import db
from models import Account, App
from services.app_dsl_service import AppDslService, ImportMode, ImportStatus


class InnerAppDSLImportPayload(BaseModel):
    yaml_content: str
    creator_email: str
    name: str | None = None
    description: str | None = None


@inner_api_ns.route("/enterprise/workspaces/<string:workspace_id>/dsl/import")
class EnterpriseAppDSLImport(Resource):
    @setup_required
    @enterprise_inner_api_only
    def post(self, workspace_id: str):
        """Import a DSL into a workspace on behalf of a specified creator.

        Requires ``creator_email`` to identify the account that will own the
        imported app. The account must be active. Workspace existence and
        membership are validated by the Go admin-api caller.

        Returns 200 on success, 202 when a DSL version mismatch requires
        confirmation, and 400 on business failure.
        """
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

        status_code_map = {
            ImportStatus.FAILED: 400,
            ImportStatus.PENDING: 202,
        }
        return result.model_dump(mode="json"), status_code_map.get(result.status, 200)


@inner_api_ns.route("/enterprise/apps/<string:app_id>/dsl")
class EnterpriseAppDSLExport(Resource):
    @setup_required
    @enterprise_inner_api_only
    def get(self, app_id: str):
        """Export an app's DSL as YAML.

        This is a global lookup by app_id (no tenant scoping) because the
        admin-api caller has platform-level access via secret-key auth.
        """
        include_secret = request.args.get("include_secret", "false").lower() == "true"

        app_model = db.session.query(App).filter_by(id=app_id).first()
        if not app_model:
            return {"message": "app not found"}, 404

        data = AppDslService.export_dsl(
            app_model=app_model,
            include_secret=include_secret,
        )

        return {"data": data}, 200


def _get_active_account(email: str) -> Account | None:
    """Look up an active account by email.

    Workspace membership is already validated by the Go admin-api caller;
    this function only needs to retrieve the Account object for AppDslService.
    """
    account = db.session.query(Account).filter_by(email=email).first()
    if account is None or account.status != "active":
        return None
    return account
