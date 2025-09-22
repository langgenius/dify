import logging

from flask_restx import Resource, fields, marshal_with, reqparse

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from fields.member_fields import account_with_role_fields
from fields.workflow_comment_fields import (
    workflow_comment_basic_fields,
    workflow_comment_create_fields,
    workflow_comment_detail_fields,
    workflow_comment_reply_create_fields,
    workflow_comment_reply_update_fields,
    workflow_comment_resolve_fields,
    workflow_comment_update_fields,
)
from libs.login import current_user, login_required
from models import App
from services.account_service import TenantService
from services.workflow_comment_service import WorkflowCommentService

logger = logging.getLogger(__name__)


class WorkflowCommentListApi(Resource):
    """API for listing and creating workflow comments."""

    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model
    @marshal_with(workflow_comment_basic_fields, envelope="data")
    def get(self, app_model: App):
        """Get all comments for a workflow."""
        comments = WorkflowCommentService.get_comments(tenant_id=current_user.current_tenant_id, app_id=app_model.id)

        return comments

    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model
    @marshal_with(workflow_comment_create_fields)
    def post(self, app_model: App):
        """Create a new workflow comment."""
        parser = reqparse.RequestParser()
        parser.add_argument("position_x", type=float, required=True, location="json")
        parser.add_argument("position_y", type=float, required=True, location="json")
        parser.add_argument("content", type=str, required=True, location="json")
        parser.add_argument("mentioned_user_ids", type=list, location="json", default=[])
        args = parser.parse_args()

        result = WorkflowCommentService.create_comment(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            created_by=current_user.id,
            content=args.content,
            position_x=args.position_x,
            position_y=args.position_y,
            mentioned_user_ids=args.mentioned_user_ids,
        )

        return result, 201


class WorkflowCommentDetailApi(Resource):
    """API for managing individual workflow comments."""

    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model
    @marshal_with(workflow_comment_detail_fields)
    def get(self, app_model: App, comment_id: str):
        """Get a specific workflow comment."""
        comment = WorkflowCommentService.get_comment(
            tenant_id=current_user.current_tenant_id, app_id=app_model.id, comment_id=comment_id
        )

        return comment

    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model
    @marshal_with(workflow_comment_update_fields)
    def put(self, app_model: App, comment_id: str):
        """Update a workflow comment."""
        parser = reqparse.RequestParser()
        parser.add_argument("content", type=str, required=True, location="json")
        parser.add_argument("position_x", type=float, required=False, location="json")
        parser.add_argument("position_y", type=float, required=False, location="json")
        parser.add_argument("mentioned_user_ids", type=list, location="json", default=[])
        args = parser.parse_args()

        result = WorkflowCommentService.update_comment(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            comment_id=comment_id,
            user_id=current_user.id,
            content=args.content,
            position_x=args.position_x,
            position_y=args.position_y,
            mentioned_user_ids=args.mentioned_user_ids,
        )

        return result

    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model
    def delete(self, app_model: App, comment_id: str):
        """Delete a workflow comment."""
        WorkflowCommentService.delete_comment(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            comment_id=comment_id,
            user_id=current_user.id,
        )

        return {"result": "success"}, 204


class WorkflowCommentResolveApi(Resource):
    """API for resolving and reopening workflow comments."""

    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model
    @marshal_with(workflow_comment_resolve_fields)
    def post(self, app_model: App, comment_id: str):
        """Resolve a workflow comment."""
        comment = WorkflowCommentService.resolve_comment(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            comment_id=comment_id,
            user_id=current_user.id,
        )

        return comment


class WorkflowCommentReplyApi(Resource):
    """API for managing comment replies."""

    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model
    @marshal_with(workflow_comment_reply_create_fields)
    def post(self, app_model: App, comment_id: str):
        """Add a reply to a workflow comment."""
        # Validate comment access first
        WorkflowCommentService.validate_comment_access(
            comment_id=comment_id, tenant_id=current_user.current_tenant_id, app_id=app_model.id
        )

        parser = reqparse.RequestParser()
        parser.add_argument("content", type=str, required=True, location="json")
        parser.add_argument("mentioned_user_ids", type=list, location="json", default=[])
        args = parser.parse_args()

        result = WorkflowCommentService.create_reply(
            comment_id=comment_id,
            content=args.content,
            created_by=current_user.id,
            mentioned_user_ids=args.mentioned_user_ids,
        )

        return result, 201


class WorkflowCommentReplyDetailApi(Resource):
    """API for managing individual comment replies."""

    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model
    @marshal_with(workflow_comment_reply_update_fields)
    def put(self, app_model: App, comment_id: str, reply_id: str):
        """Update a comment reply."""
        # Validate comment access first
        WorkflowCommentService.validate_comment_access(
            comment_id=comment_id, tenant_id=current_user.current_tenant_id, app_id=app_model.id
        )

        parser = reqparse.RequestParser()
        parser.add_argument("content", type=str, required=True, location="json")
        parser.add_argument("mentioned_user_ids", type=list, location="json", default=[])
        args = parser.parse_args()

        reply = WorkflowCommentService.update_reply(
            reply_id=reply_id, user_id=current_user.id, content=args.content, mentioned_user_ids=args.mentioned_user_ids
        )

        return reply

    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model
    def delete(self, app_model: App, comment_id: str, reply_id: str):
        """Delete a comment reply."""
        # Validate comment access first
        WorkflowCommentService.validate_comment_access(
            comment_id=comment_id, tenant_id=current_user.current_tenant_id, app_id=app_model.id
        )

        WorkflowCommentService.delete_reply(reply_id=reply_id, user_id=current_user.id)

        return {"result": "success"}, 204


class WorkflowCommentMentionUsersApi(Resource):
    """API for getting mentionable users for workflow comments."""

    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model
    @marshal_with({"users": fields.List(fields.Nested(account_with_role_fields))})
    def get(self, app_model: App):
        """Get all users in current tenant for mentions."""
        members = TenantService.get_tenant_members(current_user.current_tenant)
        return {"users": members}


# Register API routes
api.add_resource(WorkflowCommentListApi, "/apps/<uuid:app_id>/workflow/comments")
api.add_resource(WorkflowCommentDetailApi, "/apps/<uuid:app_id>/workflow/comments/<string:comment_id>")
api.add_resource(WorkflowCommentResolveApi, "/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/resolve")
api.add_resource(WorkflowCommentReplyApi, "/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/replies")
api.add_resource(
    WorkflowCommentReplyDetailApi, "/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/replies/<string:reply_id>"
)
api.add_resource(WorkflowCommentMentionUsersApi, "/apps/<uuid:app_id>/workflow/comments/mention-users")
