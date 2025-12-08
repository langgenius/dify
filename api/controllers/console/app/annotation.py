from typing import Any, Literal

from flask import request
from flask_restx import Resource, fields, marshal, marshal_with
from pydantic import BaseModel, Field, field_validator

from controllers.common.errors import NoFileUploadedError, TooManyFilesError
from controllers.console import console_ns
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
    build_annotation_model,
)
from libs.helper import uuid_value
from libs.login import login_required
from services.annotation_service import AppAnnotationService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class AnnotationReplyPayload(BaseModel):
    score_threshold: float = Field(..., description="Score threshold for annotation matching")
    embedding_provider_name: str = Field(..., description="Embedding provider name")
    embedding_model_name: str = Field(..., description="Embedding model name")


class AnnotationSettingUpdatePayload(BaseModel):
    score_threshold: float = Field(..., description="Score threshold")


class AnnotationListQuery(BaseModel):
    page: int = Field(default=1, ge=1, description="Page number")
    limit: int = Field(default=20, ge=1, description="Page size")
    keyword: str = Field(default="", description="Search keyword")


class CreateAnnotationPayload(BaseModel):
    message_id: str | None = Field(default=None, description="Message ID")
    question: str | None = Field(default=None, description="Question text")
    answer: str | None = Field(default=None, description="Answer text")
    content: str | None = Field(default=None, description="Content text")
    annotation_reply: dict[str, Any] | None = Field(default=None, description="Annotation reply data")

    @field_validator("message_id")
    @classmethod
    def validate_message_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


class UpdateAnnotationPayload(BaseModel):
    question: str | None = None
    answer: str | None = None
    content: str | None = None
    annotation_reply: dict[str, Any] | None = None


class AnnotationReplyStatusQuery(BaseModel):
    action: Literal["enable", "disable"]


class AnnotationFilePayload(BaseModel):
    message_id: str = Field(..., description="Message ID")

    @field_validator("message_id")
    @classmethod
    def validate_message_id(cls, value: str) -> str:
        return uuid_value(value)


def reg(model: type[BaseModel]) -> None:
    console_ns.schema_model(model.__name__, model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(AnnotationReplyPayload)
reg(AnnotationSettingUpdatePayload)
reg(AnnotationListQuery)
reg(CreateAnnotationPayload)
reg(UpdateAnnotationPayload)
reg(AnnotationReplyStatusQuery)
reg(AnnotationFilePayload)


@console_ns.route("/apps/<uuid:app_id>/annotation-reply/<string:action>")
class AnnotationReplyActionApi(Resource):
    @console_ns.doc("annotation_reply_action")
    @console_ns.doc(description="Enable or disable annotation reply for an app")
    @console_ns.doc(params={"app_id": "Application ID", "action": "Action to perform (enable/disable)"})
    @console_ns.expect(console_ns.models[AnnotationReplyPayload.__name__])
    @console_ns.response(200, "Action completed successfully")
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @edit_permission_required
    def post(self, app_id, action: Literal["enable", "disable"]):
        app_id = str(app_id)
        args = AnnotationReplyPayload.model_validate(console_ns.payload)
        if action == "enable":
            result = AppAnnotationService.enable_app_annotation(args.model_dump(), app_id)
        elif action == "disable":
            result = AppAnnotationService.disable_app_annotation(app_id)
        return result, 200


@console_ns.route("/apps/<uuid:app_id>/annotation-setting")
class AppAnnotationSettingDetailApi(Resource):
    @console_ns.doc("get_annotation_setting")
    @console_ns.doc(description="Get annotation settings for an app")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Annotation settings retrieved successfully")
    @console_ns.response(403, "Insufficient permissions")
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
    @console_ns.doc("update_annotation_setting")
    @console_ns.doc(description="Update annotation settings for an app")
    @console_ns.doc(params={"app_id": "Application ID", "annotation_setting_id": "Annotation setting ID"})
    @console_ns.expect(console_ns.models[AnnotationSettingUpdatePayload.__name__])
    @console_ns.response(200, "Settings updated successfully")
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, app_id, annotation_setting_id):
        app_id = str(app_id)
        annotation_setting_id = str(annotation_setting_id)

        args = AnnotationSettingUpdatePayload.model_validate(console_ns.payload)

        result = AppAnnotationService.update_app_annotation_setting(app_id, annotation_setting_id, args.model_dump())
        return result, 200


@console_ns.route("/apps/<uuid:app_id>/annotation-reply/<string:action>/status/<uuid:job_id>")
class AnnotationReplyActionStatusApi(Resource):
    @console_ns.doc("get_annotation_reply_action_status")
    @console_ns.doc(description="Get status of annotation reply action job")
    @console_ns.doc(params={"app_id": "Application ID", "job_id": "Job ID", "action": "Action type"})
    @console_ns.response(200, "Job status retrieved successfully")
    @console_ns.response(403, "Insufficient permissions")
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
    @console_ns.doc("list_annotations")
    @console_ns.doc(description="Get annotations for an app with pagination")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[AnnotationListQuery.__name__])
    @console_ns.response(200, "Annotations retrieved successfully")
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, app_id):
        args = AnnotationListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        page = args.page
        limit = args.limit
        keyword = args.keyword

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

    @console_ns.doc("create_annotation")
    @console_ns.doc(description="Create a new annotation for an app")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[CreateAnnotationPayload.__name__])
    @console_ns.response(201, "Annotation created successfully", build_annotation_model(console_ns))
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @marshal_with(annotation_fields)
    @edit_permission_required
    def post(self, app_id):
        app_id = str(app_id)
        args = CreateAnnotationPayload.model_validate(console_ns.payload)
        data = args.model_dump(exclude_none=True)
        annotation = AppAnnotationService.up_insert_app_annotation_from_message(data, app_id)
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
    @console_ns.doc("export_annotations")
    @console_ns.doc(description="Export all annotations for an app")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Annotations exported successfully",
        console_ns.model("AnnotationList", {"data": fields.List(fields.Nested(build_annotation_model(console_ns)))}),
    )
    @console_ns.response(403, "Insufficient permissions")
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
    @console_ns.doc("update_delete_annotation")
    @console_ns.doc(description="Update or delete an annotation")
    @console_ns.doc(params={"app_id": "Application ID", "annotation_id": "Annotation ID"})
    @console_ns.response(200, "Annotation updated successfully", build_annotation_model(console_ns))
    @console_ns.response(204, "Annotation deleted successfully")
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.expect(console_ns.models[UpdateAnnotationPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("annotation")
    @edit_permission_required
    @marshal_with(annotation_fields)
    def post(self, app_id, annotation_id):
        app_id = str(app_id)
        annotation_id = str(annotation_id)
        args = UpdateAnnotationPayload.model_validate(console_ns.payload)
        annotation = AppAnnotationService.update_app_annotation_directly(
            args.model_dump(exclude_none=True), app_id, annotation_id
        )
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
    @console_ns.doc("batch_import_annotations")
    @console_ns.doc(description="Batch import annotations from CSV file")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(200, "Batch import started successfully")
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(400, "No file uploaded or too many files")
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
    @console_ns.doc("get_batch_import_status")
    @console_ns.doc(description="Get status of batch import job")
    @console_ns.doc(params={"app_id": "Application ID", "job_id": "Job ID"})
    @console_ns.response(200, "Job status retrieved successfully")
    @console_ns.response(403, "Insufficient permissions")
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
    @console_ns.doc("list_annotation_hit_histories")
    @console_ns.doc(description="Get hit histories for an annotation")
    @console_ns.doc(params={"app_id": "Application ID", "annotation_id": "Annotation ID"})
    @console_ns.expect(
        console_ns.parser()
        .add_argument("page", type=int, location="args", default=1, help="Page number")
        .add_argument("limit", type=int, location="args", default=20, help="Page size")
    )
    @console_ns.response(
        200,
        "Hit histories retrieved successfully",
        console_ns.model(
            "AnnotationHitHistoryList",
            {
                "data": fields.List(
                    fields.Nested(console_ns.model("AnnotationHitHistoryItem", annotation_hit_history_fields))
                )
            },
        ),
    )
    @console_ns.response(403, "Insufficient permissions")
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
