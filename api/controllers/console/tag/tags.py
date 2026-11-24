from typing import Self
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, RootModel, field_validator, model_validator
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import AgentId, RBACCheck, Workspace, enforce_rbac_checks
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import current_account_with_tenant
from machinery.context import RequestContext
from models.enums import TagType
from services.tag_application_service import (
    CreateTagInput,
    TagBindingInput,
    TagBindingTargetNotFoundError,
    TagKind,
    TagNameConflictError,
    TagNotFoundError,
    UpdateTagInput,
)


class TagBasePayload(BaseModel):
    name: str = Field(description="Tag name", min_length=1, max_length=50)
    type: TagType = Field(description="Tag type")


class TagUpdateRequestPayload(BaseModel):
    name: str = Field(description="Tag name", min_length=1, max_length=50)


class TagBindingPayload(BaseModel):
    tag_ids: list[str] = Field(description="Tag IDs to bind")
    target_id: str = Field(description="Target ID to bind tags to")
    type: TagType = Field(description="Tag type")

    @model_validator(mode="after")
    def validate_agent_ids(self) -> Self:
        """Normalize validated Agent UUIDs before authorization or SQL; keep other pools' wire behavior."""
        if self.type == TagType.AGENT:
            self.target_id = str(UUID(self.target_id))
            self.tag_ids = [str(UUID(tag_id)) for tag_id in self.tag_ids]
        return self


class TagBindingRemovePayload(BaseModel):
    tag_ids: list[str] = Field(description="Tag IDs to remove", min_length=1)
    target_id: str = Field(description="Target ID to unbind tag from")
    type: TagType = Field(description="Tag type")

    @model_validator(mode="after")
    def validate_agent_ids(self) -> Self:
        """Reject malformed Agent UUIDs before unbinding; other tag pools retain their existing contract."""
        if self.type == TagType.AGENT:
            self.target_id = str(UUID(self.target_id))
            self.tag_ids = [str(UUID(tag_id)) for tag_id in self.tag_ids]
        return self


class TagListQueryParam(BaseModel):
    type: TagType = Field(description="Tag type filter")
    keyword: str | None = Field(None, description="Search keyword")


class TagResponse(ResponseModel):
    id: str
    name: str
    type: str | None = None
    binding_count: str | None = None

    @field_validator("type", mode="before")
    @classmethod
    def normalize_type(cls, value: TagType | str | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, TagType):
            return value.value
        return value

    @field_validator("binding_count", mode="before")
    @classmethod
    def normalize_binding_count(cls, value: int | str | None) -> str | None:
        if value is None:
            return None
        return str(value)


class TagListResponse(RootModel[list[TagResponse]]):
    pass


register_schema_models(
    console_ns,
    TagBasePayload,
    TagUpdateRequestPayload,
    TagBindingPayload,
    TagBindingRemovePayload,
    TagListQueryParam,
)
register_response_schema_models(console_ns, SimpleResultResponse, TagResponse, TagListResponse)


def _enforce_snippet_tag_rbac_if_needed(tag_type: TagType | str | None, context: RequestContext) -> None:
    if tag_type != TagType.SNIPPET:
        return
    if not dify_config.RBAC_ENABLED:
        return

    enforce_rbac_checks(
        tenant_id=context.active_workspace_id,
        account_id=context.account_id,
        checks=[RBACCheck(RBACPermission.SNIPPETS_CREATE_AND_MODIFY, Workspace())],
    )


def _require_tag_edit_permission(*, allow_dataset_editor: bool) -> None:
    current_user, _ = current_account_with_tenant()
    if current_user.has_edit_permission:
        return
    if allow_dataset_editor and current_user.is_dataset_editor:
        return
    raise Forbidden()


def _require_tag_management_permission(
    context: RequestContext, tag_type: TagType | str | None, *, allow_dataset_editor: bool
) -> None:
    """Authorize a tag pool without coupling custom Agent roles to legacy roles.

    Preconditions: context is an admitted account and tag_type is tenant-resolved
    or request-validated. Postconditions: Agent mutations require workspace tag
    management under RBAC, or a legacy edit role otherwise; other pools retain
    their existing gates. Denial raises Forbidden before a mutation is called.
    """
    if tag_type == TagType.AGENT and dify_config.RBAC_ENABLED:
        enforce_rbac_checks(
            tenant_id=context.active_workspace_id,
            account_id=context.account_id,
            checks=[RBACCheck(RBACPermission.AGENT_TAG_MANAGE, Workspace())],
        )
    else:
        _require_tag_edit_permission(allow_dataset_editor=allow_dataset_editor and tag_type != TagType.AGENT)
        _enforce_snippet_tag_rbac_if_needed(tag_type, context)


def _require_tag_management_by_id(context: RequestContext, tag_id: str, *, allow_dataset_editor: bool) -> None:
    """Resolve a tag's tenant-owned pool and authorize its mutation.

    Preconditions: tag_id is path-validated. Postconditions: callers cannot choose
    another pool's permission by changing a payload; legacy role denials happen
    before any lookup when RBAC is disabled. No persistent state is changed.
    """
    if not dify_config.RBAC_ENABLED:
        _require_tag_edit_permission(allow_dataset_editor=allow_dataset_editor)
    tag_type = application_services().tags.get_tag_type(context, tag_id)
    _require_tag_management_permission(context, tag_type, allow_dataset_editor=allow_dataset_editor)


def _require_binding_permission(context: RequestContext, payload: TagBindingPayload | TagBindingRemovePayload) -> None:
    """Authorize editing the target without granting it through tag management.

    Preconditions: payload and account context are validated. Postconditions:
    Agent bindings require that Agent's edit permission, or a legacy edit role
    when RBAC is disabled; other pools preserve their previous policy. No write
    is attempted after a permission denial.
    """
    if payload.type == TagType.AGENT:
        if dify_config.RBAC_ENABLED:
            enforce_rbac_checks(
                tenant_id=context.active_workspace_id,
                account_id=context.account_id,
                checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())],
                path_args={"agent_id": payload.target_id},
            )
        else:
            _require_tag_edit_permission(allow_dataset_editor=False)
    else:
        _require_tag_binding_edit_permission()
        _enforce_snippet_tag_rbac_if_needed(payload.type, context)


@console_ns.route("/tags")
class TagListApi(Resource):
    @console_ns.doc(params=query_params_from_model(TagListQueryParam))
    @console_ns.response(200, "Success", console_ns.models[TagListResponse.__name__])
    @console_account_admission()
    @model_validate(TagListQueryParam)
    def get(self, req_data: TagListQueryParam, request_context: RequestContext):
        tags = application_services().tags.list_tags(request_context, req_data.type, req_data.keyword)

        return dump_response(TagListResponse, tags), 200

    @console_ns.expect(console_ns.models[TagBasePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[TagResponse.__name__])
    @console_account_admission()
    @model_validate(TagBasePayload)
    def post(self, req_data: TagBasePayload, request_context: RequestContext):
        """Create a validated tag only after authorization for its pool; conflicts preserve existing tags."""
        _require_tag_management_permission(request_context, req_data.type, allow_dataset_editor=True)
        try:
            tag = application_services().tags.create_tag(
                request_context,
                CreateTagInput(name=req_data.name, type=TagKind(req_data.type.value)),
            )
        except TagNameConflictError as error:
            raise ValueError(str(error)) from None

        return dump_response(TagResponse, tag), 200


@console_ns.route("/tags/<uuid:tag_id>")
class TagUpdateDeleteApi(Resource):
    @console_ns.expect(console_ns.models[TagUpdateRequestPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[TagResponse.__name__])
    @console_account_admission()
    @model_validate(TagUpdateRequestPayload)
    def patch(self, req_data: TagUpdateRequestPayload, request_context: RequestContext, tag_id: UUID):
        """Rename a tenant-owned tag after pool authorization; a missing tag is a 404 without writes."""
        tag_id_str = str(tag_id)
        _require_tag_management_by_id(request_context, tag_id_str, allow_dataset_editor=True)
        try:
            tag = application_services().tags.update_tag(
                request_context,
                tag_id_str,
                UpdateTagInput(name=req_data.name),
            )
        except TagNameConflictError as error:
            raise ValueError(str(error)) from None
        except TagNotFoundError as error:
            raise NotFound(str(error)) from None

        return dump_response(TagResponse, tag), 200

    @console_ns.response(204, "Tag deleted successfully")
    @console_account_admission()
    def delete(self, request_context: RequestContext, tag_id: UUID):
        """Delete an authorized tenant-owned tag and its bindings; other tag pools remain independent."""
        tag_id_str = str(tag_id)
        _require_tag_management_by_id(request_context, tag_id_str, allow_dataset_editor=False)
        try:
            application_services().tags.delete_tag(request_context, tag_id_str)
        except TagNotFoundError as error:
            raise NotFound(str(error)) from None

        return "", 204


def _require_tag_binding_edit_permission() -> None:
    """
    Ensure the current account can edit tag bindings.

    Tag binding operations are allowed for users who can edit resources (app/dataset) within the current tenant.
    """
    # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
    _require_tag_edit_permission(allow_dataset_editor=True)


def _create_tag_bindings(context: RequestContext, payload: TagBindingPayload) -> tuple[dict[str, str], int]:
    """Bind validated tenant tags after target authorization; an unavailable target is a 404 without writes."""
    _require_binding_permission(context, payload)
    try:
        application_services().tags.create_bindings(
            context,
            TagBindingInput(
                tag_ids=tuple(payload.tag_ids),
                target_id=payload.target_id,
                type=TagKind(payload.type.value),
            ),
        )
    except TagBindingTargetNotFoundError as error:
        raise NotFound(str(error)) from None
    return {"result": "success"}, 200


def _remove_tag_bindings(context: RequestContext, payload: TagBindingRemovePayload) -> tuple[dict[str, str], int]:
    """Remove authorized target bindings without deleting shared tags or changing other targets."""
    _require_binding_permission(context, payload)
    try:
        application_services().tags.delete_bindings(
            context,
            TagBindingInput(
                tag_ids=tuple(payload.tag_ids),
                target_id=payload.target_id,
                type=TagKind(payload.type.value),
            ),
        )
    except TagBindingTargetNotFoundError as error:
        raise NotFound(str(error)) from None
    return {"result": "success"}, 200


@console_ns.route("/tag-bindings")
class TagBindingCollectionApi(Resource):
    """Canonical collection resource for tag binding creation."""

    @console_ns.doc("create_tag_binding")
    @console_ns.expect(console_ns.models[TagBindingPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission()
    @model_validate(TagBindingPayload)
    def post(self, req_data: TagBindingPayload, request_context: RequestContext):
        return _create_tag_bindings(request_context, req_data)


@console_ns.route("/tag-bindings/remove")
class TagBindingRemoveApi(Resource):
    """Batch resource for tag binding deletion."""

    @console_ns.doc("remove_tag_bindings")
    @console_ns.doc(description="Remove one or more tag bindings from a target.")
    @console_ns.expect(console_ns.models[TagBindingRemovePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_account_admission()
    @model_validate(TagBindingRemovePayload)
    def post(self, req_data: TagBindingRemovePayload, request_context: RequestContext):
        return _remove_tag_bindings(request_context, req_data)
