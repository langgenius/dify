import logging

from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field

from controllers.console import console_ns
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
DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class WorkflowCommentCreatePayload(BaseModel):
    position_x: float = Field(..., description="Comment X position")
    position_y: float = Field(..., description="Comment Y position")
    content: str = Field(..., description="Comment content")
    mentioned_user_ids: list[str] = Field(default_factory=list, description="Mentioned user IDs")


class WorkflowCommentUpdatePayload(BaseModel):
    content: str = Field(..., description="Comment content")
    position_x: float | None = Field(default=None, description="Comment X position")
    position_y: float | None = Field(default=None, description="Comment Y position")
    mentioned_user_ids: list[str] = Field(default_factory=list, description="Mentioned user IDs")


class WorkflowCommentReplyCreatePayload(BaseModel):
    content: str = Field(..., description="Reply content")
    mentioned_user_ids: list[str] = Field(default_factory=list, description="Mentioned user IDs")


class WorkflowCommentReplyUpdatePayload(BaseModel):
    content: str = Field(..., description="Reply content")
    mentioned_user_ids: list[str] = Field(default_factory=list, description="Mentioned user IDs")


for model in (
    WorkflowCommentCreatePayload,
    WorkflowCommentUpdatePayload,
    WorkflowCommentReplyCreatePayload,
    WorkflowCommentReplyUpdatePayload,
):
    console_ns.schema_model(model.__name__, model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))

workflow_comment_basic_model = console_ns.model("WorkflowCommentBasic", workflow_comment_basic_fields)
workflow_comment_detail_model = console_ns.model("WorkflowCommentDetail", workflow_comment_detail_fields)
workflow_comment_create_model = console_ns.model("WorkflowCommentCreate", workflow_comment_create_fields)
workflow_comment_update_model = console_ns.model("WorkflowCommentUpdate", workflow_comment_update_fields)
workflow_comment_resolve_model = console_ns.model("WorkflowCommentResolve", workflow_comment_resolve_fields)
workflow_comment_reply_create_model = console_ns.model(
    "WorkflowCommentReplyCreate", workflow_comment_reply_create_fields
)
workflow_comment_reply_update_model = console_ns.model(
    "WorkflowCommentReplyUpdate", workflow_comment_reply_update_fields
)
workflow_comment_mention_users_model = console_ns.model(
    "WorkflowCommentMentionUsers",
    {"users": fields.List(fields.Nested(account_with_role_fields))},
)


@console_ns.route("/apps/<uuid:app_id>/workflow/comments")
class WorkflowCommentListApi(Resource):
    """API for listing and creating workflow comments."""

    @console_ns.doc("list_workflow_comments")
    @console_ns.doc(description="Get all comments for a workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Comments retrieved successfully", workflow_comment_basic_model)
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @marshal_with(workflow_comment_basic_model, envelope="data")
    def get(self, app_model: App):
        """Get all comments for a workflow."""
        comments = WorkflowCommentService.get_comments(tenant_id=current_user.current_tenant_id, app_id=app_model.id)

        return comments

    @console_ns.doc("create_workflow_comment")
    @console_ns.doc(description="Create a new workflow comment")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[WorkflowCommentCreatePayload.__name__])
    @console_ns.response(201, "Comment created successfully", workflow_comment_create_model)
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @marshal_with(workflow_comment_create_model)
    def post(self, app_model: App):
        """Create a new workflow comment."""
        payload = WorkflowCommentCreatePayload.model_validate(console_ns.payload or {})

        result = WorkflowCommentService.create_comment(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            created_by=current_user.id,
            content=payload.content,
            position_x=payload.position_x,
            position_y=payload.position_y,
            mentioned_user_ids=payload.mentioned_user_ids,
        )

        return result, 201


@console_ns.route("/apps/<uuid:app_id>/workflow/comments/<string:comment_id>")
class WorkflowCommentDetailApi(Resource):
    """API for managing individual workflow comments."""

    @console_ns.doc("get_workflow_comment")
    @console_ns.doc(description="Get a specific workflow comment")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID"})
    @console_ns.response(200, "Comment retrieved successfully", workflow_comment_detail_model)
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @marshal_with(workflow_comment_detail_model)
    def get(self, app_model: App, comment_id: str):
        """Get a specific workflow comment."""
        comment = WorkflowCommentService.get_comment(
            tenant_id=current_user.current_tenant_id, app_id=app_model.id, comment_id=comment_id
        )

        return comment

    @console_ns.doc("update_workflow_comment")
    @console_ns.doc(description="Update a workflow comment")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID"})
    @console_ns.expect(console_ns.models[WorkflowCommentUpdatePayload.__name__])
    @console_ns.response(200, "Comment updated successfully", workflow_comment_update_model)
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @marshal_with(workflow_comment_update_model)
    def put(self, app_model: App, comment_id: str):
        """Update a workflow comment."""
        payload = WorkflowCommentUpdatePayload.model_validate(console_ns.payload or {})

        result = WorkflowCommentService.update_comment(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            comment_id=comment_id,
            user_id=current_user.id,
            content=payload.content,
            position_x=payload.position_x,
            position_y=payload.position_y,
            mentioned_user_ids=payload.mentioned_user_ids,
        )

        return result

    @console_ns.doc("delete_workflow_comment")
    @console_ns.doc(description="Delete a workflow comment")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID"})
    @console_ns.response(204, "Comment deleted successfully")
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    def delete(self, app_model: App, comment_id: str):
        """Delete a workflow comment."""
        WorkflowCommentService.delete_comment(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            comment_id=comment_id,
            user_id=current_user.id,
        )

        return {"result": "success"}, 204


@console_ns.route("/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/resolve")
class WorkflowCommentResolveApi(Resource):
    """API for resolving and reopening workflow comments."""

    @console_ns.doc("resolve_workflow_comment")
    @console_ns.doc(description="Resolve a workflow comment")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID"})
    @console_ns.response(200, "Comment resolved successfully", workflow_comment_resolve_model)
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @marshal_with(workflow_comment_resolve_model)
    def post(self, app_model: App, comment_id: str):
        """Resolve a workflow comment."""
        comment = WorkflowCommentService.resolve_comment(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            comment_id=comment_id,
            user_id=current_user.id,
        )

        return comment


@console_ns.route("/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/replies")
class WorkflowCommentReplyApi(Resource):
    """API for managing comment replies."""

    @console_ns.doc("create_workflow_comment_reply")
    @console_ns.doc(description="Add a reply to a workflow comment")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID"})
    @console_ns.expect(console_ns.models[WorkflowCommentReplyCreatePayload.__name__])
    @console_ns.response(201, "Reply created successfully", workflow_comment_reply_create_model)
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @marshal_with(workflow_comment_reply_create_model)
    def post(self, app_model: App, comment_id: str):
        """Add a reply to a workflow comment."""
        # Validate comment access first
        WorkflowCommentService.validate_comment_access(
            comment_id=comment_id, tenant_id=current_user.current_tenant_id, app_id=app_model.id
        )

        payload = WorkflowCommentReplyCreatePayload.model_validate(console_ns.payload or {})

        result = WorkflowCommentService.create_reply(
            comment_id=comment_id,
            content=payload.content,
            created_by=current_user.id,
            mentioned_user_ids=payload.mentioned_user_ids,
        )

        return result, 201


@console_ns.route("/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/replies/<string:reply_id>")
class WorkflowCommentReplyDetailApi(Resource):
    """API for managing individual comment replies."""

    @console_ns.doc("update_workflow_comment_reply")
    @console_ns.doc(description="Update a comment reply")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID", "reply_id": "Reply ID"})
    @console_ns.expect(console_ns.models[WorkflowCommentReplyUpdatePayload.__name__])
    @console_ns.response(200, "Reply updated successfully", workflow_comment_reply_update_model)
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @marshal_with(workflow_comment_reply_update_model)
    def put(self, app_model: App, comment_id: str, reply_id: str):
        """Update a comment reply."""
        # Validate comment access first
        WorkflowCommentService.validate_comment_access(
            comment_id=comment_id, tenant_id=current_user.current_tenant_id, app_id=app_model.id
        )

        payload = WorkflowCommentReplyUpdatePayload.model_validate(console_ns.payload or {})

        reply = WorkflowCommentService.update_reply(
            reply_id=reply_id,
            user_id=current_user.id,
            content=payload.content,
            mentioned_user_ids=payload.mentioned_user_ids,
        )

        return reply

    @console_ns.doc("delete_workflow_comment_reply")
    @console_ns.doc(description="Delete a comment reply")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID", "reply_id": "Reply ID"})
    @console_ns.response(204, "Reply deleted successfully")
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    def delete(self, app_model: App, comment_id: str, reply_id: str):
        """Delete a comment reply."""
        # Validate comment access first
        WorkflowCommentService.validate_comment_access(
            comment_id=comment_id, tenant_id=current_user.current_tenant_id, app_id=app_model.id
        )

        WorkflowCommentService.delete_reply(reply_id=reply_id, user_id=current_user.id)

        return {"result": "success"}, 204


@console_ns.route("/apps/<uuid:app_id>/workflow/comments/mention-users")
class WorkflowCommentMentionUsersApi(Resource):
    """API for getting mentionable users for workflow comments."""

    @console_ns.doc("workflow_comment_mention_users")
    @console_ns.doc(description="Get all users in current tenant for mentions")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Mentionable users retrieved successfully", workflow_comment_mention_users_model)
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @marshal_with(workflow_comment_mention_users_model)
    def get(self, app_model: App):
        """Get all users in current tenant for mentions."""
        members = TenantService.get_tenant_members(current_user.current_tenant)
        return {"users": members}
