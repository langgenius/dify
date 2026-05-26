import logging
from datetime import datetime

from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter, computed_field, field_validator

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from fields.base import ResponseModel
from fields.member_fields import AccountWithRole
from libs.helper import build_avatar_url, dump_response, to_timestamp
from libs.login import current_user, login_required
from models import App
from services.account_service import TenantService
from services.workflow_comment_service import WorkflowCommentService

logger = logging.getLogger(__name__)


class WorkflowCommentCreatePayload(BaseModel):
    content: str = Field(..., description="Comment content")
    position_x: float = Field(..., description="Comment X position")
    position_y: float = Field(..., description="Comment Y position")
    mentioned_user_ids: list[str] = Field(default_factory=list, description="Mentioned user IDs")


class WorkflowCommentUpdatePayload(BaseModel):
    content: str = Field(..., description="Comment content")
    position_x: float | None = Field(default=None, description="Comment X position")
    position_y: float | None = Field(default=None, description="Comment Y position")
    mentioned_user_ids: list[str] | None = Field(
        default=None,
        description="Mentioned user IDs. Omit to keep existing mentions.",
    )


class WorkflowCommentReplyPayload(BaseModel):
    content: str = Field(..., description="Reply content")
    mentioned_user_ids: list[str] = Field(default_factory=list, description="Mentioned user IDs")


class WorkflowCommentMentionUsersPayload(BaseModel):
    users: list[AccountWithRole]


class WorkflowCommentAccount(ResponseModel):
    id: str
    name: str
    email: str
    avatar: str | None = Field(default=None, exclude=True)

    @computed_field(return_type=str | None)  # type: ignore[prop-decorator]
    @property
    def avatar_url(self) -> str | None:
        return build_avatar_url(self.avatar)


class WorkflowCommentReply(ResponseModel):
    id: str
    content: str
    created_by: str
    created_by_account: WorkflowCommentAccount | None = None
    created_at: int | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowCommentMention(ResponseModel):
    mentioned_user_id: str
    mentioned_user_account: WorkflowCommentAccount | None = None
    reply_id: str | None = None


class WorkflowCommentBasic(ResponseModel):
    id: str
    position_x: float
    position_y: float
    content: str
    created_by: str
    created_by_account: WorkflowCommentAccount | None = None
    created_at: int | None = None
    updated_at: int | None = None
    resolved: bool
    resolved_at: int | None = None
    resolved_by: str | None = None
    resolved_by_account: WorkflowCommentAccount | None = None
    reply_count: int
    mention_count: int
    participants: list[WorkflowCommentAccount]

    @field_validator("created_at", "updated_at", "resolved_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowCommentBasicList(ResponseModel):
    data: list[WorkflowCommentBasic]


class WorkflowCommentDetail(ResponseModel):
    id: str
    position_x: float
    position_y: float
    content: str
    created_by: str
    created_by_account: WorkflowCommentAccount | None = None
    created_at: int | None = None
    updated_at: int | None = None
    resolved: bool
    resolved_at: int | None = None
    resolved_by: str | None = None
    resolved_by_account: WorkflowCommentAccount | None = None
    replies: list[WorkflowCommentReply]
    mentions: list[WorkflowCommentMention]

    @field_validator("created_at", "updated_at", "resolved_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowCommentCreate(ResponseModel):
    id: str
    created_at: int | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowCommentUpdate(ResponseModel):
    id: str
    updated_at: int | None = None

    @field_validator("updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowCommentResolve(ResponseModel):
    id: str
    resolved: bool
    resolved_at: int | None = None
    resolved_by: str | None = None

    @field_validator("resolved_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowCommentReplyCreate(ResponseModel):
    id: str
    created_at: int | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowCommentReplyUpdate(ResponseModel):
    id: str
    updated_at: int | None = None

    @field_validator("updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


register_schema_models(
    console_ns,
    AccountWithRole,
    WorkflowCommentMentionUsersPayload,
    WorkflowCommentCreatePayload,
    WorkflowCommentUpdatePayload,
    WorkflowCommentReplyPayload,
)
register_response_schema_models(
    console_ns,
    WorkflowCommentAccount,
    WorkflowCommentReply,
    WorkflowCommentMention,
    WorkflowCommentBasic,
    WorkflowCommentBasicList,
    WorkflowCommentDetail,
    WorkflowCommentCreate,
    WorkflowCommentUpdate,
    WorkflowCommentResolve,
    WorkflowCommentReplyCreate,
    WorkflowCommentReplyUpdate,
)


@console_ns.route("/apps/<uuid:app_id>/workflow/comments")
class WorkflowCommentListApi(Resource):
    """API for listing and creating workflow comments."""

    @console_ns.doc("list_workflow_comments")
    @console_ns.doc(description="Get all comments for a workflow")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Comments retrieved successfully", console_ns.models[WorkflowCommentBasicList.__name__])
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    def get(self, app_model: App):
        """Get all comments for a workflow."""
        comments = WorkflowCommentService.get_comments(tenant_id=current_user.current_tenant_id, app_id=app_model.id)

        return WorkflowCommentBasicList.model_validate({"data": comments}).model_dump(mode="json")

    @console_ns.doc("create_workflow_comment")
    @console_ns.doc(description="Create a new workflow comment")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[WorkflowCommentCreatePayload.__name__])
    @console_ns.response(201, "Comment created successfully", console_ns.models[WorkflowCommentCreate.__name__])
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @edit_permission_required
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

        return dump_response(WorkflowCommentCreate, result), 201


@console_ns.route("/apps/<uuid:app_id>/workflow/comments/<string:comment_id>")
class WorkflowCommentDetailApi(Resource):
    """API for managing individual workflow comments."""

    @console_ns.doc("get_workflow_comment")
    @console_ns.doc(description="Get a specific workflow comment")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID"})
    @console_ns.response(200, "Comment retrieved successfully", console_ns.models[WorkflowCommentDetail.__name__])
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    def get(self, app_model: App, comment_id: str):
        """Get a specific workflow comment."""
        comment = WorkflowCommentService.get_comment(
            tenant_id=current_user.current_tenant_id, app_id=app_model.id, comment_id=comment_id
        )

        return dump_response(WorkflowCommentDetail, comment)

    @console_ns.doc("update_workflow_comment")
    @console_ns.doc(description="Update a workflow comment")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID"})
    @console_ns.expect(console_ns.models[WorkflowCommentUpdatePayload.__name__])
    @console_ns.response(200, "Comment updated successfully", console_ns.models[WorkflowCommentUpdate.__name__])
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @edit_permission_required
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

        return dump_response(WorkflowCommentUpdate, result)

    @console_ns.doc("delete_workflow_comment")
    @console_ns.doc(description="Delete a workflow comment")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID"})
    @console_ns.response(204, "Comment deleted successfully")
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @edit_permission_required
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
    @console_ns.response(200, "Comment resolved successfully", console_ns.models[WorkflowCommentResolve.__name__])
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @edit_permission_required
    def post(self, app_model: App, comment_id: str):
        """Resolve a workflow comment."""
        comment = WorkflowCommentService.resolve_comment(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            comment_id=comment_id,
            user_id=current_user.id,
        )

        return dump_response(WorkflowCommentResolve, comment)


@console_ns.route("/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/replies")
class WorkflowCommentReplyApi(Resource):
    """API for managing comment replies."""

    @console_ns.doc("create_workflow_comment_reply")
    @console_ns.doc(description="Add a reply to a workflow comment")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID"})
    @console_ns.expect(console_ns.models[WorkflowCommentReplyPayload.__name__])
    @console_ns.response(201, "Reply created successfully", console_ns.models[WorkflowCommentReplyCreate.__name__])
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @edit_permission_required
    def post(self, app_model: App, comment_id: str):
        """Add a reply to a workflow comment."""
        # Validate comment access first
        WorkflowCommentService.validate_comment_access(
            comment_id=comment_id, tenant_id=current_user.current_tenant_id, app_id=app_model.id
        )

        payload = WorkflowCommentReplyPayload.model_validate(console_ns.payload or {})

        result = WorkflowCommentService.create_reply(
            comment_id=comment_id,
            content=payload.content,
            created_by=current_user.id,
            mentioned_user_ids=payload.mentioned_user_ids,
        )

        return dump_response(WorkflowCommentReplyCreate, result), 201


@console_ns.route("/apps/<uuid:app_id>/workflow/comments/<string:comment_id>/replies/<string:reply_id>")
class WorkflowCommentReplyDetailApi(Resource):
    """API for managing individual comment replies."""

    @console_ns.doc("update_workflow_comment_reply")
    @console_ns.doc(description="Update a comment reply")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID", "reply_id": "Reply ID"})
    @console_ns.expect(console_ns.models[WorkflowCommentReplyPayload.__name__])
    @console_ns.response(200, "Reply updated successfully", console_ns.models[WorkflowCommentReplyUpdate.__name__])
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @edit_permission_required
    def put(self, app_model: App, comment_id: str, reply_id: str):
        """Update a comment reply."""
        # Validate comment access first
        WorkflowCommentService.validate_comment_access(
            comment_id=comment_id, tenant_id=current_user.current_tenant_id, app_id=app_model.id
        )

        payload = WorkflowCommentReplyPayload.model_validate(console_ns.payload or {})

        reply = WorkflowCommentService.update_reply(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            comment_id=comment_id,
            reply_id=reply_id,
            user_id=current_user.id,
            content=payload.content,
            mentioned_user_ids=payload.mentioned_user_ids,
        )

        return dump_response(WorkflowCommentReplyUpdate, reply)

    @console_ns.doc("delete_workflow_comment_reply")
    @console_ns.doc(description="Delete a comment reply")
    @console_ns.doc(params={"app_id": "Application ID", "comment_id": "Comment ID", "reply_id": "Reply ID"})
    @console_ns.response(204, "Reply deleted successfully")
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    @edit_permission_required
    def delete(self, app_model: App, comment_id: str, reply_id: str):
        """Delete a comment reply."""
        # Validate comment access first
        WorkflowCommentService.validate_comment_access(
            comment_id=comment_id, tenant_id=current_user.current_tenant_id, app_id=app_model.id
        )

        WorkflowCommentService.delete_reply(
            tenant_id=current_user.current_tenant_id,
            app_id=app_model.id,
            comment_id=comment_id,
            reply_id=reply_id,
            user_id=current_user.id,
        )

        return {"result": "success"}, 204


@console_ns.route("/apps/<uuid:app_id>/workflow/comments/mention-users")
class WorkflowCommentMentionUsersApi(Resource):
    """API for getting mentionable users for workflow comments."""

    @console_ns.doc("workflow_comment_mention_users")
    @console_ns.doc(description="Get all users in current tenant for mentions")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200, "Mentionable users retrieved successfully", console_ns.models[WorkflowCommentMentionUsersPayload.__name__]
    )
    @login_required
    @setup_required
    @account_initialization_required
    @get_app_model()
    def get(self, app_model: App):
        """Get all users in current tenant for mentions."""
        members = TenantService.get_tenant_members(current_user.current_tenant)
        users = TypeAdapter(list[AccountWithRole]).validate_python(members, from_attributes=True)
        response = WorkflowCommentMentionUsersPayload(users=users)
        return response.model_dump(mode="json"), 200
