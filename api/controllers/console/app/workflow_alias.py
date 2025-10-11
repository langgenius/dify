import logging

from flask_restx import Resource, marshal_with, reqparse
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.workflow_alias_fields import (
    workflow_alias_create_update_fields,
    workflow_alias_fields,
    workflow_alias_list_fields,
)
from libs.helper import alias_name, uuid_value
from libs.login import current_user, login_required
from models import App, AppMode
from models.account import Account
from services.workflow_alias_service import WorkflowAliasArgs, WorkflowAliasService

logger = logging.getLogger(__name__)


class WorkflowAliasApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_alias_list_fields)
    @api.doc("get_workflow_aliases")
    @api.doc(description="Get workflow aliases for an app")
    @api.doc(params={"app_id": "App ID"})
    @api.doc(
        responses={
            200: "Workflow aliases retrieved successfully",
            401: "Unauthorized - user not logged in",
            403: "Forbidden - user is not an editor",
            404: "App not found",
        }
    )
    def get(self, app_model: App):
        assert isinstance(current_user, Account)
        if not current_user.has_edit_permission:
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
        if limit < 1:
            limit = 1
        elif limit > 1000:
            limit = 1000

        if offset < 0:
            offset = 0

        workflow_alias_service = WorkflowAliasService()

        aliases = workflow_alias_service.get_aliases_by_app(
            session=db.session,
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
    @api.doc("create_or_update_workflow_alias")
    @api.doc(description="Create or update a workflow alias")
    @api.doc(params={"app_id": "App ID"})
    @api.expect(workflow_alias_create_update_fields, validate=True)
    @api.doc(
        responses={
            200: "Workflow alias created or updated successfully",
            400: "Bad request - invalid parameters",
            401: "Unauthorized - user not logged in",
            403: "Forbidden - user is not an editor",
            404: "App not found",
        }
    )
    def post(self, app_model: App):
        assert isinstance(current_user, Account)
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("workflow_id", type=uuid_value, required=True, location="json", help="Workflow ID")
        parser.add_argument("name", type=alias_name, required=True, location="json", help="Alias name")

        args = parser.parse_args()

        workflow_id = args.get("workflow_id")
        name = args.get("name")

        workflow_alias_service = WorkflowAliasService()

        try:
            request = WorkflowAliasArgs(
                app_id=app_model.id,
                workflow_id=workflow_id.strip() if workflow_id else "",
                name=name.strip() if name else "",
                created_by=current_user.id,
            )

            alias = workflow_alias_service.create_or_update_alias(
                session=db.session,
                request=request,
            )
            db.session.commit()

            return alias

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error creating/updating workflow alias")
            raise BadRequest("Failed to create or update workflow alias")

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @api.doc("delete_workflow_alias")
    @api.doc(description="Delete a workflow alias")
    @api.doc(params={"app_id": "App ID", "alias_id": "Alias ID"})
    @api.doc(
        responses={
            200: "Workflow alias deleted successfully",
            401: "Unauthorized - user not logged in",
            403: "Forbidden - user is not an editor",
            404: "App or alias not found",
        }
    )
    def delete(self, app_model: App, alias_id: str):
        assert isinstance(current_user, Account)
        if not current_user.has_edit_permission:
            raise Forbidden()

        workflow_alias_service = WorkflowAliasService()

        try:
            workflow_alias_service.delete_alias(
                session=db.session,
                alias_id=alias_id,
                app_id=app_model.id,
            )
            db.session.commit()

            return {"message": "Workflow alias deleted successfully"}

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error deleting workflow alias")
            raise BadRequest("Failed to delete workflow alias")
