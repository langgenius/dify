from flask import request
from flask_login import current_user  # type: ignore
from flask_restful import Resource, marshal_with, reqparse  # type: ignore
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.wraps import account_initialization_required, setup_required
from fields.tag_fields import tag_fields
from libs.login import login_required
from models.model import Tag
from services.tag_service import TagService


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 50:
        raise ValueError("Name must be between 1 to 50 characters.")
    return name


class TagListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(tag_fields)
    def get(self):
        tag_type = request.args.get("type", type=str, default="")
        keyword = request.args.get("keyword", default=None, type=str)
        tags = TagService.get_tags(tag_type, current_user.current_tenant_id, keyword)

        return tags, 200

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        # The role of the current user in the ta table must be admin, owner, or editor
        if not (current_user.is_editor or current_user.is_dataset_editor):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument(
            "name", nullable=False, required=True, help="Name must be between 1 to 50 characters.", type=_validate_name
        )
        parser.add_argument(
            "type", type=str, location="json", choices=Tag.TAG_TYPE_LIST, nullable=True, help="Invalid tag type."
        )
        args = parser.parse_args()
        tag = TagService.save_tags(args)

        response = {"id": tag.id, "name": tag.name, "type": tag.type, "binding_count": 0}

        return response, 200


class TagUpdateDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, tag_id):
        tag_id = str(tag_id)
        # The role of the current user in the ta table must be admin, owner, or editor
        if not (current_user.is_editor or current_user.is_dataset_editor):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument(
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
        tag_id = str(tag_id)
        # The role of the current user in the ta table must be admin, owner, or editor
        if not current_user.is_editor:
            raise Forbidden()

        TagService.delete_tag(tag_id)

        return 200


class TagBindingCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        if not (current_user.is_editor or current_user.is_dataset_editor):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument(
            "tag_ids", type=list, nullable=False, required=True, location="json", help="Tag IDs is required."
        )
        parser.add_argument(
            "target_id", type=str, nullable=False, required=True, location="json", help="Target ID is required."
        )
        parser.add_argument(
            "type", type=str, location="json", choices=Tag.TAG_TYPE_LIST, nullable=True, help="Invalid tag type."
        )
        args = parser.parse_args()
        TagService.save_tag_binding(args)

        return 200


class TagBindingDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        # The role of the current user in the ta table must be admin, owner, editor, or dataset_operator
        if not (current_user.is_editor or current_user.is_dataset_editor):
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("tag_id", type=str, nullable=False, required=True, help="Tag ID is required.")
        parser.add_argument("target_id", type=str, nullable=False, required=True, help="Target ID is required.")
        parser.add_argument(
            "type", type=str, location="json", choices=Tag.TAG_TYPE_LIST, nullable=True, help="Invalid tag type."
        )
        args = parser.parse_args()
        TagService.delete_tag_binding(args)

        return 200


api.add_resource(TagListApi, "/tags")
api.add_resource(TagUpdateDeleteApi, "/tags/<uuid:tag_id>")
api.add_resource(TagBindingCreateApi, "/tag-bindings/create")
api.add_resource(TagBindingDeleteApi, "/tag-bindings/remove")
