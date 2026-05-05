from __future__ import annotations

import logging
from collections.abc import Callable
from functools import wraps
from typing import TYPE_CHECKING, Union
from urllib.parse import quote

from flask import Response, request
from flask_restx import Resource, fields, marshal
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.workflow import WorkflowListQuery
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
)
from core.evaluation.entities.evaluation_entity import EvaluationCategory, EvaluationConfigData, EvaluationRunRequest
from extensions.ext_database import db
from extensions.ext_storage import storage
from fields.member_fields import simple_account_fields
from graphon.file import helpers as file_helpers
from libs.helper import TimestampField
from libs.login import current_account_with_tenant, login_required
from models import App, Dataset
from models.evaluation import EvaluationTargetType
from models.model import UploadFile
from models.snippet import CustomizedSnippet
from services.errors.evaluation import (
    EvaluationDatasetInvalidError,
    EvaluationFrameworkNotConfiguredError,
    EvaluationMaxConcurrentRunsError,
    EvaluationNotFoundError,
)
from services.evaluation_service import EvaluationService
from services.workflow_service import WorkflowService

if TYPE_CHECKING:
    from models.evaluation import EvaluationRun, EvaluationRunItem

logger = logging.getLogger(__name__)

EVALUATE_TARGET_TYPES = {
    EvaluationTargetType.APPS.value,
    EvaluationTargetType.SNIPPETS.value,
}


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

evaluation_default_metric_node_info_fields = {
    "node_id": fields.String,
    "type": fields.String,
    "title": fields.String,
}
evaluation_default_metric_item_fields = {
    "metric": fields.String,
    "value_type": fields.String,
    "node_info_list": fields.List(
        fields.Nested(
            console_ns.model("EvaluationDefaultMetricNodeInfo", evaluation_default_metric_node_info_fields),
        ),
    ),
}

customized_metrics_fields = {
    "evaluation_workflow_id": fields.String,
    "input_fields": fields.Raw,
    "output_fields": fields.Raw,
}

judgment_condition_fields = {
    "variable_selector": fields.List(fields.String),
    "comparison_operator": fields.String,
    "value": fields.String,
}

judgment_config_fields = {
    "logical_operator": fields.String,
    "conditions": fields.List(fields.Nested(console_ns.model("JudgmentCondition", judgment_condition_fields))),
}

evaluation_detail_fields = {
    "evaluation_model": fields.String,
    "evaluation_model_provider": fields.String,
    "default_metrics": fields.List(
        fields.Nested(console_ns.model("EvaluationDefaultMetricItem_Detail", evaluation_default_metric_item_fields)),
        allow_null=True,
    ),
    "customized_metrics": fields.Nested(
        console_ns.model("EvaluationCustomizedMetrics", customized_metrics_fields),
        allow_null=True,
    ),
    "judgment_config": fields.Nested(
        console_ns.model("EvaluationJudgmentConfig", judgment_config_fields),
        allow_null=True,
    ),
}

evaluation_detail_model = console_ns.model("EvaluationDetail", evaluation_detail_fields)

available_evaluation_workflow_list_fields = {
    "id": fields.String,
    "app_id": fields.String,
    "app_name": fields.String,
    "type": fields.String,
    "kind": fields.String,
    "version": fields.String,
    "marked_name": fields.String,
    "marked_comment": fields.String,
    "hash": fields.String,
    "created_by": fields.Nested(simple_account_fields),
    "created_at": TimestampField,
    "updated_by": fields.Nested(simple_account_fields, allow_null=True),
    "updated_at": TimestampField,
}

available_evaluation_workflow_pagination_fields = {
    "items": fields.List(fields.Nested(available_evaluation_workflow_list_fields)),
    "page": fields.Integer,
    "limit": fields.Integer,
    "has_more": fields.Boolean,
}

available_evaluation_workflow_pagination_model = console_ns.model(
    "AvailableEvaluationWorkflowPagination",
    available_evaluation_workflow_pagination_fields,
)

evaluation_default_metrics_response_model = console_ns.model(
    "EvaluationDefaultMetricsResponse",
    {
        "default_metrics": fields.List(
            fields.Nested(console_ns.model("EvaluationDefaultMetricItem", evaluation_default_metric_item_fields)),
        ),
    },
)


def get_evaluation_target[**P, R](view_func: Callable[P, R]) -> Callable[P, R]:
    """
    Decorator to resolve polymorphic evaluation target (apps or snippets).

    Validates the target_type parameter and fetches the corresponding
    model (App or CustomizedSnippet) with tenant isolation.
    """

    @wraps(view_func)
    def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
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

        if target_type == EvaluationTargetType.APPS.value:
            target = db.session.query(App).where(App.id == target_id, App.tenant_id == current_tenant_id).first()
        elif target_type == EvaluationTargetType.SNIPPETS.value:
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


def _load_evaluation_run_request_and_dataset(tenant_id: str) -> tuple[EvaluationRunRequest, bytes, str]:
    """Validate the run payload and load the uploaded dataset bytes."""
    body = request.get_json(force=True)
    if not body:
        raise BadRequest("Request body is required.")

    try:
        run_request = EvaluationRunRequest.model_validate(body)
    except Exception as e:
        raise BadRequest(f"Invalid request body: {e}")

    upload_file = db.session.query(UploadFile).filter_by(id=run_request.file_id, tenant_id=tenant_id).first()
    if not upload_file:
        raise NotFound("Dataset file not found.")

    try:
        dataset_content = storage.load_once(upload_file.key)
    except Exception:
        raise BadRequest("Failed to read dataset file.")

    if not dataset_content:
        raise BadRequest("Dataset file is empty.")

    return run_request, dataset_content, upload_file.name


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
            config = EvaluationService.get_evaluation_config(session, current_tenant_id, target_type, str(target.id))

        if config is None:
            return {
                "evaluation_model": None,
                "evaluation_model_provider": None,
                "default_metrics": None,
                "customized_metrics": None,
                "judgment_config": None,
            }

        return {
            "evaluation_model": config.evaluation_model,
            "evaluation_model_provider": config.evaluation_model_provider,
            "default_metrics": config.default_metrics_list,
            "customized_metrics": config.customized_metrics_dict,
            "judgment_config": config.judgment_config_dict,
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
        body = request.get_json(force=True)

        try:
            config_data = EvaluationConfigData.model_validate(body)
        except Exception as e:
            raise BadRequest(f"Invalid request body: {e}")

        with Session(db.engine, expire_on_commit=False) as session:
            config = EvaluationService.save_evaluation_config(
                session=session,
                tenant_id=current_tenant_id,
                target_type=target_type,
                target_id=str(target.id),
                account_id=str(current_account.id),
                data=config_data,
            )

        return {
            "evaluation_model": config.evaluation_model,
            "evaluation_model_provider": config.evaluation_model_provider,
            "default_metrics": config.default_metrics_list,
            "customized_metrics": config.customized_metrics_dict,
            "judgment_config": config.judgment_config_dict,
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
    def post(self, target: Union[App, CustomizedSnippet, Dataset], target_type: str):
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
        run_request, dataset_content, dataset_filename = _load_evaluation_run_request_and_dataset(current_tenant_id)

        try:
            with Session(db.engine, expire_on_commit=False) as session:
                if target_type == EvaluationTargetType.APPS.value:
                    evaluation_run = EvaluationService.start_stub_evaluation_run(
                        session=session,
                        tenant_id=current_tenant_id,
                        target_type=target_type,
                        target_id=str(target.id),
                        account_id=str(current_account.id),
                        dataset_file_content=dataset_content,
                        dataset_filename=dataset_filename,
                        run_request=run_request,
                    )
                else:
                    evaluation_run = EvaluationService.start_evaluation_run(
                        session=session,
                        tenant_id=current_tenant_id,
                        target_type=target_type,
                        target_id=str(target.id),
                        account_id=str(current_account.id),
                        dataset_file_content=dataset_content,
                        dataset_filename=dataset_filename,
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


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/run1")
class EvaluationRunRealApi(Resource):
    @console_ns.doc("start_evaluation_run_real")
    @console_ns.response(200, "Evaluation run started")
    @console_ns.response(400, "Invalid request")
    @console_ns.response(404, "Target not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    @edit_permission_required
    def post(self, target: Union[App, CustomizedSnippet, Dataset], target_type: str):
        """Start the real evaluation execution flow on the temporary dev path."""
        current_account, current_tenant_id = current_account_with_tenant()
        run_request, dataset_content, dataset_filename = _load_evaluation_run_request_and_dataset(current_tenant_id)

        try:
            with Session(db.engine, expire_on_commit=False) as session:
                evaluation_run = EvaluationService.start_evaluation_run(
                    session=session,
                    tenant_id=current_tenant_id,
                    target_type=target_type,
                    target_id=str(target.id),
                    account_id=str(current_account.id),
                    dataset_file_content=dataset_content,
                    dataset_filename=dataset_filename,
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


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/runs/<uuid:run_id>")
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


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/runs/<uuid:run_id>/cancel")
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


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/default-metrics")
class EvaluationDefaultMetricsApi(Resource):
    @console_ns.doc(
        "get_evaluation_default_metrics_with_nodes",
        description=(
            "List default metrics supported by the current evaluation framework with matching nodes "
            "from the target's published workflow only (draft is ignored)."
        ),
    )
    @console_ns.response(
        200,
        "Default metrics and node candidates for the published workflow",
        evaluation_default_metrics_response_model,
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    def get(self, target: Union[App, CustomizedSnippet], target_type: str):
        default_metrics = EvaluationService.get_default_metrics_with_nodes_for_published_target(
            target=target,
            target_type=target_type,
        )
        return {"default_metrics": [m.model_dump() for m in default_metrics]}


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/node-info")
class EvaluationNodeInfoApi(Resource):
    @console_ns.doc("get_evaluation_node_info")
    @console_ns.response(200, "Node info grouped by metric")
    @console_ns.response(404, "Target not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_evaluation_target
    def post(self, target: Union[App, CustomizedSnippet], target_type: str):
        """Return workflow/snippet node info grouped by requested metrics.

        Request body (JSON):
            - metrics: list[str] | None  – metric names to query; omit or pass
              an empty list to get all nodes under key ``"all"``.

        Response:
            ``{metric_or_all: [{"node_id": ..., "type": ..., "title": ...}, ...]}``
        """
        body = request.get_json(silent=True) or {}
        metrics: list[str] | None = body.get("metrics") or None

        result = EvaluationService.get_nodes_for_metrics(
            target=target,
            target_type=target_type,
            metrics=metrics,
        )
        return result


@console_ns.route("/evaluation/available-metrics")
class EvaluationAvailableMetricsApi(Resource):
    @console_ns.doc("get_available_evaluation_metrics")
    @console_ns.response(200, "Available metrics list")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """Return the centrally-defined list of evaluation metrics."""
        return {"metrics": EvaluationService.get_available_metrics()}


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
        if target_type == EvaluationTargetType.SNIPPETS.value and isinstance(target, CustomizedSnippet):
            graph = target.graph_dict

        return {
            "graph": graph,
        }


@console_ns.route("/workspaces/current/available-evaluation-workflows")
class AvailableEvaluationWorkflowsApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowListQuery.__name__])
    @console_ns.doc("list_available_evaluation_workflows")
    @console_ns.doc(description="List published evaluation workflows in the current workspace (all apps)")
    @console_ns.response(
        200,
        "Available evaluation workflows retrieved",
        available_evaluation_workflow_pagination_model,
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self):
        """List published evaluation-type workflows for the current tenant (cross-app)."""
        current_user, current_tenant_id = current_account_with_tenant()

        args = WorkflowListQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore
        page = args.page
        limit = args.limit
        user_id = args.user_id
        named_only = args.named_only
        keyword = args.keyword

        if user_id and user_id != current_user.id:
            raise Forbidden()

        workflow_service = WorkflowService()
        with Session(db.engine) as session:
            workflows, has_more = workflow_service.list_published_evaluation_workflows(
                session=session,
                tenant_id=current_tenant_id,
                page=page,
                limit=limit,
                user_id=user_id,
                named_only=named_only,
                keyword=keyword,
            )

            app_ids = {w.app_id for w in workflows}
            if app_ids:
                apps = session.scalars(select(App).where(App.id.in_(app_ids))).all()
                app_names = {a.id: a.name for a in apps}
            else:
                app_names = {}

        items = []
        for wf in workflows:
            items.append(
                {
                    "id": wf.id,
                    "app_id": wf.app_id,
                    "app_name": app_names.get(wf.app_id, ""),
                    "type": wf.type.value,
                    "kind": wf.kind_or_standard,
                    "version": wf.version,
                    "marked_name": wf.marked_name,
                    "marked_comment": wf.marked_comment,
                    "hash": wf.unique_hash,
                    "created_by": wf.created_by_account,
                    "created_at": wf.created_at,
                    "updated_by": wf.updated_by_account,
                    "updated_at": wf.updated_at,
                }
            )

        return (
            marshal(
                {"items": items, "page": page, "limit": limit, "has_more": has_more},
                available_evaluation_workflow_pagination_fields,
            ),
            200,
        )


@console_ns.route("/workspaces/current/evaluation-workflows/<string:workflow_id>/associated-targets")
class EvaluationWorkflowAssociatedTargetsApi(Resource):
    @console_ns.doc("list_evaluation_workflow_associated_targets")
    @console_ns.doc(
        description="List targets (apps / snippets / knowledge bases) that use the given workflow as customized metrics"
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def get(self, workflow_id: str):
        """Return all evaluation targets that reference this workflow as customized metrics."""
        _, current_tenant_id = current_account_with_tenant()

        with Session(db.engine) as session:
            configs = EvaluationService.list_targets_by_customized_workflow(
                session=session,
                tenant_id=current_tenant_id,
                customized_workflow_id=workflow_id,
            )

            target_ids_by_type: dict[str, list[str]] = {}
            for cfg in configs:
                target_ids_by_type.setdefault(cfg.target_type, []).append(cfg.target_id)

            app_names: dict[str, str] = {}
            if EvaluationTargetType.APPS.value in target_ids_by_type:
                apps = session.scalars(
                    select(App).where(App.id.in_(target_ids_by_type[EvaluationTargetType.APPS.value]))
                ).all()
                app_names = {a.id: a.name for a in apps}

            snippet_names: dict[str, str] = {}
            if "snippets" in target_ids_by_type:
                snippets = session.scalars(
                    select(CustomizedSnippet).where(CustomizedSnippet.id.in_(target_ids_by_type["snippets"]))
                ).all()
                snippet_names = {s.id: s.name for s in snippets}

            dataset_names: dict[str, str] = {}
            if "knowledge_base" in target_ids_by_type:
                datasets = session.scalars(
                    select(Dataset).where(Dataset.id.in_(target_ids_by_type["knowledge_base"]))
                ).all()
                dataset_names = {d.id: d.name for d in datasets}

        items = []
        for cfg in configs:
            name = ""
            if cfg.target_type == EvaluationTargetType.APPS.value:
                name = app_names.get(cfg.target_id, "")
            elif cfg.target_type == EvaluationTargetType.SNIPPETS.value:
                name = snippet_names.get(cfg.target_id, "")
            elif cfg.target_type == "knowledge_base":
                name = dataset_names.get(cfg.target_id, "")

            items.append(
                {
                    "target_type": cfg.target_type,
                    "target_id": cfg.target_id,
                    "target_name": name,
                }
            )

        return {"items": items}, 200


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
        "judgment": item.judgment_dict,
        "metadata": item.metadata_dict,
        "error": item.error,
        "overall_score": item.overall_score,
    }
