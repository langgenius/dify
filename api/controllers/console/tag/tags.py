from typing import Literal

from flask import request
from flask_restx import Resource, marshal_with
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from fields.tag_fields import dataset_tag_fields
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


register_schema_models(
    console_ns,
    TagBasePayload,
    TagBindingPayload,
    TagBindingRemovePayload,
    TagListQueryParam,
)


@console_ns.route("/tags")
class TagListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @console_ns.doc(
        params={"type": 'Tag type filter. Can be "knowledge" or "app".', "keyword": "Search keyword for tag name."}
    )
    @marshal_with(dataset_tag_fields)
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        raw_args = request.args.to_dict()
        param = TagListQueryParam.model_validate(raw_args)
        tags = TagService.get_tags(param.type, current_tenant_id, param.keyword)

        return tags, 200

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
        tag = TagService.save_tags(payload.model_dump())

        response = {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": 0}

        return response, 200


@console_ns.route("/tags/<uuid:tag_id>")
class TagUpdateDeleteApi(Resource):
    @console_ns.expect(console_ns.models[TagBasePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, tag_id):
        current_user, _ = current_account_with_tenant()
        tag_id = str(tag_id)
        # The role of the current user in the ta table must be admin, owner, or editor
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagBasePayload.model_validate(console_ns.payload or {})
        tag = TagService.update_tags(payload.model_dump(), tag_id)

        binding_count = TagService.get_tag_binding_count(tag_id)

        response = {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": binding_count}

        return response, 200

    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def delete(self, tag_id):
        tag_id = str(tag_id)

        TagService.delete_tag(tag_id)

        return 204


@console_ns.route("/tag-bindings/create")
class TagBindingCreateApi(Resource):
    @console_ns.expect(console_ns.models[TagBindingPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, _ = current_account_with_tenant()
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagBindingPayload.model_validate(console_ns.payload or {})
        TagService.save_tag_binding(payload.model_dump())

        return {"result": "success"}, 200


@console_ns.route("/tag-bindings/remove")
class TagBindingDeleteApi(Resource):
    @console_ns.expect(console_ns.models[TagBindingRemovePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, _ = current_account_with_tenant()
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        payload = TagBindingRemovePayload.model_validate(console_ns.payload or {})
        TagService.delete_tag_binding(payload.model_dump())

        return {"result": "success"}, 200
