from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from controllers.common.schema import register_enum_models, register_schema_models
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    edit_permission_required,
    setup_required,
)
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models.model import App
from services.app_dsl_service import AppDslService, Import
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.dsl_entities import CheckDependenciesResult, ImportStatus
from services.feature_service import FeatureService

from .. import console_ns


class AppImportPayload(BaseModel):
    mode: str = Field(..., description="Import mode")
    yaml_content: str | None = Field(None)
    yaml_url: str | None = Field(None)
    name: str | None = Field(None)
    description: str | None = Field(None)
    icon_type: str | None = Field(None)
    icon: str | None = Field(None)
    icon_background: str | None = Field(None)
    app_id: str | None = Field(None)


register_enum_models(console_ns, ImportStatus)
register_schema_models(console_ns, AppImportPayload, Import, CheckDependenciesResult)


@console_ns.route("/apps/imports")
class AppImportApi(Resource):
    @console_ns.expect(console_ns.models[AppImportPayload.__name__])
    @console_ns.response(200, "Import completed", console_ns.models[Import.__name__])
    @console_ns.response(202, "Import pending confirmation", console_ns.models[Import.__name__])
    @console_ns.response(400, "Import failed", console_ns.models[Import.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("apps")
    @edit_permission_required
    def post(self):
        # Check user role first
        current_user, _ = current_account_with_tenant()
        args = AppImportPayload.model_validate(console_ns.payload)

        # AppDslService performs internal commits for some creation paths, so use a plain
        # Session here instead of nesting it inside sessionmaker(...).begin().
        with Session(db.engine, expire_on_commit=False) as session:
            import_service = AppDslService(session)
            # Import app
            account = current_user
            result = import_service.import_app(
                account=account,
                import_mode=args.mode,
                yaml_content=args.yaml_content,
                yaml_url=args.yaml_url,
                name=args.name,
                description=args.description,
                icon_type=args.icon_type,
                icon=args.icon,
                icon_background=args.icon_background,
                app_id=args.app_id,
            )
            if result.status == ImportStatus.FAILED:
                session.rollback()
            else:
                session.commit()
        if result.app_id and FeatureService.get_system_features().webapp_auth.enabled:
            # update web app setting as private
            EnterpriseService.WebAppAuth.update_app_access_mode(result.app_id, "private")
        # Return appropriate status code based on result
        status = result.status
        match status:
            case ImportStatus.FAILED:
                return result.model_dump(mode="json"), 400
            case ImportStatus.PENDING:
                return result.model_dump(mode="json"), 202
            case ImportStatus.COMPLETED | ImportStatus.COMPLETED_WITH_WARNINGS:
                return result.model_dump(mode="json"), 200


@console_ns.route("/apps/imports/<string:import_id>/confirm")
class AppImportConfirmApi(Resource):
    @console_ns.response(200, "Import confirmed", console_ns.models[Import.__name__])
    @console_ns.response(400, "Import failed", console_ns.models[Import.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, import_id):
        # Check user role first
        current_user, _ = current_account_with_tenant()

        with Session(db.engine, expire_on_commit=False) as session:
            import_service = AppDslService(session)
            # Confirm import
            account = current_user
            result = import_service.confirm_import(import_id=import_id, account=account)
            if result.status == ImportStatus.FAILED:
                session.rollback()
            else:
                session.commit()

        # Return appropriate status code based on result
        if result.status == ImportStatus.FAILED:
            return result.model_dump(mode="json"), 400
        return result.model_dump(mode="json"), 200


@console_ns.route("/apps/imports/<string:app_id>/check-dependencies")
class AppImportCheckDependenciesApi(Resource):
    @console_ns.response(200, "Dependencies checked", console_ns.models[CheckDependenciesResult.__name__])
    @setup_required
    @login_required
    @get_app_model
    @account_initialization_required
    @edit_permission_required
    def get(self, app_model: App):
        with Session(db.engine, expire_on_commit=False) as session:
            import_service = AppDslService(session)
            result = import_service.check_dependencies(app_model=app_model)

        return result.model_dump(mode="json"), 200
