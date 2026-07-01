from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from configs import dify_config
from controllers.common.schema import register_enum_models, register_schema_models
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    cloud_edition_billing_resource_check,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_user,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.login import current_account_with_tenant, login_required
from models.account import Account
from models.model import App
from services.app_dsl_service import (
    IMPORT_INFO_REDIS_KEY_PREFIX,
    AppDslService,
    Import,
    PendingData,
)
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.dsl_entities import CheckDependenciesResult, ImportStatus
from services.feature_service import FeatureService

from .. import console_ns
from .permission_keys import get_app_permission_keys


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


def _current_user_and_tenant_id(current_user: Account | None) -> tuple[Account, str | None]:
    if current_user is None:
        account, tenant_id = current_account_with_tenant()
        return account, str(tenant_id) if tenant_id else None

    current_tenant_id = getattr(current_user, "current_tenant_id", None)
    if current_tenant_id:
        return current_user, str(current_tenant_id)

    current_tenant = getattr(current_user, "current_tenant", None)
    current_tenant_object_id = getattr(current_tenant, "id", None)
    if current_tenant_object_id:
        return current_user, str(current_tenant_object_id)

    account, fallback_tenant_id = current_account_with_tenant()
    return account, str(fallback_tenant_id) if fallback_tenant_id else None


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
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_IMPORT_EXPORT_DSL, resource_required=False)
    @with_current_user
    def post(self, current_user: Account | None = None):
        args = AppImportPayload.model_validate(console_ns.payload)
        current_user = current_user if current_user is not None else _current_user_and_tenant_id(None)[0]

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

        is_created_app = args.app_id is None and result.status in {
            ImportStatus.COMPLETED,
            ImportStatus.COMPLETED_WITH_WARNINGS,
        }
        if dify_config.RBAC_ENABLED and is_created_app and result.app_id:
            current_user, current_tenant_id = _current_user_and_tenant_id(current_user)
            if current_tenant_id:
                result.permission_keys = get_app_permission_keys(
                    current_tenant_id,
                    current_user.id,
                    result.app_id,
                )

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
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_IMPORT_EXPORT_DSL, resource_required=False)
    @with_current_user
    def post(self, current_user: Account | None = None, import_id: str = ""):
        current_user = current_user if current_user is not None else _current_user_and_tenant_id(None)[0]
        redis_key = f"{IMPORT_INFO_REDIS_KEY_PREFIX}{import_id}"
        pending_data_raw = redis_client.get(redis_key)
        pending_data: PendingData | None = None
        if pending_data_raw:
            pending_data = PendingData.model_validate_json(pending_data_raw)

        with Session(db.engine, expire_on_commit=False) as session:
            import_service = AppDslService(session)
            # Confirm import
            account = current_user
            result = import_service.confirm_import(import_id=import_id, account=account)
            if result.status == ImportStatus.FAILED:
                session.rollback()
            else:
                session.commit()

        is_created_app = bool(
            pending_data
            and pending_data.app_id is None
            and result.status
            in {
                ImportStatus.COMPLETED,
                ImportStatus.COMPLETED_WITH_WARNINGS,
            }
        )
        if dify_config.RBAC_ENABLED and is_created_app and result.app_id:
            current_user, current_tenant_id = _current_user_and_tenant_id(current_user)
            if current_tenant_id:
                result.permission_keys = get_app_permission_keys(
                    current_tenant_id,
                    current_user.id,
                    result.app_id,
                )

        # Return appropriate status code based on result
        if result.status == ImportStatus.FAILED:
            return result.model_dump(mode="json"), 400
        return result.model_dump(mode="json"), 200


@console_ns.route("/apps/imports/<string:app_id>/check-dependencies")
class AppImportCheckDependenciesApi(Resource):
    @console_ns.response(
        200,
        "Dependencies checked",
        console_ns.models[CheckDependenciesResult.__name__],
    )
    @setup_required
    @login_required
    @get_app_model
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    def get(self, app_model: App):
        with Session(db.engine, expire_on_commit=False) as session:
            import_service = AppDslService(session)
            result = import_service.check_dependencies(app_model=app_model)

        return result.model_dump(mode="json"), 200
