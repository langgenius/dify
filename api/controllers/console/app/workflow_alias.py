import logging

from flask_restful import Resource, marshal_with, reqparse
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

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
from services.workflow_alias_service import WorkflowAliasService

logger = logging.getLogger(__name__)


class WorkflowAliasCreateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_alias_fields)
    def post(self, app_model: App):
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
            alias = workflow_alias_service.create_alias(
                session=db.session,
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                workflow_id=workflow_id,
                alias_name=alias_name,
                alias_type=alias_type,

                created_by=current_user.id,
            )
            db.session.commit()
            return alias
        except ValueError as e:
            raise BadRequest(str(e))


class WorkflowAliasDetailApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_alias_fields)
    def get(self, app_model: App, alias_id: str):
        if not current_user.is_editor:
            raise Forbidden()

        workflow_alias_service = WorkflowAliasService()

        from models import WorkflowAlias
        alias = db.session.get(WorkflowAlias, alias_id)
        if not alias or alias.app_id != app_model.id:
            raise NotFound("Alias not found")

        return alias

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_alias_fields)
    def patch(self, app_model: App, alias_id: str):
        if not current_user.is_editor:
            raise Forbidden()

        if not isinstance(current_user, Account):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("alias_name", type=str, required=False, location="json")
        parser.add_argument("description", type=str, required=False, location="json")
        args = parser.parse_args()

        alias_name = args.get("alias_name")
        description = args.get("description")

        if not alias_name and description is None:
            raise BadRequest("No valid fields to update")

        workflow_alias_service = WorkflowAliasService()

        try:
            alias = workflow_alias_service.update_alias(
                session=db.session,
                alias_id=alias_id,
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                alias_name=alias_name,
                description=description,
            )
            db.session.commit()
            return alias
        except ValueError as e:
            raise BadRequest(str(e))

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def delete(self, app_model: App, alias_id: str):
        if not current_user.is_editor:
            raise Forbidden()

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


class WorkflowAliasByWorkflowApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_alias_list_fields)
    def get(self, app_model: App, workflow_id: str):
        if not current_user.is_editor:
            raise Forbidden()

        workflow_alias_service = WorkflowAliasService()

        aliases = workflow_alias_service.get_aliases_by_workflow(
            session=db.session,
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            workflow_id=workflow_id,
        )

        return {
            "items": aliases,
            "page": 1,
            "limit": len(aliases),
            "has_more": False,
        }





def register_routes():
    from controllers.console import api

    api.add_resource(
        WorkflowAliasCreateApi,
        "/apps/<uuid:app_id>/workflow-aliases",
    )
    api.add_resource(
        WorkflowAliasDetailApi,
        "/apps/<uuid:app_id>/workflow-aliases/<string:alias_id>",
    )
    api.add_resource(
        WorkflowAliasByWorkflowApi,
        "/apps/<uuid:app_id>/workflows/<string:workflow_id>/aliases",
    )
