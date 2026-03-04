from __future__ import annotations

import logging
from collections.abc import Callable
from functools import wraps
from typing import TYPE_CHECKING, ParamSpec, TypeVar, Union
from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource, fields
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
)
from core.evaluation.entities.evaluation_entity import EvaluationCategory, EvaluationRunRequest
from core.workflow.file import helpers as file_helpers
from extensions.ext_database import db
from extensions.ext_storage import storage
from libs.helper import TimestampField
from libs.login import current_account_with_tenant, login_required
from models import App
from models.model import UploadFile
from models.snippet import CustomizedSnippet
from services.errors.evaluation import (
    EvaluationDatasetInvalidError,
    EvaluationFrameworkNotConfiguredError,
    EvaluationMaxConcurrentRunsError,
    EvaluationNotFoundError,
)
from services.evaluation_service import EvaluationService

if TYPE_CHECKING:
    from models.evaluation import EvaluationRun, EvaluationRunItem

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
        Get evaluation configuration for the target.

        Returns evaluation configuration including model settings,
        metrics config, and judgement conditions.
        """
        _, current_tenant_id = current_account_with_tenant()

        with Session(db.engine, expire_on_commit=False) as session:
            config = EvaluationService.get_evaluation_config(
                session, current_tenant_id, target_type, str(target.id)
            )

        if config is None:
            return {
                "evaluation_model": None,
                "evaluation_model_provider": None,
                "metrics_config": None,
                "judgement_conditions": None,
            }

        return {
            "evaluation_model": config.evaluation_model,
            "evaluation_model_provider": config.evaluation_model_provider,
            "metrics_config": config.metrics_config_dict,
            "judgement_conditions": config.judgement_conditions_dict,
        }

    @console_ns.doc("save_evaluation_detail")
    @console_ns.response(200, "Evaluation configuration saved successfully")
    @console_ns.response(404, "Target not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    @edit_permission_required
    def put(self, target: Union[App, CustomizedSnippet], target_type: str):
        """
        Save evaluation configuration for the target.
        """
        current_account, current_tenant_id = current_account_with_tenant()
        data = request.get_json(force=True)

        with Session(db.engine, expire_on_commit=False) as session:
            config = EvaluationService.save_evaluation_config(
                session=session,
                tenant_id=current_tenant_id,
                target_type=target_type,
                target_id=str(target.id),
                account_id=str(current_account.id),
                data=data,
            )

        return {
            "evaluation_model": config.evaluation_model,
            "evaluation_model_provider": config.evaluation_model_provider,
            "metrics_config": config.metrics_config_dict,
            "judgement_conditions": config.judgement_conditions_dict,
        }


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/logs")
class EvaluationLogsApi(Resource):
    @console_ns.doc("get_evaluation_logs")
    @console_ns.response(200, "Evaluation logs retrieved successfully")
    @console_ns.response(404, "Target not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    def get(self, target: Union[App, CustomizedSnippet], target_type: str):
        """
        Get evaluation run history for the target.

        Returns a paginated list of evaluation runs.
        """
        _, current_tenant_id = current_account_with_tenant()
        page = request.args.get("page", 1, type=int)
        page_size = request.args.get("page_size", 20, type=int)

        with Session(db.engine, expire_on_commit=False) as session:
            runs, total = EvaluationService.get_evaluation_runs(
                session=session,
                tenant_id=current_tenant_id,
                target_type=target_type,
                target_id=str(target.id),
                page=page,
                page_size=page_size,
            )

        return {
            "data": [_serialize_evaluation_run(run) for run in runs],
            "total": total,
            "page": page,
            "page_size": page_size,
        }


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/run")
class EvaluationRunApi(Resource):
    @console_ns.doc("start_evaluation_run")
    @console_ns.response(200, "Evaluation run started")
    @console_ns.response(400, "Invalid request")
    @console_ns.response(404, "Target not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    @edit_permission_required
    def post(self, target: Union[App, CustomizedSnippet], target_type: str):
        """
        Start an evaluation run.

        Expects JSON body with:
        - file_id: uploaded dataset file ID
        - evaluation_model: evaluation model name
        - evaluation_model_provider: evaluation model provider
        - default_metrics: list of default metric objects
        - customized_metrics: customized metrics object (optional)
        - judgment_config: judgment conditions config (optional)
        """
        current_account, current_tenant_id = current_account_with_tenant()

        body = request.get_json(force=True)
        if not body:
            raise BadRequest("Request body is required.")

        # Validate and parse request body
        try:
            run_request = EvaluationRunRequest.model_validate(body)
        except Exception as e:
            raise BadRequest(f"Invalid request body: {e}")

        # Load dataset file
        upload_file = (
            db.session.query(UploadFile)
            .filter_by(id=run_request.file_id, tenant_id=current_tenant_id)
            .first()
        )
        if not upload_file:
            raise NotFound("Dataset file not found.")

        try:
            dataset_content = storage.load_once(upload_file.key)
        except Exception:
            raise BadRequest("Failed to read dataset file.")

        if not dataset_content:
            raise BadRequest("Dataset file is empty.")

        try:
            with Session(db.engine, expire_on_commit=False) as session:
                evaluation_run = EvaluationService.start_evaluation_run(
                    session=session,
                    tenant_id=current_tenant_id,
                    target_type=target_type,
                    target_id=str(target.id),
                    account_id=str(current_account.id),
                    dataset_file_content=dataset_content,
                    run_request=run_request,
                )
                return _serialize_evaluation_run(evaluation_run), 200
        except EvaluationFrameworkNotConfiguredError as e:
            return {"message": str(e.description)}, 400
        except EvaluationNotFoundError as e:
            return {"message": str(e.description)}, 404
        except EvaluationMaxConcurrentRunsError as e:
            return {"message": str(e.description)}, 429
        except EvaluationDatasetInvalidError as e:
            return {"message": str(e.description)}, 400


@console_ns.route(
    "/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/runs/<uuid:run_id>"
)
class EvaluationRunDetailApi(Resource):
    @console_ns.doc("get_evaluation_run_detail")
    @console_ns.response(200, "Evaluation run detail retrieved")
    @console_ns.response(404, "Run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    def get(self, target: Union[App, CustomizedSnippet], target_type: str, run_id: str):
        """
        Get evaluation run detail including items.
        """
        _, current_tenant_id = current_account_with_tenant()
        run_id = str(run_id)
        page = request.args.get("page", 1, type=int)
        page_size = request.args.get("page_size", 50, type=int)

        try:
            with Session(db.engine, expire_on_commit=False) as session:
                run = EvaluationService.get_evaluation_run_detail(
                    session=session,
                    tenant_id=current_tenant_id,
                    run_id=run_id,
                )
                items, total_items = EvaluationService.get_evaluation_run_items(
                    session=session,
                    run_id=run_id,
                    page=page,
                    page_size=page_size,
                )

                return {
                    "run": _serialize_evaluation_run(run),
                    "items": {
                        "data": [_serialize_evaluation_run_item(item) for item in items],
                        "total": total_items,
                        "page": page,
                        "page_size": page_size,
                    },
                }
        except EvaluationNotFoundError as e:
            return {"message": str(e.description)}, 404


@console_ns.route(
    "/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/runs/<uuid:run_id>/cancel"
)
class EvaluationRunCancelApi(Resource):
    @console_ns.doc("cancel_evaluation_run")
    @console_ns.response(200, "Evaluation run cancelled")
    @console_ns.response(404, "Run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    @edit_permission_required
    def post(self, target: Union[App, CustomizedSnippet], target_type: str, run_id: str):
        """Cancel a running evaluation."""
        _, current_tenant_id = current_account_with_tenant()
        run_id = str(run_id)

        try:
            with Session(db.engine, expire_on_commit=False) as session:
                run = EvaluationService.cancel_evaluation_run(
                    session=session,
                    tenant_id=current_tenant_id,
                    run_id=run_id,
                )
                return _serialize_evaluation_run(run)
        except EvaluationNotFoundError as e:
            return {"message": str(e.description)}, 404
        except ValueError as e:
            return {"message": str(e)}, 400


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/metrics")
class EvaluationMetricsApi(Resource):
    @console_ns.doc("get_evaluation_metrics")
    @console_ns.response(200, "Available metrics retrieved")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    def get(self, target: Union[App, CustomizedSnippet], target_type: str):
        """
        Get available evaluation metrics for the current framework.
        """
        result = {}
        for category in EvaluationCategory:
            result[category.value] = EvaluationService.get_supported_metrics(category)
        return {"metrics": result}


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

        graph = {}
        if target_type == "snippets" and isinstance(target, CustomizedSnippet):
            graph = target.graph_dict

        return {
            "graph": graph,
        }


# ---- Serialization Helpers ----


def _serialize_evaluation_run(run: EvaluationRun) -> dict[str, object]:
    return {
        "id": run.id,
        "tenant_id": run.tenant_id,
        "target_type": run.target_type,
        "target_id": run.target_id,
        "evaluation_config_id": run.evaluation_config_id,
        "status": run.status,
        "dataset_file_id": run.dataset_file_id,
        "result_file_id": run.result_file_id,
        "total_items": run.total_items,
        "completed_items": run.completed_items,
        "failed_items": run.failed_items,
        "progress": run.progress,
        "metrics_summary": run.metrics_summary_dict,
        "error": run.error,
        "created_by": run.created_by,
        "started_at": int(run.started_at.timestamp()) if run.started_at else None,
        "completed_at": int(run.completed_at.timestamp()) if run.completed_at else None,
        "created_at": int(run.created_at.timestamp()) if run.created_at else None,
    }


def _serialize_evaluation_run_item(item: EvaluationRunItem) -> dict[str, object]:
    return {
        "id": item.id,
        "item_index": item.item_index,
        "inputs": item.inputs_dict,
        "expected_output": item.expected_output,
        "actual_output": item.actual_output,
        "metrics": item.metrics_list,
        "metadata": item.metadata_dict,
        "error": item.error,
        "overall_score": item.overall_score,
    }
