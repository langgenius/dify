"""Inner API endpoints for app DSL import/export.

Called by the Go admin-api service (dify-enterprise) to import and export
app definitions as YAML DSL files. These endpoints delegate to
:class:`~services.app_dsl_service.AppDslService` for the actual work.

Import requires an ``account_email`` identifying the workspace member who
will own the imported app. The caller (admin-api) is responsible for
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
from models.account import TenantAccountJoin
from services.app_dsl_service import AppDslService, ImportMode, ImportStatus


class InnerAppDSLImportPayload(BaseModel):
    yaml_content: str
    account_email: str
    name: str | None = None
    description: str | None = None


@inner_api_ns.route("/enterprise/workspaces/<string:workspace_id>/dsl/import")
class EnterpriseAppDSLImport(Resource):
    @setup_required
    @enterprise_inner_api_only
    def post(self, workspace_id: str):
        """Import a DSL into a workspace on behalf of a specified account.

        Requires ``account_email`` to identify the workspace member who will
        own the imported app. The account must be active and belong to the
        target workspace. Returns 202 when a DSL version mismatch requires
        confirmation, 400 on business failure, and 200 on success.
        """
        args = InnerAppDSLImportPayload.model_validate(inner_api_ns.payload or {})

        account = _resolve_workspace_account(workspace_id, args.account_email)
        if account is None:
            return {
                "message": f"account '{args.account_email}' not found, inactive, "
                f"or not a member of workspace '{workspace_id}'"
            }, 404

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
        elif result.status == ImportStatus.PENDING:
            return result.model_dump(mode="json"), 202
        return result.model_dump(mode="json"), 200


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


def _resolve_workspace_account(workspace_id: str, email: str) -> Account | None:
    """Look up an active account by email and verify it belongs to the workspace.

    Returns the account with its tenant set, or None if the account doesn't
    exist, is inactive, or is not a member of the given workspace.
    """
    account = db.session.query(Account).filter_by(email=email).first()
    if account is None or account.status != "active":
        return None

    membership = (
        db.session.query(TenantAccountJoin)
        .filter_by(tenant_id=workspace_id, account_id=account.id)
        .first()
    )
    if membership is None:
        return None

    return account
