from typing import Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from flask_restx.api import HTTPStatus
from pydantic import BaseModel, Field, TypeAdapter

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.wraps import edit_permission_required
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import validate_app_token
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from fields.annotation_fields import Annotation, AnnotationList
from fields.base import ResponseModel
from models.model import App
from services.annotation_service import (
    AppAnnotationService,
    EnableAnnotationArgs,
    InsertAnnotationArgs,
    UpdateAnnotationArgs,
)


class AnnotationCreatePayload(BaseModel):
    question: str = Field(description="Annotation question.")
    answer: str = Field(description="Annotation answer.")


class AnnotationReplyActionPayload(BaseModel):
    score_threshold: float = Field(
        description=(
            "Minimum similarity score for an annotation to be considered a match. Higher values require closer matches."
        ),
        json_schema_extra={"format": "float"},
    )
    embedding_provider_name: str = Field(description="Name of the embedding model provider.")
    embedding_model_name: str = Field(description="Name of the embedding model to use for annotation matching.")


class AnnotationListQuery(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number for pagination.")
    limit: int = Field(default=20, ge=1, description="Number of items per page.")
    keyword: str = Field(default="", description="Keyword to filter annotations by question or answer content.")


class AnnotationJobStatusResponse(ResponseModel):
    job_id: str
    job_status: str
    error_msg: str | None = None


ANNOTATION_REPLY_ACTION_PARAM = {
    "description": "Action to perform: `enable` or `disable`.",
    "enum": ["enable", "disable"],
    "type": "string",
}


register_schema_models(
    service_api_ns,
    AnnotationCreatePayload,
    AnnotationReplyActionPayload,
    AnnotationListQuery,
    Annotation,
    AnnotationList,
)
register_response_schema_models(service_api_ns, AnnotationJobStatusResponse)


@service_api_ns.route("/apps/annotation-reply/<string:action>")
class AnnotationReplyActionApi(Resource):
    @service_api_ns.doc(
        summary="Configure Annotation Reply",
        description=(
            "Enables or disables the annotation reply feature. Requires embedding model configuration "
            "when enabling. Executes asynchronously — use [Get Annotation Reply Job "
            "Status](/api-reference/annotations/get-annotation-reply-job-status) to track progress."
        ),
        tags=["Annotations"],
        responses={
            200: "Annotation reply settings task initiated.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[AnnotationReplyActionPayload.__name__])
    @service_api_ns.doc("annotation_reply_action")
    @service_api_ns.doc(description="Enable or disable annotation reply feature")
    @service_api_ns.doc(params={"action": ANNOTATION_REPLY_ACTION_PARAM})
    @service_api_ns.doc(
        responses={
            200: "Action completed successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        200,
        "Action completed successfully",
        service_api_ns.models[AnnotationJobStatusResponse.__name__],
    )
    @validate_app_token
    def post(self, app_model: App, action: Literal["enable", "disable"]):
        """Enable or disable annotation reply feature."""
        payload = AnnotationReplyActionPayload.model_validate(service_api_ns.payload or {})
        match action:
            case "enable":
                enable_args: EnableAnnotationArgs = {
                    "score_threshold": payload.score_threshold,
                    "embedding_provider_name": payload.embedding_provider_name,
                    "embedding_model_name": payload.embedding_model_name,
                }
                result = AppAnnotationService.enable_app_annotation(enable_args, app_model.id)
            case "disable":
                result = AppAnnotationService.disable_app_annotation(app_model.id)
        return result, 200


@service_api_ns.route("/apps/annotation-reply/<string:action>/status/<uuid:job_id>")
class AnnotationReplyActionStatusApi(Resource):
    @service_api_ns.doc(
        summary="Get Annotation Reply Job Status",
        description=(
            "Retrieves the status of an asynchronous annotation reply configuration job started by "
            "[Configure Annotation Reply](/api-reference/annotations/configure-annotation-reply)."
        ),
        tags=["Annotations"],
        responses={
            200: "Successfully retrieved task status.",
            400: "`invalid_param` : The specified job does not exist.",
        },
    )
    @service_api_ns.doc("get_annotation_reply_action_status")
    @service_api_ns.doc(description="Get the status of an annotation reply action job")
    @service_api_ns.doc(
        params={
            "action": ANNOTATION_REPLY_ACTION_PARAM,
            "job_id": (
                "Job ID returned by "
                "[Configure Annotation Reply](/api-reference/annotations/configure-annotation-reply)."
            ),
        }
    )
    @service_api_ns.doc(
        responses={
            200: "Job status retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Job not found",
        }
    )
    @service_api_ns.response(
        200,
        "Job status retrieved successfully",
        service_api_ns.models[AnnotationJobStatusResponse.__name__],
    )
    @validate_app_token
    def get(self, app_model: App, job_id: UUID, action: str):
        """Get the status of an annotation reply action job."""
        job_id_str = str(job_id)
        app_annotation_job_key = f"{action}_app_annotation_job_{job_id_str}"
        cache_result = redis_client.get(app_annotation_job_key)
        if cache_result is None:
            raise ValueError("The job does not exist.")

        job_status = cache_result.decode()
        error_msg = ""
        if job_status == "error":
            app_annotation_error_key = f"{action}_app_annotation_error_{job_id_str}"
            error_msg = redis_client.get(app_annotation_error_key)
            error_msg = error_msg.decode() if error_msg else ""

        return {"job_id": job_id_str, "job_status": job_status, "error_msg": error_msg}, 200


@service_api_ns.route("/apps/annotations")
class AnnotationListApi(Resource):
    @service_api_ns.doc(
        summary="List Annotations",
        description="Retrieves a paginated list of annotations for the application. Supports keyword search filtering.",
        tags=["Annotations"],
        responses={
            200: "Successfully retrieved annotation list.",
        },
    )
    @service_api_ns.doc("list_annotations")
    @service_api_ns.doc(description="List annotations for the application")
    @service_api_ns.doc(params=query_params_from_model(AnnotationListQuery))
    @service_api_ns.doc(
        responses={
            200: "Annotations retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        200,
        "Annotations retrieved successfully",
        service_api_ns.models[AnnotationList.__name__],
    )
    @validate_app_token
    def get(self, app_model: App):
        """List annotations for the application."""
        query = AnnotationListQuery.model_validate(request.args.to_dict(flat=True))

        annotation_list, total = AppAnnotationService.get_annotation_list_by_app_id(
            app_model.id, query.page, query.limit, query.keyword
        )
        annotation_models = TypeAdapter(list[Annotation]).validate_python(annotation_list, from_attributes=True)
        response = AnnotationList(
            data=annotation_models,
            has_more=len(annotation_list) == query.limit,
            limit=query.limit,
            total=total,
            page=query.page,
        )
        return response.model_dump(mode="json")

    @service_api_ns.doc(
        summary="Create Annotation",
        description=(
            "Creates a new annotation. Annotations provide predefined question-answer pairs that the app "
            "can match and return directly instead of generating a response."
        ),
        tags=["Annotations"],
        responses={
            201: "Annotation created successfully.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[AnnotationCreatePayload.__name__])
    @service_api_ns.doc("create_annotation")
    @service_api_ns.doc(description="Create a new annotation")
    @service_api_ns.doc(
        responses={
            201: "Annotation created successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        HTTPStatus.CREATED,
        "Annotation created successfully",
        service_api_ns.models[Annotation.__name__],
    )
    @validate_app_token
    def post(self, app_model: App):
        """Create a new annotation."""
        payload = AnnotationCreatePayload.model_validate(service_api_ns.payload or {})
        insert_args: InsertAnnotationArgs = {"question": payload.question, "answer": payload.answer}
        annotation = AppAnnotationService.insert_app_annotation_directly(insert_args, app_model.id)
        response = Annotation.model_validate(annotation, from_attributes=True)
        return response.model_dump(mode="json"), HTTPStatus.CREATED


@service_api_ns.route("/apps/annotations/<uuid:annotation_id>")
class AnnotationUpdateDeleteApi(Resource):
    @service_api_ns.doc(
        summary="Update Annotation",
        description="Updates the question and answer of an existing annotation.",
        tags=["Annotations"],
        responses={
            200: "Annotation updated successfully.",
            403: "`forbidden` : Insufficient permissions to edit annotations.",
            404: "`not_found` : Annotation does not exist.",
        },
    )
    @service_api_ns.expect(service_api_ns.models[AnnotationCreatePayload.__name__])
    @service_api_ns.doc("update_annotation")
    @service_api_ns.doc(description="Update an existing annotation")
    @service_api_ns.doc(params={"annotation_id": "The unique identifier of the annotation to update."})
    @service_api_ns.doc(
        responses={
            200: "Annotation updated successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Annotation not found",
        }
    )
    @service_api_ns.response(
        200,
        "Annotation updated successfully",
        service_api_ns.models[Annotation.__name__],
    )
    @validate_app_token
    @edit_permission_required
    def put(self, app_model: App, annotation_id: UUID):
        """Update an existing annotation."""
        payload = AnnotationCreatePayload.model_validate(service_api_ns.payload or {})
        update_args: UpdateAnnotationArgs = {"question": payload.question, "answer": payload.answer}
        annotation = AppAnnotationService.update_app_annotation_directly(
            update_args, app_model.id, str(annotation_id), db.session
        )
        response = Annotation.model_validate(annotation, from_attributes=True)
        return response.model_dump(mode="json")

    @service_api_ns.doc(
        summary="Delete Annotation",
        description="Deletes an annotation and its associated hit history.",
        tags=["Annotations"],
        responses={
            204: "Annotation deleted successfully.",
            403: "`forbidden` : Insufficient permissions to edit annotations.",
            404: "`not_found` : Annotation does not exist.",
        },
    )
    @service_api_ns.doc("delete_annotation")
    @service_api_ns.doc(description="Delete an annotation")
    @service_api_ns.doc(params={"annotation_id": "The unique identifier of the annotation to delete."})
    @service_api_ns.doc(
        responses={
            204: "Annotation deleted successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - insufficient permissions",
            404: "Annotation not found",
        }
    )
    @validate_app_token
    @edit_permission_required
    def delete(self, app_model: App, annotation_id: UUID):
        """Delete an annotation."""
        AppAnnotationService.delete_app_annotation(app_model.id, str(annotation_id), db.session)
        return "", 204
