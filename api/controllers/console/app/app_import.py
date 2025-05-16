from typing import cast

from flask_login import current_user
from flask_restful import Resource, marshal_with, reqparse
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    setup_required,
)
from extensions.ext_database import db
from fields.app_fields import app_import_check_dependencies_fields, app_import_fields
from libs.login import login_required
from models import Account
from models.model import App
from services.app_dsl_service import AppDslService, ImportStatus


class AppImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_import_fields)
    @cloud_edition_billing_resource_check("apps")
    def post(self):
        # Check user role first
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("mode", type=str, required=True, location="json")
        parser.add_argument("yaml_content", type=str, location="json")
        parser.add_argument("yaml_url", type=str, location="json")
        parser.add_argument("name", type=str, location="json")
        parser.add_argument("description", type=str, location="json")
        parser.add_argument("icon_type", type=str, location="json")
        parser.add_argument("icon", type=str, location="json")
        parser.add_argument("icon_background", type=str, location="json")
        parser.add_argument("app_id", type=str, location="json")
        args = parser.parse_args()

        # Create service with session
        with Session(db.engine) as session:
            import_service = AppDslService(session)
            # Import app
            account = cast(Account, current_user)
            result = import_service.import_app(
                account=account,
                import_mode=args["mode"],
                yaml_content=args.get("yaml_content"),
                yaml_url=args.get("yaml_url"),
                name=args.get("name"),
                description=args.get("description"),
                icon_type=args.get("icon_type"),
                icon=args.get("icon"),
                icon_background=args.get("icon_background"),
                app_id=args.get("app_id"),
            )
            session.commit()

        # Return appropriate status code based on result
        status = result.status
        if status == ImportStatus.FAILED.value:
            return result.model_dump(mode="json"), 400
        elif status == ImportStatus.PENDING.value:
            return result.model_dump(mode="json"), 202
        return result.model_dump(mode="json"), 200


class AppImportConfirmApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(app_import_fields)
    def post(self, import_id):
        # Check user role first
        if not current_user.is_editor:
            raise Forbidden()

        # Create service with session
        with Session(db.engine) as session:
            import_service = AppDslService(session)
            # Confirm import
            account = cast(Account, current_user)
            result = import_service.confirm_import(import_id=import_id, account=account)
            session.commit()

        # Return appropriate status code based on result
        if result.status == ImportStatus.FAILED.value:
            return result.model_dump(mode="json"), 400
        return result.model_dump(mode="json"), 200


class AppImportCheckDependenciesApi(Resource):
    @setup_required
    @login_required
    @get_app_model
    @account_initialization_required
    @marshal_with(app_import_check_dependencies_fields)
    def get(self, app_model: App):
        if not current_user.is_editor:
            raise Forbidden()

        with Session(db.engine) as session:
            import_service = AppDslService(session)
            result = import_service.check_dependencies(app_model=app_model)

        return result.model_dump(mode="json"), 200
