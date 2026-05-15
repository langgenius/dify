from typing import Literal

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import Forbidden

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from fields.base import ResponseModel
from libs.login import current_account_with_tenant, login_required
from models.enums import TagType
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
    type: Literal["knowledge", "app", ""] = Field("", description="Tag type filter")
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


register_schema_models(
    console_ns,
    TagBasePayload,
    TagUpdateRequestPayload,
    TagBindingPayload,
    TagBindingRemovePayload,
    TagListQueryParam,
    TagResponse,
)


@console_ns.route("/tags")
class TagListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.doc(
        params={"type": 'Tag type filter. Can be "knowledge" or "app".', "keyword": "Search keyword for tag name."}
    )
    @console_ns.doc(responses={200: ("Success", [console_ns.models[TagResponse.__name__]])})
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        raw_args = request.args.to_dict()
        param = TagListQueryParam.model_validate(raw_args)
        tags = TagService.get_tags(param.type, current_tenant_id, param.keyword)

        serialized_tags = [
            TagResponse.model_validate(tag, from_attributes=True).model_dump(mode="json") for tag in tags
        ]

        return serialized_tags, 200

    @console_ns.expect(console_ns.models[TagBasePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, _ = current_account_with_tenant()
        # The role of the current user in the ta table must be admin, owner, or editor
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagBasePayload.model_validate(console_ns.payload or {})
        tag = TagService.save_tags(SaveTagPayload(name=payload.name, type=payload.type))

        response = TagResponse.model_validate(
            {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": 0}
        ).model_dump(mode="json")

        return response, 200


@console_ns.route("/tags/<uuid:tag_id>")
class TagUpdateDeleteApi(Resource):
    @console_ns.expect(console_ns.models[TagUpdateRequestPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, tag_id):
        current_user, _ = current_account_with_tenant()
        tag_id = str(tag_id)
        # The role of the current user in the ta table must be admin, owner, or editor
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagUpdateRequestPayload.model_validate(console_ns.payload or {})
        tag = TagService.update_tags(UpdateTagPayload(name=payload.name), tag_id)

        binding_count = TagService.get_tag_binding_count(tag_id)

        response = TagResponse.model_validate(
            {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": binding_count}
        ).model_dump(mode="json")

        return response, 200

    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def delete(self, tag_id):
        tag_id = str(tag_id)

        TagService.delete_tag(tag_id)

        return "", 204


def _require_tag_binding_edit_permission() -> None:
    """
    Ensure the current account can edit tag bindings.

    Tag binding operations are allowed for users who can edit resources (app/dataset) within the current tenant.
    """
    current_user, _ = current_account_with_tenant()
    # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
    if not (current_user.has_edit_permission or current_user.is_dataset_editor):
        raise Forbidden()


def _create_tag_bindings() -> tuple[dict[str, str], int]:
    _require_tag_binding_edit_permission()

    payload = TagBindingPayload.model_validate(console_ns.payload or {})
    TagService.save_tag_binding(
        TagBindingCreatePayload(
            tag_ids=payload.tag_ids,
            target_id=payload.target_id,
            type=payload.type,
        )
    )
    return {"result": "success"}, 200


def _remove_tag_bindings() -> tuple[dict[str, str], int]:
    _require_tag_binding_edit_permission()

    payload = TagBindingRemovePayload.model_validate(console_ns.payload or {})
    TagService.delete_tag_binding(
        TagBindingDeletePayload(
            tag_ids=payload.tag_ids,
            target_id=payload.target_id,
            type=payload.type,
        )
    )
    return {"result": "success"}, 200


@console_ns.route("/tag-bindings")
class TagBindingCollectionApi(Resource):
    """Canonical collection resource for tag binding creation."""

    @console_ns.doc("create_tag_binding")
    @console_ns.expect(console_ns.models[TagBindingPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        return _create_tag_bindings()


@console_ns.route("/tag-bindings/remove")
class TagBindingRemoveApi(Resource):
    """Batch resource for tag binding deletion."""

    @console_ns.doc("remove_tag_bindings")
    @console_ns.doc(description="Remove one or more tag bindings from a target.")
    @console_ns.expect(console_ns.models[TagBindingRemovePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        return _remove_tag_bindings()
