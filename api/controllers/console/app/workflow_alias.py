import logging

from flask_restx import Resource, fields, marshal_with, reqparse
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.member_fields import build_simple_account_model
from libs.helper import TimestampField, alias_name, uuid_value
from libs.login import current_user, login_required
from models import App, AppMode
from models.account import Account
from services.workflow_alias_service import WorkflowAliasArgs, WorkflowAliasService

logger = logging.getLogger(__name__)


created_by_account_model = build_simple_account_model(api)

workflow_alias_model = api.model(
    "WorkflowAlias",
    {
        "id": fields.String,
        "app_id": fields.String,
        "workflow_id": fields.String,
        "name": fields.String,
        "created_by": fields.Nested(created_by_account_model, attribute="created_by_account"),
        "created_at": TimestampField,
        "updated_at": TimestampField,
        "is_transferred": fields.Boolean(attribute="_is_transferred", default=False),
        "old_workflow_id": fields.String(attribute="_old_workflow_id", default=None),
    },
)

workflow_alias_list_model = api.model(
    "WorkflowAliasList",
    {
        "items": fields.List(fields.Nested(workflow_alias_model)),
        "page": fields.Integer,
        "limit": fields.Integer,
        "has_more": fields.Boolean,
    },
)

workflow_alias_create_update_model = api.model(
    "WorkflowAliasCreateUpdate",
    {
        "workflow_id": fields.String,
        "name": fields.String,
    },
)

class WorkflowAliasApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_alias_list_model)
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
    @marshal_with(workflow_alias_model)
    @api.doc("create_or_update_workflow_alias")
    @api.doc(description="Create or update a workflow alias")
    @api.doc(params={"app_id": "App ID"})
    @api.expect(workflow_alias_create_update_model, validate=True)
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
        if not current_user.is_editor:
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
                workflow_id=workflow_id.strip(),
                name=name.strip(),
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

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @api.doc("delete_workflow_alias")
    @api.doc(description="Delete a workflow alias")
    @api.doc(params={"app_id": "App ID"})
    @api.doc(
        responses={
            200: "Workflow alias deleted successfully",
            400: "Bad request - invalid parameters",
            401: "Unauthorized - user not logged in",
            403: "Forbidden - user is not an editor",
            404: "App not found",
        }
    )
    def delete(self, app_model: App):
        assert isinstance(current_user, Account)
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("alias_id", type=str, required=True, location="args")
        args = parser.parse_args()

        alias_id = args.get("alias_id")

        if not alias_id or not alias_id.strip():
            raise BadRequest("alias_id is required")

        workflow_alias_service = WorkflowAliasService()

        try:
            workflow_alias_service.delete_alias(
                session=db.session,
                alias_id=alias_id,
                app_id=app_model.id,
            )
            db.session.commit()
            return {"message": "Alias deleted successfully"}
        except ValueError as e:
            raise BadRequest(str(e))
