from typing import Literal

from flask import request
from flask_restx import Resource, fields, marshal, marshal_with, reqparse

from controllers.common.errors import NoFileUploadedError, TooManyFilesError
from controllers.console import api, console_ns
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    edit_permission_required,
    setup_required,
)
from extensions.ext_redis import redis_client
from fields.annotation_fields import (
    annotation_fields,
    annotation_hit_history_fields,
)
from libs.login import login_required
from services.annotation_service import AppAnnotationService


@console_ns.route("/apps/<uuid:app_id>/annotation-reply/<string:action>")
class AnnotationReplyActionApi(Resource):
    @api.doc("annotation_reply_action")
    @api.doc(description="Enable or disable annotation reply for an app")
    @api.doc(params={"app_id": "Application ID", "action": "Action to perform (enable/disable)"})
    @api.expect(
        api.model(
            "AnnotationReplyActionRequest",
            {
                "score_threshold": fields.Float(required=True, description="Score threshold for annotation matching"),
                "embedding_provider_name": fields.String(required=True, description="Embedding provider name"),
                "embedding_model_name": fields.String(required=True, description="Embedding model name"),
            },
        )
    )
    @api.response(200, "Action completed successfully")
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @edit_permission_required
    def post(self, app_id, action: Literal["enable", "disable"]):
        app_id = str(app_id)
        parser = (
            reqparse.RequestParser()
            .add_argument("score_threshold", required=True, type=float, location="json")
            .add_argument("embedding_provider_name", required=True, type=str, location="json")
            .add_argument("embedding_model_name", required=True, type=str, location="json")
        )
        args = parser.parse_args()
        if action == "enable":
            result = AppAnnotationService.enable_app_annotation(args, app_id)
        elif action == "disable":
            result = AppAnnotationService.disable_app_annotation(app_id)
        return result, 200


@console_ns.route("/apps/<uuid:app_id>/annotation-setting")
class AppAnnotationSettingDetailApi(Resource):
    @api.doc("get_annotation_setting")
    @api.doc(description="Get annotation settings for an app")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Annotation settings retrieved successfully")
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, app_id):
        app_id = str(app_id)
        result = AppAnnotationService.get_app_annotation_setting_by_app_id(app_id)
        return result, 200


@console_ns.route("/apps/<uuid:app_id>/annotation-settings/<uuid:annotation_setting_id>")
class AppAnnotationSettingUpdateApi(Resource):
    @api.doc("update_annotation_setting")
    @api.doc(description="Update annotation settings for an app")
    @api.doc(params={"app_id": "Application ID", "annotation_setting_id": "Annotation setting ID"})
    @api.expect(
        api.model(
            "AnnotationSettingUpdateRequest",
            {
                "score_threshold": fields.Float(required=True, description="Score threshold"),
                "embedding_provider_name": fields.String(required=True, description="Embedding provider"),
                "embedding_model_name": fields.String(required=True, description="Embedding model"),
            },
        )
    )
    @api.response(200, "Settings updated successfully")
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, app_id, annotation_setting_id):
        app_id = str(app_id)
        annotation_setting_id = str(annotation_setting_id)

        parser = reqparse.RequestParser().add_argument("score_threshold", required=True, type=float, location="json")
        args = parser.parse_args()

        result = AppAnnotationService.update_app_annotation_setting(app_id, annotation_setting_id, args)
        return result, 200


@console_ns.route("/apps/<uuid:app_id>/annotation-reply/<string:action>/status/<uuid:job_id>")
class AnnotationReplyActionStatusApi(Resource):
    @api.doc("get_annotation_reply_action_status")
    @api.doc(description="Get status of annotation reply action job")
    @api.doc(params={"app_id": "Application ID", "job_id": "Job ID", "action": "Action type"})
    @api.response(200, "Job status retrieved successfully")
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @edit_permission_required
    def get(self, app_id, job_id, action):
        job_id = str(job_id)
        app_annotation_job_key = f"{action}_app_annotation_job_{str(job_id)}"
        cache_result = redis_client.get(app_annotation_job_key)
        if cache_result is None:
            raise ValueError("The job does not exist.")

        job_status = cache_result.decode()
        error_msg = ""
        if job_status == "error":
            app_annotation_error_key = f"{action}_app_annotation_error_{str(job_id)}"
            error_msg = redis_client.get(app_annotation_error_key).decode()

        return {"job_id": job_id, "job_status": job_status, "error_msg": error_msg}, 200


@console_ns.route("/apps/<uuid:app_id>/annotations")
class AnnotationApi(Resource):
    @api.doc("list_annotations")
    @api.doc(description="Get annotations for an app with pagination")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.parser()
        .add_argument("page", type=int, location="args", default=1, help="Page number")
        .add_argument("limit", type=int, location="args", default=20, help="Page size")
        .add_argument("keyword", type=str, location="args", default="", help="Search keyword")
    )
    @api.response(200, "Annotations retrieved successfully")
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, app_id):
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

    @api.doc("create_annotation")
    @api.doc(description="Create a new annotation for an app")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "CreateAnnotationRequest",
            {
                "question": fields.String(required=True, description="Question text"),
                "answer": fields.String(required=True, description="Answer text"),
                "annotation_reply": fields.Raw(description="Annotation reply data"),
            },
        )
    )
    @api.response(201, "Annotation created successfully", annotation_fields)
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @marshal_with(annotation_fields)
    @edit_permission_required
    def post(self, app_id):
        app_id = str(app_id)
        parser = (
            reqparse.RequestParser()
            .add_argument("question", required=True, type=str, location="json")
            .add_argument("answer", required=True, type=str, location="json")
        )
        args = parser.parse_args()
        annotation = AppAnnotationService.insert_app_annotation_directly(args, app_id)
        return annotation

    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def delete(self, app_id):
        app_id = str(app_id)

        # Use request.args.getlist to get annotation_ids array directly
        annotation_ids = request.args.getlist("annotation_id")

        # If annotation_ids are provided, handle batch deletion
        if annotation_ids:
            # Check if any annotation_ids contain empty strings or invalid values
            if not all(annotation_id.strip() for annotation_id in annotation_ids if annotation_id):
                return {
                    "code": "bad_request",
                    "message": "annotation_ids are required if the parameter is provided.",
                }, 400

            result = AppAnnotationService.delete_app_annotations_in_batch(app_id, annotation_ids)
            return result, 204
        # If no annotation_ids are provided, handle clearing all annotations
        else:
            AppAnnotationService.clear_all_annotations(app_id)
            return {"result": "success"}, 204


@console_ns.route("/apps/<uuid:app_id>/annotations/export")
class AnnotationExportApi(Resource):
    @api.doc("export_annotations")
    @api.doc(description="Export all annotations for an app")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Annotations exported successfully", fields.List(fields.Nested(annotation_fields)))
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, app_id):
        app_id = str(app_id)
        annotation_list = AppAnnotationService.export_annotation_list_by_app_id(app_id)
        response = {"data": marshal(annotation_list, annotation_fields)}
        return response, 200


@console_ns.route("/apps/<uuid:app_id>/annotations/<uuid:annotation_id>")
class AnnotationUpdateDeleteApi(Resource):
    @api.doc("update_delete_annotation")
    @api.doc(description="Update or delete an annotation")
    @api.doc(params={"app_id": "Application ID", "annotation_id": "Annotation ID"})
    @api.response(200, "Annotation updated successfully", annotation_fields)
    @api.response(204, "Annotation deleted successfully")
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @edit_permission_required
    @marshal_with(annotation_fields)
    def post(self, app_id, annotation_id):
        app_id = str(app_id)
        annotation_id = str(annotation_id)
        parser = (
            reqparse.RequestParser()
            .add_argument("question", required=True, type=str, location="json")
            .add_argument("answer", required=True, type=str, location="json")
        )
        args = parser.parse_args()
        annotation = AppAnnotationService.update_app_annotation_directly(args, app_id, annotation_id)
        return annotation

    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def delete(self, app_id, annotation_id):
        app_id = str(app_id)
        annotation_id = str(annotation_id)
        AppAnnotationService.delete_app_annotation(app_id, annotation_id)
        return {"result": "success"}, 204


@console_ns.route("/apps/<uuid:app_id>/annotations/batch-import")
class AnnotationBatchImportApi(Resource):
    @api.doc("batch_import_annotations")
    @api.doc(description="Batch import annotations from CSV file")
    @api.doc(params={"app_id": "Application ID"})
    @api.response(200, "Batch import started successfully")
    @api.response(403, "Insufficient permissions")
    @api.response(400, "No file uploaded or too many files")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @edit_permission_required
    def post(self, app_id):
        app_id = str(app_id)
        # check file
        if "file" not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()

        # get file from request
        file = request.files["file"]
        # check file type
        if not file.filename or not file.filename.lower().endswith(".csv"):
            raise ValueError("Invalid file type. Only CSV files are allowed")
        return AppAnnotationService.batch_import_app_annotations(app_id, file)


@console_ns.route("/apps/<uuid:app_id>/annotations/batch-import-status/<uuid:job_id>")
class AnnotationBatchImportStatusApi(Resource):
    @api.doc("get_batch_import_status")
    @api.doc(description="Get status of batch import job")
    @api.doc(params={"app_id": "Application ID", "job_id": "Job ID"})
    @api.response(200, "Job status retrieved successfully")
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @edit_permission_required
    def get(self, app_id, job_id):
        job_id = str(job_id)
        indexing_cache_key = f"app_annotation_batch_import_{str(job_id)}"
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is None:
            raise ValueError("The job does not exist.")
        job_status = cache_result.decode()
        error_msg = ""
        if job_status == "error":
            indexing_error_msg_key = f"app_annotation_batch_import_error_msg_{str(job_id)}"
            error_msg = redis_client.get(indexing_error_msg_key).decode()

        return {"job_id": job_id, "job_status": job_status, "error_msg": error_msg}, 200


@console_ns.route("/apps/<uuid:app_id>/annotations/<uuid:annotation_id>/hit-histories")
class AnnotationHitHistoryListApi(Resource):
    @api.doc("list_annotation_hit_histories")
    @api.doc(description="Get hit histories for an annotation")
    @api.doc(params={"app_id": "Application ID", "annotation_id": "Annotation ID"})
    @api.expect(
        api.parser()
        .add_argument("page", type=int, location="args", default=1, help="Page number")
        .add_argument("limit", type=int, location="args", default=20, help="Page size")
    )
    @api.response(
        200, "Hit histories retrieved successfully", fields.List(fields.Nested(annotation_hit_history_fields))
    )
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, app_id, annotation_id):
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
