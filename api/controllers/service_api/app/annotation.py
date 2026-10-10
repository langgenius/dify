from http import HTTPStatus
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter

from controllers.common.errors import NotFoundError
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.flask_admission import service_api_account_admission
from extensions.ext_application_services import application_services
from fields.annotation_fields import (
    Annotation,
    AnnotationJobStatusDetailResponse,
    AnnotationJobStatusResponse,
    AnnotationList,
)
from libs.helper import dump_response
from machinery.context import ServiceApiAccountRequestContext
from services.annotation_query import AnnotationAppNotFoundError, AnnotationNotFoundError
from services.annotation_reply_service import AnnotationReplyAction, AnnotationReplyJobNotFoundError


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
register_response_schema_models(
    service_api_ns,
    Annotation,
    AnnotationList,
    AnnotationJobStatusResponse,
    AnnotationJobStatusDetailResponse,
)


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
            400: "`invalid_param` : Invalid action.",
            401: "Unauthorized - invalid API token",
            404: "`not_found` : App no longer exists.",
            422: "`unprocessable_entity` : Invalid annotation reply payload.",
        }
    )
    @service_api_ns.response(
        200,
        "Action completed successfully",
        service_api_ns.models[AnnotationJobStatusResponse.__name__],
    )
    @service_api_account_admission
    @model_validate(AnnotationReplyActionPayload)
    def post(
        self, payload: AnnotationReplyActionPayload, context: ServiceApiAccountRequestContext, action: str
    ) -> tuple[dict[str, object], HTTPStatus]:
        """Enable or disable annotation reply feature."""
        validated_action = TypeAdapter(AnnotationReplyAction).validate_python(action)
        service = application_services().annotation_reply
        try:
            if validated_action == "enable":
                result = service.request_enable(
                    tenant_id=context.tenant_id,
                    app_id=context.app_id,
                    account_id=context.account_id,
                    score_threshold=payload.score_threshold,
                    embedding_provider_name=payload.embedding_provider_name,
                    embedding_model_name=payload.embedding_model_name,
                )
            else:
                result = service.request_disable(tenant_id=context.tenant_id, app_id=context.app_id)
        except AnnotationAppNotFoundError as exc:
            raise NotFoundError("App not found") from exc
        return dump_response(AnnotationJobStatusResponse, result), HTTPStatus.OK


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
            400: "`invalid_param` : Invalid action.",
            404: "`not_found` : The specified job does not belong to this app or no longer exists.",
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
        }
    )
    @service_api_ns.response(
        200,
        "Job status retrieved successfully",
        service_api_ns.models[AnnotationJobStatusDetailResponse.__name__],
    )
    @service_api_account_admission
    def get(
        self, context: ServiceApiAccountRequestContext, job_id: UUID, action: str
    ) -> tuple[dict[str, object], HTTPStatus]:
        """Get the status of an annotation reply action job."""
        validated_action = TypeAdapter(AnnotationReplyAction).validate_python(action)
        try:
            result = application_services().annotation_reply.get_status(
                tenant_id=context.tenant_id, app_id=context.app_id, action=validated_action, job_id=str(job_id)
            )
        except AnnotationAppNotFoundError as exc:
            raise NotFoundError("App not found") from exc
        except AnnotationReplyJobNotFoundError as exc:
            raise NotFoundError("The job does not exist.") from exc
        return dump_response(AnnotationJobStatusDetailResponse, result), HTTPStatus.OK


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
    @service_api_account_admission
    @model_validate(AnnotationListQuery)
    def get(self, query: AnnotationListQuery, context: ServiceApiAccountRequestContext) -> dict[str, object]:
        """List annotations for the application."""
        try:
            result = application_services().annotation_queries.get_page(
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                page=query.page,
                limit=query.limit,
                keyword=query.keyword,
            )
        except AnnotationAppNotFoundError as exc:
            raise NotFoundError("App not found") from exc
        return dump_response(AnnotationList, result)

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
    @service_api_account_admission
    @model_validate(AnnotationCreatePayload)
    def post(
        self, payload: AnnotationCreatePayload, context: ServiceApiAccountRequestContext
    ) -> tuple[dict[str, object], HTTPStatus]:
        """Create a new annotation."""
        try:
            annotation = application_services().annotation_commands.create(
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                account_id=context.account_id,
                question=payload.question,
                answer=payload.answer,
            )
        except AnnotationAppNotFoundError as exc:
            raise NotFoundError("App not found") from exc
        return dump_response(Annotation, annotation), HTTPStatus.CREATED


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
    @service_api_account_admission
    @model_validate(AnnotationCreatePayload)
    def put(
        self, payload: AnnotationCreatePayload, context: ServiceApiAccountRequestContext, annotation_id: UUID
    ) -> dict[str, object]:
        """Update an existing annotation."""
        try:
            annotation = application_services().annotation_commands.update(
                tenant_id=context.tenant_id,
                app_id=context.app_id,
                annotation_id=str(annotation_id),
                question=payload.question,
                answer=payload.answer,
            )
        except AnnotationAppNotFoundError as exc:
            raise NotFoundError("App not found") from exc
        except AnnotationNotFoundError as exc:
            raise NotFoundError("Annotation not found") from exc
        return dump_response(Annotation, annotation)

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
    @service_api_account_admission
    def delete(self, context: ServiceApiAccountRequestContext, annotation_id: UUID) -> tuple[str, HTTPStatus]:
        """Delete an annotation."""
        try:
            application_services().annotation_commands.delete(
                tenant_id=context.tenant_id, app_id=context.app_id, annotation_id=str(annotation_id)
            )
        except AnnotationAppNotFoundError as exc:
            raise NotFoundError("App not found") from exc
        except AnnotationNotFoundError as exc:
            raise NotFoundError("Annotation not found") from exc
        return "", HTTPStatus.NO_CONTENT
