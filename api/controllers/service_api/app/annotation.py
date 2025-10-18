from typing import Literal

from flask import request
from flask_restx import Api, Namespace, Resource, fields, reqparse
from flask_restx.api import HTTPStatus
from werkzeug.exceptions import Forbidden

from controllers.service_api import service_api_ns
from controllers.service_api.wraps import validate_app_token
from extensions.ext_redis import redis_client
from fields.annotation_fields import annotation_fields, build_annotation_model
from libs.login import current_user
from models import Account
from models.model import App
from services.annotation_service import AppAnnotationService

# Define parsers for annotation API
annotation_create_parser = (
    reqparse.RequestParser()
    .add_argument("question", required=True, type=str, location="json", help="Annotation question")
    .add_argument("answer", required=True, type=str, location="json", help="Annotation answer")
)

annotation_reply_action_parser = (
    reqparse.RequestParser()
    .add_argument(
        "score_threshold", required=True, type=float, location="json", help="Score threshold for annotation matching"
    )
    .add_argument("embedding_provider_name", required=True, type=str, location="json", help="Embedding provider name")
    .add_argument("embedding_model_name", required=True, type=str, location="json", help="Embedding model name")
)


@service_api_ns.route("/apps/annotation-reply/<string:action>")
class AnnotationReplyActionApi(Resource):
    @service_api_ns.expect(annotation_reply_action_parser)
    @service_api_ns.doc("annotation_reply_action")
    @service_api_ns.doc(description="Enable or disable annotation reply feature")
    @service_api_ns.doc(params={"action": "Action to perform: 'enable' or 'disable'"})
    @service_api_ns.doc(
        responses={
            200: "Action completed successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @validate_app_token
    def post(self, app_model: App, action: Literal["enable", "disable"]):
        """Enable or disable annotation reply feature."""
        args = annotation_reply_action_parser.parse_args()
        if action == "enable":
            result = AppAnnotationService.enable_app_annotation(args, app_model.id)
        elif action == "disable":
            result = AppAnnotationService.disable_app_annotation(app_model.id)
        return result, 200


@service_api_ns.route("/apps/annotation-reply/<string:action>/status/<uuid:job_id>")
class AnnotationReplyActionStatusApi(Resource):
    @service_api_ns.doc("get_annotation_reply_action_status")
    @service_api_ns.doc(description="Get the status of an annotation reply action job")
    @service_api_ns.doc(params={"action": "Action type", "job_id": "Job ID"})
    @service_api_ns.doc(
        responses={
            200: "Job status retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Job not found",
        }
    )
    @validate_app_token
    def get(self, app_model: App, job_id, action):
        """Get the status of an annotation reply action job."""
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


# Define annotation list response model
annotation_list_fields = {
    "data": fields.List(fields.Nested(annotation_fields)),
    "has_more": fields.Boolean,
    "limit": fields.Integer,
    "total": fields.Integer,
    "page": fields.Integer,
}


def build_annotation_list_model(api_or_ns: Api | Namespace):
    """Build the annotation list model for the API or Namespace."""
    copied_annotation_list_fields = annotation_list_fields.copy()
    copied_annotation_list_fields["data"] = fields.List(fields.Nested(build_annotation_model(api_or_ns)))
    return api_or_ns.model("AnnotationList", copied_annotation_list_fields)


@service_api_ns.route("/apps/annotations")
class AnnotationListApi(Resource):
    @service_api_ns.doc("list_annotations")
    @service_api_ns.doc(description="List annotations for the application")
    @service_api_ns.doc(
        responses={
            200: "Annotations retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @validate_app_token
    @service_api_ns.marshal_with(build_annotation_list_model(service_api_ns))
    def get(self, app_model: App):
        """List annotations for the application."""
        page = request.args.get("page", default=1, type=int)
        limit = request.args.get("limit", default=20, type=int)
        keyword = request.args.get("keyword", default="", type=str)

        annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(app_model.id, page, limit, keyword)
        return {
            "data": annotation_list,
            "has_more": len(annotation_list) == limit,
            "limit": limit,
            "total": total,
            "page": page,
        }

    @service_api_ns.expect(annotation_create_parser)
    @service_api_ns.doc("create_annotation")
    @service_api_ns.doc(description="Create a new annotation")
    @service_api_ns.doc(
        responses={
            201: "Annotation created successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @validate_app_token
    @service_api_ns.marshal_with(build_annotation_model(service_api_ns), code=HTTPStatus.CREATED)
    def post(self, app_model: App):
        """Create a new annotation."""
        args = annotation_create_parser.parse_args()
        annotation = AppAnnotationService.insert_app_annotation_directly(args, app_model.id)
        return annotation, 201


@service_api_ns.route("/apps/annotations/<uuid:annotation_id>")
class AnnotationUpdateDeleteApi(Resource):
    @service_api_ns.expect(annotation_create_parser)
    @service_api_ns.doc("update_annotation")
    @service_api_ns.doc(description="Update an existing annotation")
    @service_api_ns.doc(params={"annotation_id": "Annotation ID"})
    @service_api_ns.doc(
        responses={
            200: "Annotation updated successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Annotation not found",
        }
    )
    @validate_app_token
    @service_api_ns.marshal_with(build_annotation_model(service_api_ns))
    def put(self, app_model: App, annotation_id):
        """Update an existing annotation."""
        assert isinstance(current_user, Account)
        if not current_user.has_edit_permission:
            raise Forbidden()

        annotation_id = str(annotation_id)
        args = annotation_create_parser.parse_args()
        annotation = AppAnnotationService.update_app_annotation_directly(args, app_model.id, annotation_id)
        return annotation

    @service_api_ns.doc("delete_annotation")
    @service_api_ns.doc(description="Delete an annotation")
    @service_api_ns.doc(params={"annotation_id": "Annotation ID"})
    @service_api_ns.doc(
        responses={
            204: "Annotation deleted successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Annotation not found",
        }
    )
    @validate_app_token
    def delete(self, app_model: App, annotation_id):
        """Delete an annotation."""
        assert isinstance(current_user, Account)

        if not current_user.has_edit_permission:
            raise Forbidden()

        annotation_id = str(annotation_id)
        AppAnnotationService.delete_app_annotation(app_model.id, annotation_id)
        return {"result": "success"}, 204
