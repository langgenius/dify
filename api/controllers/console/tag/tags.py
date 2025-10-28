from flask import request
from flask_restx import Resource, marshal_with, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from fields.tag_fields import dataset_tag_fields
from libs.login import current_account_with_tenant, login_required
from models.model import Tag
from services.tag_service import TagService


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 50:
        raise ValueError("Name must be between 1 to 50 characters.")
    return name


@console_ns.route("/tags")
class TagListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(dataset_tag_fields)
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        tag_type = request.args.get("type", type=str, default="")
        keyword = request.args.get("keyword", default=None, type=str)
        tags = TagService.get_tags(tag_type, current_tenant_id, keyword)

        return tags, 200

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, _ = current_account_with_tenant()
        # The role of the current user in the ta table must be admin, owner, or editor
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument(
                "name",
                nullable=False,
                required=True,
                help="Name must be between 1 to 50 characters.",
                type=_validate_name,
            )
            .add_argument(
                "type", type=str, location="json", choices=Tag.TAG_TYPE_LIST, nullable=True, help="Invalid tag type."
            )
        )
        args = parser.parse_args()
        tag = TagService.save_tags(args)

        response = {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": 0}

        return response, 200


@console_ns.route("/tags/<uuid:tag_id>")
class TagUpdateDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, tag_id):
        current_user, _ = current_account_with_tenant()
        tag_id = str(tag_id)
        # The role of the current user in the ta table must be admin, owner, or editor
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        parser = reqparse.RequestParser().add_argument(
            "name", nullable=False, required=True, help="Name must be between 1 to 50 characters.", type=_validate_name
        )
        args = parser.parse_args()
        tag = TagService.update_tags(args, tag_id)

        binding_count = TagService.get_tag_binding_count(tag_id)

        response = {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": binding_count}

        return response, 200

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, tag_id):
        current_user, _ = current_account_with_tenant()
        tag_id = str(tag_id)
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.has_edit_permission:
            raise Forbidden()

        TagService.delete_tag(tag_id)

        return 204


@console_ns.route("/tag-bindings/create")
class TagBindingCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, _ = current_account_with_tenant()
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument(
                "tag_ids", type=list, nullable=False, required=True, location="json", help="Tag IDs is required."
            )
            .add_argument(
                "target_id", type=str, nullable=False, required=True, location="json", help="Target ID is required."
            )
            .add_argument(
                "type", type=str, location="json", choices=Tag.TAG_TYPE_LIST, nullable=True, help="Invalid tag type."
            )
        )
        args = parser.parse_args()
        TagService.save_tag_binding(args)

        return {"result": "success"}, 200


@console_ns.route("/tag-bindings/remove")
class TagBindingDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        current_user, _ = current_account_with_tenant()
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        if not (current_user.has_edit_permission or current_user.is_dataset_editor):
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("tag_id", type=str, nullable=False, required=True, help="Tag ID is required.")
            .add_argument("target_id", type=str, nullable=False, required=True, help="Target ID is required.")
            .add_argument(
                "type", type=str, location="json", choices=Tag.TAG_TYPE_LIST, nullable=True, help="Invalid tag type."
            )
        )
        args = parser.parse_args()
        TagService.delete_tag_binding(args)

        return {"result": "success"}, 200
