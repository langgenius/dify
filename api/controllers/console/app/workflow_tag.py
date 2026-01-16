import logging
from dataclasses import dataclass
from typing import Any

from flask_restx import Resource, marshal_with, reqparse
from flask_restx.inputs import int_range
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.workflow_tag_fields import (
    workflow_tag_create_update_fields,
    workflow_tag_fields,
    workflow_tag_list_fields,
)
from libs.helper import tag_name, uuid_value
from libs.login import current_user, login_required
from models import App, AppMode
from models.account import Account
from services.workflow_tag_service import WorkflowTagArgs, WorkflowTagService
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)


@dataclass
class PaginatedResponse:
    """Structured pagination response object."""

    items: list[Any]
    limit: int
    offset: int
    has_more: bool

    @property
    def page(self) -> int:
        """Calculate current page from offset and limit."""
        return (self.offset // self.limit) + 1

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary format for API response."""
        return {
            "items": self.items,
            "page": self.page,
            "limit": self.limit,
            "has_more": self.has_more,
        }


def _create_pagination_parser() -> reqparse.RequestParser:
    """Create a parser with validated pagination parameters."""
    parser = reqparse.RequestParser()
    parser.add_argument(
        "workflow_ids", type=str, required=False, location="args", help="Comma-separated list of workflow IDs"
    )
    parser.add_argument(
        "limit",
        type=int_range(1, 1000),
        required=False,
        default=100,
        location="args",
        help="Number of items to return (1-1000)",
    )
    parser.add_argument(
        "offset",
        type=int_range(0, 1000000),
        required=False,
        default=0,
        location="args",
        help="Number of items to skip (0-1000000)",
    )
    return parser


class WorkflowTagApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_tag_list_fields)
    @api.doc("get_workflow_tags")
    @api.doc(description="Get workflow tags for an app")
    @api.doc(params={"app_id": "App ID"})
    @api.doc(
        responses={
            200: "Workflow tags retrieved successfully",
            401: "Unauthorized - user not logged in",
            403: "Forbidden - user is not an editor",
            404: "App not found",
        }
    )
    def get(self, app_model: App):
        assert isinstance(current_user, Account)
        if not current_user.has_edit_permission:
            raise Forbidden()

        # Use validated pagination parser
        parser = _create_pagination_parser()
        args = parser.parse_args()

        workflow_ids = args.get("workflow_ids")
        if workflow_ids:
            workflow_ids = [wid.strip() for wid in workflow_ids.split(",") if wid.strip()]

        limit = args["limit"]
        offset = args["offset"]

        workflow_tag_service = WorkflowTagService(session=db.session)

        tags = workflow_tag_service.get_tags_by_app(
            app_id=app_model.id,
            workflow_ids=workflow_ids,
            limit=limit,
            offset=offset,
        )

        return PaginatedResponse(
            items=list(tags or []),
            limit=limit,
            offset=offset,
            has_more=len(tags or []) == limit,
        ).to_dict()

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_tag_fields)
    @api.doc("create_or_update_workflow_tag")
    @api.doc(description="Create or update a workflow tag")
    @api.doc(params={"app_id": "App ID"})
    @api.expect(workflow_tag_create_update_fields, validate=True)
    @api.doc(
        responses={
            200: "Workflow tag created or updated successfully",
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
        parser.add_argument("name", type=tag_name, required=True, location="json", help="Tag name")

        args = parser.parse_args()

        workflow_id = args.get("workflow_id")
        name = args.get("name")

        workflow_service = WorkflowService()
        workflow_tag_service = WorkflowTagService(session=db.session)
        try:
            request = WorkflowTagArgs(
                app_id=app_model.id,
                workflow_id=workflow_id.strip() if workflow_id else "",
                name=name.strip() if name else "",
                created_by=current_user.id,
            )

            # Check if tag already exists to determine create vs update
            existing_tag = workflow_service.get_workflow_by_tag(
                session=db.session,
                app_id=app_model.id,
                name=request.name,
            )

            if existing_tag:
                # Update existing tag
                tag = workflow_tag_service.update_tag(
                    request=request,
                )
            else:
                # Create new tag
                tag = workflow_tag_service.create_tag(
                    request=request,
                )

            db.session.commit()

            return tag

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error creating/updating workflow tag")
            raise BadRequest("Failed to create or update workflow tag")

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @api.doc("delete_workflow_tag")
    @api.doc(description="Delete a workflow tag")
    @api.doc(params={"app_id": "App ID", "tag_id": "Tag ID"})
    @api.doc(
        responses={
            200: "Workflow tag deleted successfully",
            401: "Unauthorized - user not logged in",
            403: "Forbidden - user is not an editor",
            404: "App or tag not found",
        }
    )
    def delete(self, app_model: App, tag_id: str):
        assert isinstance(current_user, Account)
        if not current_user.has_edit_permission:
            raise Forbidden()

        workflow_tag_service = WorkflowTagService(session=db.session)

        try:
            workflow_tag_service.delete_tag(
                tag_id=tag_id,
                app_id=app_model.id,
            )
            db.session.commit()

            return {"message": "Workflow tag deleted successfully"}

        except ValueError as e:
            raise BadRequest(str(e))
        except Exception as e:
            logger.exception("Error deleting workflow tag")
            raise BadRequest("Failed to delete workflow tag")