import logging

from flask_restx import Resource, marshal_with, reqparse
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.workflow_alias_fields import (
    workflow_alias_fields,
    workflow_alias_list_fields,
)
from libs.login import current_user, login_required
from models import App, AppMode
from models.account import Account
from services.workflow_alias_service import CreateOrUpdateAliasRequest, WorkflowAliasService

logger = logging.getLogger(__name__)


class WorkflowAliasApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_alias_list_fields)
    def get(self, app_model: App):
        assert isinstance(current_user, Account)
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("workflow_ids", type=str, required=False, location="args")
        parser.add_argument("limit", type=int, required=False, default=100, location="args")
        parser.add_argument("offset", type=int, required=False, default=0, location="args")
        args = parser.parse_args()

        workflow_ids = args.get("workflow_ids")
        if workflow_ids:
            workflow_ids = [wid.strip() for wid in workflow_ids.split(",") if wid.strip()]

        limit = args.get("limit", 100)
        offset = args.get("offset", 0)

        # Validate pagination parameters
        if limit < 1 or limit > 1000:
            limit = 100
        if offset < 0:
            offset = 0

        workflow_alias_service = WorkflowAliasService()

        aliases = workflow_alias_service.get_aliases_by_app(
            session=db.session,
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            workflow_ids=workflow_ids,
            limit=limit,
            offset=offset,
        )

        return {
            "items": aliases,
            "page": (offset // limit) + 1,
            "limit": limit,
            "has_more": len(aliases) == limit,
        }

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_alias_fields)
    def post(self, app_model: App):
        assert isinstance(current_user, Account)
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("workflow_id", type=str, required=True, location="json")
        parser.add_argument("alias_name", type=str, required=True, location="json")
        parser.add_argument("alias_type", type=str, required=False, default="custom", location="json")

        args = parser.parse_args()

        workflow_id = args.get("workflow_id")
        alias_name = args.get("alias_name")
        alias_type = args.get("alias_type", "custom")

        if not alias_name or len(alias_name) > 255:
            raise BadRequest("Invalid alias name")

        workflow_alias_service = WorkflowAliasService()

        try:
            request = CreateOrUpdateAliasRequest(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                workflow_id=workflow_id,
                alias_name=alias_name,
                alias_type=alias_type,
                created_by=current_user.id,
            )

            with Session(db.engine) as session, session.begin():
                alias = workflow_alias_service.create_or_update_alias(
                    session=session,
                    request=request,
                )
                return alias
        except ValueError as e:
            raise BadRequest(str(e))

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def delete(self, app_model: App):
        assert isinstance(current_user, Account)
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("alias_id", type=str, required=True, location="args")
        args = parser.parse_args()

        alias_id = args.get("alias_id")

        workflow_alias_service = WorkflowAliasService()

        try:
            workflow_alias_service.delete_alias(
                session=db.session,
                alias_id=alias_id,
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
            )
            db.session.commit()
            return {"message": "Alias deleted successfully"}
        except ValueError as e:
            raise BadRequest(str(e))
