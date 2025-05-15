from flask import request
from flask_restful import Resource, marshal, marshal_with, reqparse
from werkzeug.exceptions import Forbidden

from controllers.service_api import api
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from extensions.ext_redis import redis_client
from fields.annotation_fields import (
    annotation_fields,
)
from libs.login import current_user
from models.model import App, EndUser
from services.annotation_service import AppAnnotationService


class AnnotationReplyActionApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    def post(self, app_model: App, end_user: EndUser, action):
        parser = reqparse.RequestParser()
        parser.add_argument("score_threshold", required=True, type=float, location="json")
        parser.add_argument("embedding_provider_name", required=True, type=str, location="json")
        parser.add_argument("embedding_model_name", required=True, type=str, location="json")
        args = parser.parse_args()
        if action == "enable":
            result = AppAnnotationService.enable_app_annotation(args, app_model.id)
        elif action == "disable":
            result = AppAnnotationService.disable_app_annotation(app_model.id)
        else:
            raise ValueError("Unsupported annotation reply action")
        return result, 200


class AnnotationReplyActionStatusApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def get(self, app_model: App, end_user: EndUser, job_id, action):
        job_id = str(job_id)
        app_annotation_job_key = "{}_app_annotation_job_{}".format(action, str(job_id))
        cache_result = redis_client.get(app_annotation_job_key)
        if cache_result is None:
            raise ValueError("The job does not exist.")

        job_status = cache_result.decode()
        error_msg = ""
        if job_status == "error":
            app_annotation_error_key = "{}_app_annotation_error_{}".format(action, str(job_id))
            error_msg = redis_client.get(app_annotation_error_key).decode()

        return {"job_id": job_id, "job_status": job_status, "error_msg": error_msg}, 200


class AnnotationListApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def get(self, app_model: App, end_user: EndUser):
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        keyword = request.args.get("keyword", default="", type=str)

        annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(app_model.id, page, limit, keyword)
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
    def post(self, app_model: App, end_user: EndUser):
        parser = reqparse.RequestParser()
        parser.add_argument("question", required=True, type=str, location="json")
        parser.add_argument("answer", required=True, type=str, location="json")
        args = parser.parse_args()
        annotation = AppAnnotationService.insert_app_annotation_directly(args, app_model.id)
        return annotation


class AnnotationUpdateDeleteApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    @marshal_with(annotation_fields)
    def put(self, app_model: App, end_user: EndUser, annotation_id):
        if not current_user.is_editor:
            raise Forbidden()

        annotation_id = str(annotation_id)
        parser = reqparse.RequestParser()
        parser.add_argument("question", required=True, type=str, location="json")
        parser.add_argument("answer", required=True, type=str, location="json")
        args = parser.parse_args()
        annotation = AppAnnotationService.update_app_annotation_directly(args, app_model.id, annotation_id)
        return annotation

    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def delete(self, app_model: App, end_user: EndUser, annotation_id):
        if not current_user.is_editor:
            raise Forbidden()

        annotation_id = str(annotation_id)
        AppAnnotationService.delete_app_annotation(app_model.id, annotation_id)
        return {"result": "success"}, 204


api.add_resource(AnnotationReplyActionApi, "/apps/annotation-reply/<string:action>")
api.add_resource(AnnotationReplyActionStatusApi, "/apps/annotation-reply/<string:action>/status/<uuid:job_id>")
api.add_resource(AnnotationListApi, "/apps/annotations")
api.add_resource(AnnotationUpdateDeleteApi, "/apps/annotations/<uuid:annotation_id>")
