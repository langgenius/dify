
from flask import request
from flask_restful import Resource, marshal, marshal_with, reqparse  # type: ignore
from werkzeug.exceptions import Forbidden

from controllers.service_api import api
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from fields.annotation_fields import (
    annotation_fields,
)
from libs.login import current_user
from models.model import App, EndUser
from services.annotation_service import AppAnnotationService


class AnnotationReplyActionApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    def post(self, app_model: App, end_user: EndUser, app_id, action):
        app_id = str(app_id)
        parser = reqparse.RequestParser()
        parser.add_argument("score_threshold", required=True, type=float, location="json")
        parser.add_argument("embedding_provider_name", required=True, type=str, location="json")
        parser.add_argument("embedding_model_name", required=True, type=str, location="json")
        args = parser.parse_args()
        if action == "enable":
            result = AppAnnotationService.enable_app_annotation(args, app_id)
        elif action == "disable":
            result = AppAnnotationService.disable_app_annotation(app_id)
        else:
            raise ValueError("Unsupported annotation reply action")
        return result, 200


class AnnotationListApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def get(self, app_model: App, end_user: EndUser, app_id):
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        keyword = request.args.get("keyword", default="", type=str)

        app_id = str(app_id)
        annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(app_id, page, limit, keyword)
        response = {
            "data": marshal(annotation_list, annotation_fields),
            "has_more": len(annotation_list) == limit,
            "limit": limit,
            "total": total,
            "page": page,
        }
        return response, 200

    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    @marshal_with(annotation_fields)
    def post(self, app_model: App, end_user: EndUser, app_id):
        print(current_user)
        app_id = str(app_id)
        parser = reqparse.RequestParser()
        parser.add_argument("question", required=True, type=str, location="json")
        parser.add_argument("answer", required=True, type=str, location="json")
        args = parser.parse_args()
        annotation = AppAnnotationService.insert_app_annotation_directly(args, app_id)
        return annotation


class AnnotationUpdateDeleteApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    @marshal_with(annotation_fields)
    def post(self, app_model: App, end_user: EndUser, app_id, annotation_id):
        if not current_user.is_editor:
            raise Forbidden()

        app_id = str(app_id)
        annotation_id = str(annotation_id)
        parser = reqparse.RequestParser()
        parser.add_argument("question", required=True, type=str, location="json")
        parser.add_argument("answer", required=True, type=str, location="json")
        args = parser.parse_args()
        annotation = AppAnnotationService.update_app_annotation_directly(args, app_id, annotation_id)
        return annotation

    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def delete(self, app_model: App, end_user: EndUser, app_id, annotation_id):
        if not current_user.is_editor:
            raise Forbidden()

        app_id = str(app_id)
        annotation_id = str(annotation_id)
        AppAnnotationService.delete_app_annotation(app_id, annotation_id)
        return {"result": "success"}, 200


api.add_resource(AnnotationReplyActionApi, "/apps/<uuid:app_id>/annotation-reply/<string:action>")
api.add_resource(AnnotationListApi, "/apps/<uuid:app_id>/annotations")
api.add_resource(AnnotationUpdateDeleteApi, "/apps/<uuid:app_id>/annotations/<uuid:annotation_id>")