from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    edit_permission_required,
    setup_required,
)
from extensions.ext_database import db
from fields.app_fields import (
    app_import_check_dependencies_fields,
    app_import_fields,
    leaked_dependency_fields,
)
from libs.login import current_account_with_tenant, login_required
from models.model import App
from services.app_dsl_service import AppDslService, ImportStatus
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService

from .. import console_ns

# Register models for flask_restx to avoid dict type issues in Swagger
# Register base model first
leaked_dependency_model = console_ns.model("LeakedDependency", leaked_dependency_fields)

app_import_model = console_ns.model("AppImport", app_import_fields)

# For nested models, need to replace nested dict with registered model
app_import_check_dependencies_fields_copy = app_import_check_dependencies_fields.copy()
app_import_check_dependencies_fields_copy["leaked_dependencies"] = fields.List(fields.Nested(leaked_dependency_model))
app_import_check_dependencies_model = console_ns.model(
    "AppImportCheckDependencies", app_import_check_dependencies_fields_copy
)

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class AppImportPayload(BaseModel):
    mode: str = Field(..., description="Import mode")
    yaml_content: str | None = None
    yaml_url: str | None = None
    name: str | None = None
    description: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    app_id: str | None = None


console_ns.schema_model(
    AppImportPayload.__name__, AppImportPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)


@console_ns.route("/apps/imports")
class AppImportApi(Resource):
    @console_ns.expect(console_ns.models[AppImportPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_import_model)
    @cloud_edition_billing_resource_check("apps")
    @edit_permission_required
    def post(self):
        # Check user role first
        current_user, _ = current_account_with_tenant()
        args = AppImportPayload.model_validate(console_ns.payload)

        # Create service with session
        with Session(db.engine) as session:
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
            session.commit()
        if result.app_id and FeatureService.get_system_features().webapp_auth.enabled:
            # update web app setting as private
            EnterpriseService.WebAppAuth.update_app_access_mode(result.app_id, "private")
        # Return appropriate status code based on result
        status = result.status
        if status == ImportStatus.FAILED:
            return result.model_dump(mode="json"), 400
        elif status == ImportStatus.PENDING:
            return result.model_dump(mode="json"), 202
        return result.model_dump(mode="json"), 200


@console_ns.route("/apps/imports/<string:import_id>/confirm")
class AppImportConfirmApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_import_model)
    @edit_permission_required
    def post(self, import_id):
        # Check user role first
        current_user, _ = current_account_with_tenant()

        # Create service with session
        with Session(db.engine) as session:
            import_service = AppDslService(session)
            # Confirm import
            account = current_user
            result = import_service.confirm_import(import_id=import_id, account=account)
            session.commit()

        # Return appropriate status code based on result
        if result.status == ImportStatus.FAILED:
            return result.model_dump(mode="json"), 400
        return result.model_dump(mode="json"), 200


@console_ns.route("/apps/imports/<string:app_id>/check-dependencies")
class AppImportCheckDependenciesApi(Resource):
    @setup_required
    @login_required
    @get_app_model
    @account_initialization_required
    @marshal_with(app_import_check_dependencies_model)
    @edit_permission_required
    def get(self, app_model: App):
        with Session(db.engine) as session:
            import_service = AppDslService(session)
            result = import_service.check_dependencies(app_model=app_model)

        return result.model_dump(mode="json"), 200
