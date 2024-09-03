from flask import request
from flask_login import current_user
from flask_restful import Resource, marshal, marshal_with, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.app.error import NoFileUploadedError
from controllers.console.datasets.error import TooManyFilesError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from extensions.ext_redis import redis_client
from fields.annotation_fields import (
    annotation_fields,
    annotation_hit_history_fields,
)
from libs.login import login_required
from services.annotation_service import AppAnnotationService


class AnnotationReplyActionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    def post(self, app_id, action):
        if not current_user.is_editor:
            raise Forbidden()

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


class AppAnnotationSettingDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        if not current_user.is_editor:
            raise Forbidden()

        app_id = str(app_id)
        result = AppAnnotationService.get_app_annotation_setting_by_app_id(app_id)
        return result, 200


class AppAnnotationSettingUpdateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id, annotation_setting_id):
        if not current_user.is_editor:
            raise Forbidden()

        app_id = str(app_id)
        annotation_setting_id = str(annotation_setting_id)

        parser = reqparse.RequestParser()
        parser.add_argument("score_threshold", required=True, type=float, location="json")
        args = parser.parse_args()

        result = AppAnnotationService.update_app_annotation_setting(app_id, annotation_setting_id, args)
        return result, 200


class AnnotationReplyActionStatusApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    def get(self, app_id, job_id, action):
        if not current_user.is_editor:
            raise Forbidden()

        job_id = str(job_id)
        app_annotation_job_key = "{}_app_annotation_job_{}".format(action, str(job_id))
        cache_result = redis_client.get(app_annotation_job_key)
        if cache_result is None:
            raise ValueError("The job is not exist.")

        job_status = cache_result.decode()
        error_msg = ""
        if job_status == "error":
            app_annotation_error_key = "{}_app_annotation_error_{}".format(action, str(job_id))
            error_msg = redis_client.get(app_annotation_error_key).decode()

        return {"job_id": job_id, "job_status": job_status, "error_msg": error_msg}, 200


class AnnotationListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        if not current_user.is_editor:
            raise Forbidden()

        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        keyword = request.args.get("keyword", default=None, type=str)

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


class AnnotationExportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        if not current_user.is_editor:
            raise Forbidden()

        app_id = str(app_id)
        annotation_list = AppAnnotationService.export_annotation_list_by_app_id(app_id)
        response = {"data": marshal(annotation_list, annotation_fields)}
        return response, 200


class AnnotationCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @marshal_with(annotation_fields)
    def post(self, app_id):
        if not current_user.is_editor:
            raise Forbidden()

        app_id = str(app_id)
        parser = reqparse.RequestParser()
        parser.add_argument("question", required=True, type=str, location="json")
        parser.add_argument("answer", required=True, type=str, location="json")
        args = parser.parse_args()
        annotation = AppAnnotationService.insert_app_annotation_directly(args, app_id)
        return annotation


class AnnotationUpdateDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @marshal_with(annotation_fields)
    def post(self, app_id, annotation_id):
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

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, app_id, annotation_id):
        if not current_user.is_editor:
            raise Forbidden()

        app_id = str(app_id)
        annotation_id = str(annotation_id)
        AppAnnotationService.delete_app_annotation(app_id, annotation_id)
        return {"result": "success"}, 200


class AnnotationBatchImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    def post(self, app_id):
        if not current_user.is_editor:
            raise Forbidden()

        app_id = str(app_id)
        # get file from request
        file = request.files["file"]
        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()
        # check file type
        if not file.filename.endswith(".csv"):
            raise ValueError("Invalid file type. Only CSV files are allowed")
        return AppAnnotationService.batch_import_app_annotations(app_id, file)


class AnnotationBatchImportStatusApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    def get(self, app_id, job_id):
        if not current_user.is_editor:
            raise Forbidden()

        job_id = str(job_id)
        indexing_cache_key = "app_annotation_batch_import_{}".format(str(job_id))
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is None:
            raise ValueError("The job is not exist.")
        job_status = cache_result.decode()
        error_msg = ""
        if job_status == "error":
            indexing_error_msg_key = "app_annotation_batch_import_error_msg_{}".format(str(job_id))
            error_msg = redis_client.get(indexing_error_msg_key).decode()

        return {"job_id": job_id, "job_status": job_status, "error_msg": error_msg}, 200


class AnnotationHitHistoryListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id, annotation_id):
        if not current_user.is_editor:
            raise Forbidden()

        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        app_id = str(app_id)
        annotation_id = str(annotation_id)
        annotation_hit_history_list, total = AppAnnotationService.get_annotation_hit_histories(
            app_id, annotation_id, page, limit
        )
        response = {
            "data": marshal(annotation_hit_history_list, annotation_hit_history_fields),
            "has_more": len(annotation_hit_history_list) == limit,
            "limit": limit,
            "total": total,
            "page": page,
        }
        return response


api.add_resource(AnnotationReplyActionApi, "/apps/<uuid:app_id>/annotation-reply/<string:action>")
api.add_resource(
    AnnotationReplyActionStatusApi, "/apps/<uuid:app_id>/annotation-reply/<string:action>/status/<uuid:job_id>"
)
api.add_resource(AnnotationListApi, "/apps/<uuid:app_id>/annotations")
api.add_resource(AnnotationExportApi, "/apps/<uuid:app_id>/annotations/export")
api.add_resource(AnnotationUpdateDeleteApi, "/apps/<uuid:app_id>/annotations/<uuid:annotation_id>")
api.add_resource(AnnotationBatchImportApi, "/apps/<uuid:app_id>/annotations/batch-import")
api.add_resource(AnnotationBatchImportStatusApi, "/apps/<uuid:app_id>/annotations/batch-import-status/<uuid:job_id>")
api.add_resource(AnnotationHitHistoryListApi, "/apps/<uuid:app_id>/annotations/<uuid:annotation_id>/hit-histories")
api.add_resource(AppAnnotationSettingDetailApi, "/apps/<uuid:app_id>/annotation-setting")
api.add_resource(AppAnnotationSettingUpdateApi, "/apps/<uuid:app_id>/annotation-settings/<uuid:annotation_setting_id>")
