import logging
from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar, Union
from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource, fields
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
)
from core.file import helpers as file_helpers
from extensions.ext_database import db
from libs.helper import TimestampField
from libs.login import current_account_with_tenant, login_required
from models import App
from models.model import UploadFile
from models.snippet import CustomizedSnippet
from services.evaluation_service import EvaluationService

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

# Valid evaluation target types
EVALUATE_TARGET_TYPES = {"app", "snippets"}


class VersionQuery(BaseModel):
    """Query parameters for version endpoint."""

    version: str


register_schema_models(
    console_ns,
    VersionQuery,
)


# Response field definitions
file_info_fields = {
    "id": fields.String,
    "name": fields.String,
}

evaluation_log_fields = {
    "created_at": TimestampField,
    "created_by": fields.String,
    "test_file": fields.Nested(
        console_ns.model(
            "EvaluationTestFile",
            file_info_fields,
        )
    ),
    "result_file": fields.Nested(
        console_ns.model(
            "EvaluationResultFile",
            file_info_fields,
        ),
        allow_null=True,
    ),
    "version": fields.String,
}

evaluation_log_list_model = console_ns.model(
    "EvaluationLogList",
    {
        "data": fields.List(fields.Nested(console_ns.model("EvaluationLog", evaluation_log_fields))),
    },
)

customized_matrix_fields = {
    "evaluation_workflow_id": fields.String,
    "input_fields": fields.Raw,
    "output_fields": fields.Raw,
}

condition_fields = {
    "name": fields.List(fields.String),
    "comparison_operator": fields.String,
    "value": fields.String,
}

judgement_conditions_fields = {
    "logical_operator": fields.String,
    "conditions": fields.List(fields.Nested(console_ns.model("EvaluationCondition", condition_fields))),
}

evaluation_detail_fields = {
    "evaluation_model": fields.String,
    "evaluation_model_provider": fields.String,
    "customized_matrix": fields.Nested(
        console_ns.model("EvaluationCustomizedMatrix", customized_matrix_fields),
        allow_null=True,
    ),
    "judgement_conditions": fields.Nested(
        console_ns.model("EvaluationJudgementConditions", judgement_conditions_fields),
        allow_null=True,
    ),
}

evaluation_detail_model = console_ns.model("EvaluationDetail", evaluation_detail_fields)


def get_evaluation_target(view_func: Callable[P, R]):
    """
    Decorator to resolve polymorphic evaluation target (app or snippet).

    Validates the target_type parameter and fetches the corresponding
    model (App or CustomizedSnippet) with tenant isolation.
    """

    @wraps(view_func)
    def decorated_view(*args: P.args, **kwargs: P.kwargs):
        target_type = kwargs.get("evaluate_target_type")
        target_id = kwargs.get("evaluate_target_id")

        if target_type not in EVALUATE_TARGET_TYPES:
            raise NotFound(f"Invalid evaluation target type: {target_type}")

        _, current_tenant_id = current_account_with_tenant()

        target_id = str(target_id)

        # Remove path parameters
        del kwargs["evaluate_target_type"]
        del kwargs["evaluate_target_id"]

        target: Union[App, CustomizedSnippet] | None = None

        if target_type == "app":
            target = (
                db.session.query(App).where(App.id == target_id, App.tenant_id == current_tenant_id).first()
            )
        elif target_type == "snippets":
            target = (
                db.session.query(CustomizedSnippet)
                .where(CustomizedSnippet.id == target_id, CustomizedSnippet.tenant_id == current_tenant_id)
                .first()
            )

        if not target:
            raise NotFound(f"{str(target_type)} not found")

        kwargs["target"] = target
        kwargs["target_type"] = target_type

        return view_func(*args, **kwargs)

    return decorated_view


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/dataset-template/download")
class EvaluationDatasetTemplateDownloadApi(Resource):
    @console_ns.doc("download_evaluation_dataset_template")
    @console_ns.response(200, "Template file streamed as XLSX attachment")
    @console_ns.response(400, "Invalid target type or excluded app mode")
    @console_ns.response(404, "Target not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    @edit_permission_required
    def post(self, target: Union[App, CustomizedSnippet], target_type: str):
        """
        Download evaluation dataset template.

        Generates an XLSX template based on the target's input parameters
        and streams it directly as a file attachment.
        """
        try:
            xlsx_content, filename = EvaluationService.generate_dataset_template(
                target=target,
                target_type=target_type,
            )
        except ValueError as e:
            return {"message": str(e)}, 400

        encoded_filename = quote(filename)
        response = Response(
            xlsx_content,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"
        response.headers["Content-Length"] = str(len(xlsx_content))
        return response


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation")
class EvaluationDetailApi(Resource):
    @console_ns.doc("get_evaluation_detail")
    @console_ns.response(200, "Evaluation details retrieved successfully", evaluation_detail_model)
    @console_ns.response(404, "Target not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    def get(self, target: Union[App, CustomizedSnippet], target_type: str):
        """
        Get evaluation details for the target.

        Returns evaluation configuration including model settings,
        customized matrix, and judgement conditions.
        """
        # TODO: Implement actual evaluation detail retrieval
        # This is a placeholder implementation
        return {
            "evaluation_model": None,
            "evaluation_model_provider": None,
            "customized_matrix": None,
            "judgement_conditions": None,
        }


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/logs")
class EvaluationLogsApi(Resource):
    @console_ns.doc("get_evaluation_logs")
    @console_ns.response(200, "Evaluation logs retrieved successfully", evaluation_log_list_model)
    @console_ns.response(404, "Target not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    def get(self, target: Union[App, CustomizedSnippet], target_type: str):
        """
        Get offline evaluation logs for the target.

        Returns a list of evaluation runs with test files,
        result files, and version information.
        """
        # TODO: Implement actual evaluation logs retrieval
        # This is a placeholder implementation
        return {
            "data": [],
        }


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/files/<uuid:file_id>")
class EvaluationFileDownloadApi(Resource):
    @console_ns.doc("download_evaluation_file")
    @console_ns.response(200, "File download URL generated successfully")
    @console_ns.response(404, "Target or file not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    def get(self, target: Union[App, CustomizedSnippet], target_type: str, file_id: str):
        """
        Download evaluation test file or result file.

        Looks up the specified file, verifies it belongs to the same tenant,
        and returns file info and download URL.
        """
        file_id = str(file_id)
        _, current_tenant_id = current_account_with_tenant()

        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(UploadFile).where(
                UploadFile.id == file_id,
                UploadFile.tenant_id == current_tenant_id,
            )
            upload_file = session.execute(stmt).scalar_one_or_none()

        if not upload_file:
            raise NotFound("File not found")

        download_url = file_helpers.get_signed_file_url(upload_file_id=upload_file.id, as_attachment=True)

        return {
            "id": upload_file.id,
            "name": upload_file.name,
            "size": upload_file.size,
            "extension": upload_file.extension,
            "mime_type": upload_file.mime_type,
            "created_at": int(upload_file.created_at.timestamp()) if upload_file.created_at else None,
            "download_url": download_url,
        }


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/version")
class EvaluationVersionApi(Resource):
    @console_ns.doc("get_evaluation_version_detail")
    @console_ns.expect(console_ns.models.get(VersionQuery.__name__))
    @console_ns.response(200, "Version details retrieved successfully")
    @console_ns.response(404, "Target or version not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    def get(self, target: Union[App, CustomizedSnippet], target_type: str):
        """
        Get evaluation target version details.

        Returns the workflow graph for the specified version.
        """
        version = request.args.get("version")

        if not version:
            return {"message": "version parameter is required"}, 400

        # TODO: Implement actual version detail retrieval
        # For now, return the current graph if available
        graph = {}
        if target_type == "snippets" and isinstance(target, CustomizedSnippet):
            graph = target.graph_dict

        return {
            "graph": graph,
        }
