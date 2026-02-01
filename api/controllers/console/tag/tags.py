from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden

from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from controllers.fastopenapi import console_router
from libs.login import current_account_with_tenant, login_required
from services.tag_service import TagService


class TagBasePayload(BaseModel):
    name: str = Field(description="Tag name", min_length=1, max_length=50)
    type: Literal["knowledge", "app"] | None = Field(default=None, description="Tag type")


class TagBindingPayload(BaseModel):
    tag_ids: list[str] = Field(description="Tag IDs to bind")
    target_id: str = Field(description="Target ID to bind tags to")
    type: Literal["knowledge", "app"] | None = Field(default=None, description="Tag type")


class TagBindingRemovePayload(BaseModel):
    tag_id: str = Field(description="Tag ID to remove")
    target_id: str = Field(description="Target ID to unbind tag from")
    type: Literal["knowledge", "app"] | None = Field(default=None, description="Tag type")


class TagListQueryParam(BaseModel):
    type: Literal["knowledge", "app", ""] = Field("", description="Tag type filter")
    keyword: str | None = Field(None, description="Search keyword")


class TagResponse(BaseModel):
    id: str = Field(description="Tag ID")
    name: str = Field(description="Tag name")
    type: str = Field(description="Tag type")
    binding_count: int = Field(description="Number of bindings")


class TagBindingResult(BaseModel):
    result: Literal["success"] = Field(description="Operation result", examples=["success"])


@console_router.get(
    "/tags",
    response_model=list[TagResponse],
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def list_tags(query: TagListQueryParam) -> list[TagResponse]:
    _, current_tenant_id = current_account_with_tenant()
    tags = TagService.get_tags(query.type, current_tenant_id, query.keyword)

    return [
        TagResponse(
            id=tag.id,
            name=tag.name,
            type=tag.type,
            binding_count=int(tag.binding_count),
        )
        for tag in tags
    ]


@console_router.post(
    "/tags",
    response_model=TagResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def create_tag(payload: TagBasePayload) -> TagResponse:
    current_user, _ = current_account_with_tenant()
    # The role of the current user in the tag table must be admin, owner, or editor
    if not (current_user.has_edit_permission or current_user.is_dataset_editor):
        raise Forbidden()

    tag = TagService.save_tags(payload.model_dump())

    return TagResponse(id=tag.id, name=tag.name, type=tag.type, binding_count=0)


@console_router.patch(
    "/tags/<uuid:tag_id>",
    response_model=TagResponse,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def update_tag(tag_id: UUID, payload: TagBasePayload) -> TagResponse:
    current_user, _ = current_account_with_tenant()
    tag_id_str = str(tag_id)
    # The role of the current user in the ta table must be admin, owner, or editor
    if not (current_user.has_edit_permission or current_user.is_dataset_editor):
        raise Forbidden()

    tag = TagService.update_tags(payload.model_dump(), tag_id_str)

    binding_count = TagService.get_tag_binding_count(tag_id_str)

    return TagResponse(id=tag.id, name=tag.name, type=tag.type, binding_count=binding_count)


@console_router.delete(
    "/tags/<uuid:tag_id>",
    tags=["console"],
    status_code=204,
)
@setup_required
@login_required
@account_initialization_required
@edit_permission_required
def delete_tag(tag_id: UUID) -> None:
    tag_id_str = str(tag_id)

    TagService.delete_tag(tag_id_str)


@console_router.post(
    "/tag-bindings/create",
    response_model=TagBindingResult,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def create_tag_binding(payload: TagBindingPayload) -> TagBindingResult:
    current_user, _ = current_account_with_tenant()
    # The role of the current user in the tag table must be admin, owner, editor, or dataset_operator
    if not (current_user.has_edit_permission or current_user.is_dataset_editor):
        raise Forbidden()

    TagService.save_tag_binding(payload.model_dump())

    return TagBindingResult(result="success")


@console_router.post(
    "/tag-bindings/remove",
    response_model=TagBindingResult,
    tags=["console"],
)
@setup_required
@login_required
@account_initialization_required
def delete_tag_binding(payload: TagBindingRemovePayload) -> TagBindingResult:
    current_user, _ = current_account_with_tenant()
    # The role of the current user in the tag table must be admin, owner, editor, or dataset_operator
    if not (current_user.has_edit_permission or current_user.is_dataset_editor):
        raise Forbidden()

    TagService.delete_tag_binding(payload.model_dump())

    return TagBindingResult(result="success")
