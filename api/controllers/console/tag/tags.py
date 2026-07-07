from typing import Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, RootModel, field_validator
from sqlalchemy import select
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.common.wraps import enforce_rbac_access
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import current_account_with_tenant, login_required
from models import Account
from models.enums import TagType
from models.model import Tag
from services.tag_service import (
    SaveTagPayload,
    TagBindingCreatePayload,
    TagBindingDeletePayload,
    TagService,
    UpdateTagPayload,
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


class TagBindingRemovePayload(BaseModel):
    tag_ids: list[str] = Field(description="Tag IDs to remove", min_length=1)
    target_id: str = Field(description="Target ID to unbind tag from")
    type: TagType = Field(description="Tag type")


class TagListQueryParam(BaseModel):
    type: Literal["knowledge", "app", "snippet", ""] = Field("", description="Tag type filter")
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


def _enforce_snippet_tag_rbac_if_needed(tag_type: TagType | str | None) -> None:
    if tag_type != TagType.SNIPPET:
        return
    if not dify_config.RBAC_ENABLED:
        return

    current_user, current_tenant_id = current_account_with_tenant()
    enforce_rbac_access(
        tenant_id=current_tenant_id,
        account_id=current_user.id,
        resource_type=RBACResourceScope.WORKSPACE,
        scene=RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
        resource_required=False,
    )


def _enforce_snippet_tag_rbac_by_tag_id(tag_id: str) -> None:
    if not dify_config.RBAC_ENABLED:
        return

    _, current_tenant_id = current_account_with_tenant()
    tag_type = db.session.scalar(select(Tag.type).where(Tag.id == tag_id, Tag.tenant_id == current_tenant_id).limit(1))
    _enforce_snippet_tag_rbac_if_needed(tag_type)


@console_ns.route("/tags")
class TagListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.doc(params=query_params_from_model(TagListQueryParam))
    @console_ns.response(200, "Success", console_ns.models[TagListResponse.__name__])
    @with_current_tenant_id
    def get(self, current_tenant_id: str):
        raw_args = request.args.to_dict()
        param = TagListQueryParam.model_validate(raw_args)
        tags = TagService.get_tags(db.session(), param.type, current_tenant_id, param.keyword)

        return dump_response(TagListResponse, tags), 200

    @console_ns.expect(console_ns.models[TagBasePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[TagResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def post(self, current_user: Account):
        # Allow users with edit permission, or dataset editors (including dataset operators).
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagBasePayload.model_validate(console_ns.payload or {})
        _enforce_snippet_tag_rbac_if_needed(payload.type)
        tag = TagService.save_tags(SaveTagPayload(name=payload.name, type=payload.type), db.session)

        return dump_response(TagResponse, {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": 0}), 200


@console_ns.route("/tags/<uuid:tag_id>")
class TagUpdateDeleteApi(Resource):
    @console_ns.expect(console_ns.models[TagUpdateRequestPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[TagResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def patch(self, current_user: Account, tag_id: UUID):
        tag_id_str = str(tag_id)
        # The role of the current user in the ta table must be admin, owner, or editor
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagUpdateRequestPayload.model_validate(console_ns.payload or {})
        _enforce_snippet_tag_rbac_by_tag_id(tag_id_str)
        tag = TagService.update_tags(UpdateTagPayload(name=payload.name), tag_id_str, db.session)

        binding_count = TagService.get_tag_binding_count(tag_id_str, db.session)

        return (
            dump_response(
                TagResponse,
                {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": binding_count},
            ),
            200,
        )

    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @console_ns.response(204, "Tag deleted successfully")
    def delete(self, tag_id: UUID):
        tag_id_str = str(tag_id)

        _enforce_snippet_tag_rbac_by_tag_id(tag_id_str)
        TagService.delete_tag(tag_id_str, db.session)

        return "", 204


def _require_tag_binding_edit_permission(current_user: Account) -> None:
    """
    Ensure the current account can edit tag bindings.

    Tag binding operations are allowed for users who can edit resources (app/dataset) within the current tenant.
    """
    # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
    if not (current_user.has_edit_permission or current_user.is_dataset_editor):
        raise Forbidden()


def _create_tag_bindings(current_user: Account) -> tuple[dict[str, str], int]:
    _require_tag_binding_edit_permission(current_user)

    payload = TagBindingPayload.model_validate(console_ns.payload or {})
    _enforce_snippet_tag_rbac_if_needed(payload.type)
    TagService.save_tag_binding(
        TagBindingCreatePayload(
            tag_ids=payload.tag_ids,
            target_id=payload.target_id,
            type=payload.type,
        ),
        db.session,
    )
    return {"result": "success"}, 200


def _remove_tag_bindings(current_user: Account) -> tuple[dict[str, str], int]:
    _require_tag_binding_edit_permission(current_user)

    payload = TagBindingRemovePayload.model_validate(console_ns.payload or {})
    _enforce_snippet_tag_rbac_if_needed(payload.type)
    TagService.delete_tag_binding(
        TagBindingDeletePayload(
            tag_ids=payload.tag_ids,
            target_id=payload.target_id,
            type=payload.type,
        ),
        db.session,
    )
    return {"result": "success"}, 200


@console_ns.route("/tag-bindings")
class TagBindingCollectionApi(Resource):
    """Canonical collection resource for tag binding creation."""

    @console_ns.doc("create_tag_binding")
    @console_ns.expect(console_ns.models[TagBindingPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def post(self, current_user: Account):
        return _create_tag_bindings(current_user)


@console_ns.route("/tag-bindings/remove")
class TagBindingRemoveApi(Resource):
    """Batch resource for tag binding deletion."""

    @console_ns.doc("remove_tag_bindings")
    @console_ns.doc(description="Remove one or more tag bindings from a target.")
    @console_ns.expect(console_ns.models[TagBindingRemovePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    def post(self, current_user: Account):
        return _remove_tag_bindings(current_user)
