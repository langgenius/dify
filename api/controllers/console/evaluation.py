from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from functools import wraps
from typing import Any, ParamSpec, TypeVar, cast
from urllib.parse import quote
from uuid import UUID

from flask import Response, request
from flask_restx import Resource
from pydantic import AliasChoices, BaseModel, Field, RootModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, NotFound, TooManyRequests

import services
from configs import dify_config
from controllers.common.rbac import DatasetId, PlainApp, RBACCheck, Workspace, enforce_rbac_checks
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
)
from core.evaluation.entities.evaluation_entity import (
    CustomizedMetrics,
    DefaultMetric,
    EvaluationCategory,
    EvaluationConfigData,
    EvaluationMetric,
    EvaluationRunRequest,
    NodeInfo,
)
from core.evaluation.entities.judgment_entity import JudgmentConfig
from extensions.ext_storage import storage
from fields.base import ResponseModel
from fields.member_fields import SimpleAccount
from graphon.file import helpers as file_helpers
from libs.helper import dump_response, to_timestamp
from libs.login import current_account_with_tenant, login_required
from models import Account, App, Dataset, UploadFile
from models.evaluation import EvaluationConfiguration, EvaluationRun, EvaluationTargetType
from models.model import AppMode
from models.snippet import CustomizedSnippet
from models.workflow import WorkflowKind, WorkflowType
from services.dataset_service import DatasetService
from services.errors.evaluation import (
    EvaluationDatasetInvalidError,
    EvaluationFrameworkNotConfiguredError,
    EvaluationMaxConcurrentRunsError,
    EvaluationNotFoundError,
)
from services.evaluation_service import EvaluationService
from services.workflow_service import WorkflowService

P = ParamSpec("P")
R = TypeVar("R")
EvaluationTarget = App | CustomizedSnippet


class EvaluationConfigPayload(EvaluationConfigData):
    pass


class EvaluationRunPayload(EvaluationRunRequest):
    pass


class EvaluationNodeInfoPayload(BaseModel):
    metrics: list[str] = Field(default_factory=list)


class EvaluationRunListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    page_size: int = Field(default=20, ge=1, le=100)


class EvaluationRunDetailQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    page_size: int = Field(default=50, ge=1, le=100)


class AvailableEvaluationWorkflowQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=10, ge=1, le=100)
    user_id: str | None = None
    named_only: bool = False
    keyword: str | None = Field(default=None, max_length=255)


class EvaluationConfigResponse(ResponseModel):
    evaluation_model: str | None = None
    evaluation_model_provider: str | None = None
    default_metrics: list[DefaultMetric] | None = None
    customized_metrics: CustomizedMetrics | None = None
    judgment_config: JudgmentConfig | None = None


class EvaluationTemplateColumnResponse(ResponseModel):
    name: str
    type: str


class EvaluationTemplateColumnsResponse(ResponseModel):
    columns: list[EvaluationTemplateColumnResponse]


class EvaluationRunResponse(ResponseModel):
    id: str
    tenant_id: str
    target_type: str
    target_id: str
    target_workflow_version_id: str | None = None
    evaluation_config_id: str
    status: str
    dataset_file_id: str | None = None
    result_file_id: str | None = None
    total_items: int
    completed_items: int
    failed_items: int
    progress: float
    metrics_summary: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("metrics_summary_dict", "metrics_summary"),
    )
    error: str | None = None
    created_by: str
    started_at: int | None = None
    completed_at: int | None = None
    created_at: int | None = None

    @field_validator("started_at", "completed_at", "created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class EvaluationRunItemResponse(ResponseModel):
    id: str
    item_index: int
    workflow_run_id: str | None = None
    inputs: dict[str, Any] = Field(default_factory=dict, validation_alias=AliasChoices("inputs_dict", "inputs"))
    expected_output: str | None = None
    actual_output: str | None = None
    metrics: list[EvaluationMetric] = Field(
        default_factory=list,
        validation_alias=AliasChoices("metrics_list", "metrics"),
    )
    judgment: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("judgment_dict", "judgment"),
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("metadata_dict", "metadata"),
    )
    error: str | None = None
    overall_score: float | None = None


class EvaluationRunPaginationResponse(ResponseModel):
    data: list[EvaluationRunResponse]
    total: int
    page: int
    page_size: int


class EvaluationRunItemPaginationResponse(ResponseModel):
    data: list[EvaluationRunItemResponse]
    total: int
    page: int
    page_size: int


class EvaluationRunDetailResponse(ResponseModel):
    run: EvaluationRunResponse
    items: EvaluationRunItemPaginationResponse


class EvaluationMetricsResponse(ResponseModel):
    metrics: dict[str, list[str]] | list[str]


class EvaluationDefaultMetricsResponse(ResponseModel):
    default_metrics: list[DefaultMetric]


class EvaluationAvailableMetricsResponse(ResponseModel):
    metrics: list[str]


class EvaluationNodeInfoResponse(RootModel[dict[str, list[NodeInfo]]]):
    pass


class EvaluationFileResponse(ResponseModel):
    id: str
    name: str
    size: int
    extension: str
    mime_type: str
    created_at: int | None = None
    download_url: str

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AvailableEvaluationWorkflowResponse(ResponseModel):
    id: str
    app_id: str
    app_name: str
    type: str
    kind: str
    version: str
    marked_name: str
    marked_comment: str
    hash: str
    created_by: SimpleAccount | None = None
    created_at: int
    updated_by: SimpleAccount | None = None
    updated_at: int

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int:
        timestamp = to_timestamp(value)
        if timestamp is None:
            raise ValueError("timestamp is required")
        return timestamp


class AvailableEvaluationWorkflowPaginationResponse(ResponseModel):
    items: list[AvailableEvaluationWorkflowResponse]
    page: int
    limit: int
    has_more: bool


class EvaluationAssociatedTargetResponse(ResponseModel):
    target_type: str
    target_id: str
    target_name: str


class EvaluationAssociatedTargetListResponse(ResponseModel):
    items: list[EvaluationAssociatedTargetResponse]


register_schema_models(
    console_ns,
    EvaluationConfigPayload,
    EvaluationRunPayload,
    EvaluationNodeInfoPayload,
    EvaluationRunListQuery,
    EvaluationRunDetailQuery,
    AvailableEvaluationWorkflowQuery,
)
register_response_schema_models(
    console_ns,
    EvaluationConfigResponse,
    EvaluationTemplateColumnsResponse,
    EvaluationRunResponse,
    EvaluationRunPaginationResponse,
    EvaluationRunDetailResponse,
    EvaluationMetricsResponse,
    EvaluationDefaultMetricsResponse,
    EvaluationAvailableMetricsResponse,
    EvaluationNodeInfoResponse,
    EvaluationFileResponse,
    AvailableEvaluationWorkflowPaginationResponse,
    EvaluationAssociatedTargetListResponse,
)


def evaluation_target_required(
    *,
    app_permission: RBACPermission,
    snippet_permission: RBACPermission = RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Resolve an app/snippet target with tenant and dynamic RBAC checks."""

    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            session = cast(Session, args[1])
            target_type = str(kwargs.pop("evaluate_target_type"))
            target_id = str(kwargs.pop("evaluate_target_id"))
            current_user, tenant_id = current_account_with_tenant()

            if target_type == EvaluationTargetType.APPS.value:
                enforce_rbac_checks(
                    tenant_id=tenant_id,
                    account_id=current_user.id,
                    checks=[RBACCheck(app_permission, PlainApp("evaluate_target_id"))],
                    path_args={"evaluate_target_id": target_id},
                )
                target: EvaluationTarget | None = session.scalar(
                    select(App).where(
                        App.id == target_id,
                        App.tenant_id == tenant_id,
                        App.status == "normal",
                    )
                )
            elif target_type == EvaluationTargetType.SNIPPETS.value:
                enforce_rbac_checks(
                    tenant_id=tenant_id,
                    account_id=current_user.id,
                    checks=[RBACCheck(snippet_permission, Workspace())],
                )
                target = session.scalar(
                    select(CustomizedSnippet).where(
                        CustomizedSnippet.id == target_id,
                        CustomizedSnippet.tenant_id == tenant_id,
                    )
                )
            else:
                raise NotFound("Evaluation target not found.")

            if target is None:
                raise NotFound("Evaluation target not found.")
            if isinstance(target, App) and AppMode.value_of(target.mode) != AppMode.WORKFLOW:
                raise BadRequest("Only workflow apps support evaluation.")

            kwargs["target"] = target
            kwargs["target_type"] = target_type
            return view(*args, **kwargs)

        return wrapper

    return decorator


def _get_accessible_dataset(
    session: Session,
    dataset_id: UUID,
    current_user: Account,
    tenant_id: str,
) -> Dataset:
    dataset = DatasetService.get_dataset_for_tenant(str(dataset_id), tenant_id, session=session)
    if dataset is None:
        raise NotFound("Dataset not found.")
    if not dify_config.RBAC_ENABLED:
        try:
            DatasetService.check_dataset_permission(dataset, current_user, session)
        except services.errors.account.NoPermissionError as exc:
            raise Forbidden(str(exc)) from exc
    return dataset


def _config_response(config: EvaluationConfiguration | None, *, target_type: str) -> dict[str, Any]:
    if config is None:
        return dump_response(EvaluationConfigResponse, {})

    default_metrics = config.default_metrics_list
    if target_type != EvaluationTargetType.KNOWLEDGE_BASE.value:
        default_metrics = EvaluationService.serialize_console_default_metrics(default_metrics)

    return dump_response(
        EvaluationConfigResponse,
        {
            "evaluation_model": config.evaluation_model,
            "evaluation_model_provider": config.evaluation_model_provider,
            "default_metrics": default_metrics,
            "customized_metrics": config.customized_metrics_dict,
            "judgment_config": EvaluationService.serialize_console_judgment_config(config.judgment_config_dict),
        },
    )


def _load_evaluation_dataset(
    *,
    session: Session,
    tenant_id: str,
    file_id: str,
) -> tuple[bytes, str]:
    upload_file = session.scalar(select(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == tenant_id))
    if upload_file is None:
        raise NotFound("Evaluation dataset file not found.")
    try:
        content = storage.load_once(upload_file.key)
    except Exception as exc:
        raise BadRequest("Failed to read evaluation dataset file.") from exc
    if not content:
        raise BadRequest("Evaluation dataset file is empty.")
    return content, upload_file.name


def _start_run(
    *,
    session: Session,
    tenant_id: str,
    target_type: str,
    target_id: str,
    account_id: str,
    payload: EvaluationRunPayload,
) -> EvaluationRun:
    dataset_content, dataset_filename = _load_evaluation_dataset(
        session=session,
        tenant_id=tenant_id,
        file_id=payload.file_id,
    )
    try:
        return EvaluationService.start_evaluation_run(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target_id,
            account_id=account_id,
            dataset_file_content=dataset_content,
            dataset_filename=dataset_filename,
            run_request=payload,
        )
    except EvaluationFrameworkNotConfiguredError as exc:
        raise BadRequest(exc.description) from exc
    except EvaluationDatasetInvalidError as exc:
        raise BadRequest(exc.description) from exc
    except EvaluationNotFoundError as exc:
        raise NotFound(exc.description) from exc
    except EvaluationMaxConcurrentRunsError as exc:
        raise TooManyRequests(exc.description) from exc
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc


def _run_detail(
    *,
    session: Session,
    tenant_id: str,
    target_type: str,
    target_id: str,
    run_id: str,
    query: EvaluationRunDetailQuery,
) -> dict[str, Any]:
    try:
        run = EvaluationService.get_evaluation_run_detail(
            session,
            tenant_id,
            target_type,
            target_id,
            run_id,
        )
        items, total = EvaluationService.get_evaluation_run_items(
            session,
            tenant_id,
            target_type,
            target_id,
            run_id,
            query.page,
            query.page_size,
        )
    except EvaluationNotFoundError as exc:
        raise NotFound(exc.description) from exc

    return dump_response(
        EvaluationRunDetailResponse,
        {
            "run": run,
            "items": {
                "data": items,
                "total": total,
                "page": query.page,
                "page_size": query.page_size,
            },
        },
    )


def _cancel_run(
    *,
    session: Session,
    tenant_id: str,
    target_type: str,
    target_id: str,
    run_id: str,
) -> dict[str, Any]:
    try:
        run = EvaluationService.cancel_evaluation_run(
            session,
            tenant_id,
            target_type,
            target_id,
            run_id,
        )
    except EvaluationNotFoundError as exc:
        raise NotFound(exc.description) from exc
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
    return dump_response(EvaluationRunResponse, run)


def _retry_run(
    *,
    session: Session,
    tenant_id: str,
    target_type: str,
    target_id: str,
    run_id: str,
) -> dict[str, Any]:
    try:
        existing_run = EvaluationService.get_evaluation_run_detail(
            session,
            tenant_id,
            target_type,
            target_id,
            run_id,
        )
        if not existing_run.dataset_file_id:
            raise BadRequest("Evaluation run has no dataset file to retry.")
        dataset_content, dataset_filename = _load_evaluation_dataset(
            session=session,
            tenant_id=tenant_id,
            file_id=existing_run.dataset_file_id,
        )
        run = EvaluationService.retry_evaluation_run(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target_id,
            run_id=run_id,
            dataset_file_content=dataset_content,
            dataset_filename=dataset_filename,
        )
    except EvaluationFrameworkNotConfiguredError as exc:
        raise BadRequest(exc.description) from exc
    except EvaluationDatasetInvalidError as exc:
        raise BadRequest(exc.description) from exc
    except EvaluationNotFoundError as exc:
        raise NotFound(exc.description) from exc
    except EvaluationMaxConcurrentRunsError as exc:
        raise TooManyRequests(exc.description) from exc
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
    return dump_response(EvaluationRunResponse, run)


def _evaluation_file_response(
    *,
    session: Session,
    tenant_id: str,
    target_type: str,
    target_id: str,
    file_id: str,
) -> dict[str, Any]:
    try:
        upload_file = EvaluationService.get_evaluation_file(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target_id,
            file_id=file_id,
        )
    except EvaluationNotFoundError as exc:
        raise NotFound(exc.description) from exc
    return dump_response(
        EvaluationFileResponse,
        {
            "id": upload_file.id,
            "name": upload_file.name,
            "size": upload_file.size,
            "extension": upload_file.extension,
            "mime_type": upload_file.mime_type,
            "created_at": upload_file.created_at,
            "download_url": file_helpers.get_signed_file_url(upload_file_id=upload_file.id, as_attachment=True),
        },
    )


def _xlsx_response(content: bytes, filename: str) -> Response:
    response = Response(
        content,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(filename)}"
    response.headers["Content-Length"] = str(len(content))
    return response


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/dataset-template/download")
class EvaluationDatasetTemplateDownloadApi(Resource):
    @console_ns.response(200, "Evaluation dataset template")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_session(write=False)
    @evaluation_target_required(
        app_permission=RBACPermission.APP_VIEW_LAYOUT,
        snippet_permission=RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
    )
    def post(self, session: Session, target: EvaluationTarget, target_type: str) -> Response:
        try:
            content, filename = EvaluationService.generate_dataset_template(target, target_type, session)
        except ValueError as exc:
            raise BadRequest(str(exc)) from exc
        return _xlsx_response(content, filename)


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation")
class EvaluationDetailApi(Resource):
    @console_ns.response(200, "Evaluation configuration", console_ns.models[EvaluationConfigResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_session(write=False)
    @evaluation_target_required(app_permission=RBACPermission.APP_VIEW_LAYOUT)
    def get(self, session: Session, target: EvaluationTarget, target_type: str) -> dict[str, Any]:
        _, tenant_id = current_account_with_tenant()
        config = EvaluationService.get_evaluation_config(session, tenant_id, target_type, target.id)
        return _config_response(config, target_type=target_type)

    @console_ns.expect(console_ns.models[EvaluationConfigPayload.__name__])
    @console_ns.response(200, "Evaluation configuration saved", console_ns.models[EvaluationConfigResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_session
    @evaluation_target_required(
        app_permission=RBACPermission.APP_EDIT,
        snippet_permission=RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
    )
    def put(self, session: Session, target: EvaluationTarget, target_type: str) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        payload = EvaluationConfigPayload.model_validate(console_ns.payload or {})
        try:
            config = EvaluationService.save_evaluation_config(
                session,
                tenant_id,
                target_type,
                target.id,
                current_user.id,
                payload,
            )
        except ValueError as exc:
            raise BadRequest(str(exc)) from exc
        return _config_response(config, target_type=target_type)


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/template-columns")
class EvaluationTemplateColumnsApi(Resource):
    @console_ns.expect(console_ns.models[EvaluationConfigPayload.__name__])
    @console_ns.response(
        200,
        "Evaluation template columns",
        console_ns.models[EvaluationTemplateColumnsResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_session(write=False)
    @evaluation_target_required(app_permission=RBACPermission.APP_VIEW_LAYOUT)
    def post(self, session: Session, target: EvaluationTarget, target_type: str) -> dict[str, Any]:
        payload = EvaluationConfigPayload.model_validate(console_ns.payload or {})
        try:
            columns = EvaluationService.get_dataset_column_names(target, target_type, payload, session)
        except ValueError as exc:
            raise BadRequest(str(exc)) from exc
        return dump_response(EvaluationTemplateColumnsResponse, {"columns": columns})


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/logs")
class EvaluationLogsApi(Resource):
    @console_ns.doc(params=query_params_from_model(EvaluationRunListQuery))
    @console_ns.response(200, "Evaluation runs", console_ns.models[EvaluationRunPaginationResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_session(write=False)
    @evaluation_target_required(app_permission=RBACPermission.APP_VIEW_LAYOUT)
    def get(self, session: Session, target: EvaluationTarget, target_type: str) -> dict[str, Any]:
        _, tenant_id = current_account_with_tenant()
        query = EvaluationRunListQuery.model_validate(request.args.to_dict(flat=True))
        runs, total = EvaluationService.get_evaluation_runs(
            session,
            tenant_id,
            target_type,
            target.id,
            query.page,
            query.page_size,
        )
        return dump_response(
            EvaluationRunPaginationResponse,
            {"data": runs, "total": total, "page": query.page, "page_size": query.page_size},
        )


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/run")
class EvaluationRunApi(Resource):
    @console_ns.expect(console_ns.models[EvaluationRunPayload.__name__])
    @console_ns.response(200, "Evaluation run started", console_ns.models[EvaluationRunResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_session
    @evaluation_target_required(
        app_permission=RBACPermission.APP_TEST_AND_RUN,
        snippet_permission=RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
    )
    def post(self, session: Session, target: EvaluationTarget, target_type: str) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        payload = EvaluationRunPayload.model_validate(console_ns.payload or {})
        run = _start_run(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target.id,
            account_id=current_user.id,
            payload=payload,
        )
        return dump_response(EvaluationRunResponse, run)


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/runs/<uuid:run_id>")
class EvaluationRunDetailApi(Resource):
    @console_ns.doc(params=query_params_from_model(EvaluationRunDetailQuery))
    @console_ns.response(200, "Evaluation run detail", console_ns.models[EvaluationRunDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_session(write=False)
    @evaluation_target_required(app_permission=RBACPermission.APP_VIEW_LAYOUT)
    def get(
        self,
        session: Session,
        target: EvaluationTarget,
        target_type: str,
        run_id: UUID,
    ) -> dict[str, Any]:
        _, tenant_id = current_account_with_tenant()
        query = EvaluationRunDetailQuery.model_validate(request.args.to_dict(flat=True))
        return _run_detail(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target.id,
            run_id=str(run_id),
            query=query,
        )


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/runs/<uuid:run_id>/cancel")
class EvaluationRunCancelApi(Resource):
    @console_ns.response(200, "Evaluation run cancelled", console_ns.models[EvaluationRunResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_session
    @evaluation_target_required(
        app_permission=RBACPermission.APP_TEST_AND_RUN,
        snippet_permission=RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
    )
    def post(
        self,
        session: Session,
        target: EvaluationTarget,
        target_type: str,
        run_id: UUID,
    ) -> dict[str, Any]:
        _, tenant_id = current_account_with_tenant()
        return _cancel_run(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target.id,
            run_id=str(run_id),
        )


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/runs/<uuid:run_id>/retry")
class EvaluationRunRetryApi(Resource):
    @console_ns.response(200, "Evaluation run retry scheduled", console_ns.models[EvaluationRunResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_session
    @evaluation_target_required(
        app_permission=RBACPermission.APP_TEST_AND_RUN,
        snippet_permission=RBACPermission.SNIPPETS_CREATE_AND_MODIFY,
    )
    def post(
        self,
        session: Session,
        target: EvaluationTarget,
        target_type: str,
        run_id: UUID,
    ) -> dict[str, Any]:
        _, tenant_id = current_account_with_tenant()
        return _retry_run(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target.id,
            run_id=str(run_id),
        )


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/metrics")
class EvaluationMetricsApi(Resource):
    @console_ns.response(200, "Evaluation metrics", console_ns.models[EvaluationMetricsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_session(write=False)
    @evaluation_target_required(app_permission=RBACPermission.APP_VIEW_LAYOUT)
    def get(self, session: Session, target: EvaluationTarget, target_type: str) -> dict[str, Any]:
        metrics = {
            category.value: EvaluationService.get_supported_metrics(category)
            for category in (EvaluationCategory.LLM, EvaluationCategory.RETRIEVAL)
        }
        return dump_response(EvaluationMetricsResponse, {"metrics": metrics})


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/default-metrics")
class EvaluationDefaultMetricsApi(Resource):
    @console_ns.response(200, "Default metrics", console_ns.models[EvaluationDefaultMetricsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_session(write=False)
    @evaluation_target_required(app_permission=RBACPermission.APP_VIEW_LAYOUT)
    def get(self, session: Session, target: EvaluationTarget, target_type: str) -> dict[str, Any]:
        metrics = EvaluationService.get_default_metrics_with_nodes_for_published_target(
            target,
            target_type,
            session,
        )
        return dump_response(
            EvaluationDefaultMetricsResponse,
            {"default_metrics": EvaluationService.filter_console_default_metrics(metrics)},
        )


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/node-info")
class EvaluationNodeInfoApi(Resource):
    @console_ns.expect(console_ns.models[EvaluationNodeInfoPayload.__name__])
    @console_ns.response(200, "Evaluation node info", console_ns.models[EvaluationNodeInfoResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_session(write=False)
    @evaluation_target_required(app_permission=RBACPermission.APP_VIEW_LAYOUT)
    def post(self, session: Session, target: EvaluationTarget, target_type: str) -> dict[str, Any]:
        payload = EvaluationNodeInfoPayload.model_validate(console_ns.payload or {})
        nodes = EvaluationService.get_nodes_for_metrics(
            target,
            target_type,
            session,
            payload.metrics or None,
        )
        return EvaluationNodeInfoResponse.model_validate(nodes).model_dump(mode="json")


@console_ns.route("/evaluation/available-metrics")
class EvaluationAvailableMetricsApi(Resource):
    @console_ns.response(
        200,
        "Available evaluation metrics",
        console_ns.models[EvaluationAvailableMetricsResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self) -> dict[str, Any]:
        return dump_response(
            EvaluationAvailableMetricsResponse,
            {"metrics": EvaluationService.get_available_metrics()},
        )


@console_ns.route("/<string:evaluate_target_type>/<uuid:evaluate_target_id>/evaluation/files/<uuid:file_id>")
class EvaluationFileDownloadApi(Resource):
    @console_ns.response(200, "Evaluation file", console_ns.models[EvaluationFileResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_session(write=False)
    @evaluation_target_required(app_permission=RBACPermission.APP_VIEW_LAYOUT)
    def get(
        self,
        session: Session,
        target: EvaluationTarget,
        target_type: str,
        file_id: UUID,
    ) -> dict[str, Any]:
        _, tenant_id = current_account_with_tenant()
        return _evaluation_file_response(
            session=session,
            tenant_id=tenant_id,
            target_type=target_type,
            target_id=target.id,
            file_id=str(file_id),
        )


@console_ns.route("/workspaces/current/available-evaluation-workflows")
class AvailableEvaluationWorkflowsApi(Resource):
    @console_ns.doc(params=query_params_from_model(AvailableEvaluationWorkflowQuery))
    @console_ns.response(
        200,
        "Available evaluation workflows",
        console_ns.models[AvailableEvaluationWorkflowPaginationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_session(write=False)
    def get(self, session: Session) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        query = AvailableEvaluationWorkflowQuery.model_validate(request.args.to_dict(flat=True))
        if query.user_id and query.user_id != current_user.id:
            raise Forbidden()

        workflows, has_more = WorkflowService().list_published_evaluation_workflows(
            session=session,
            tenant_id=tenant_id,
            page=query.page,
            limit=query.limit,
            user_id=query.user_id,
            named_only=query.named_only,
            keyword=query.keyword,
        )
        app_names = {
            app.id: app.name
            for app in session.scalars(
                select(App).where(App.tenant_id == tenant_id, App.id.in_({workflow.app_id for workflow in workflows}))
            ).all()
        }
        items = [
            {
                "id": workflow.id,
                "app_id": workflow.app_id,
                "app_name": app_names.get(workflow.app_id, ""),
                "type": workflow.type.value,
                "kind": workflow.resolved_kind.value,
                "version": workflow.version,
                "marked_name": workflow.marked_name,
                "marked_comment": workflow.marked_comment,
                "hash": workflow.unique_hash,
                "created_by": workflow.get_created_by_account(session=session),
                "created_at": workflow.created_at,
                "updated_by": workflow.get_updated_by_account(session=session),
                "updated_at": workflow.updated_at,
            }
            for workflow in workflows
        ]
        return dump_response(
            AvailableEvaluationWorkflowPaginationResponse,
            {"items": items, "page": query.page, "limit": query.limit, "has_more": has_more},
        )


@console_ns.route("/workspaces/current/evaluation-workflows/<uuid:workflow_id>/associated-targets")
class EvaluationWorkflowAssociatedTargetsApi(Resource):
    @console_ns.response(
        200,
        "Associated evaluation targets",
        console_ns.models[EvaluationAssociatedTargetListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_session(write=False)
    def get(self, session: Session, workflow_id: UUID) -> dict[str, Any]:
        _, tenant_id = current_account_with_tenant()
        evaluator_app = session.scalar(
            select(App).where(
                App.id == str(workflow_id),
                App.tenant_id == tenant_id,
                App.status == "normal",
            )
        )
        evaluator_workflow = (
            WorkflowService().get_published_workflow(app_model=evaluator_app, session=session)
            if evaluator_app is not None
            else None
        )
        if (
            evaluator_workflow is None
            or evaluator_workflow.type != WorkflowType.WORKFLOW
            or evaluator_workflow.resolved_kind != WorkflowKind.EVALUATION
        ):
            raise NotFound("Evaluation workflow not found.")
        configs = EvaluationService.list_targets_by_customized_workflow(session, tenant_id, str(workflow_id))

        ids_by_type: dict[str, set[str]] = {}
        for config in configs:
            ids_by_type.setdefault(config.target_type.value, set()).add(config.target_id)

        names: dict[tuple[str, str], str] = {}
        app_ids = ids_by_type.get(EvaluationTargetType.APPS.value, set())
        if app_ids:
            for app in session.scalars(select(App).where(App.tenant_id == tenant_id, App.id.in_(app_ids))).all():
                names[(EvaluationTargetType.APPS.value, app.id)] = app.name
        snippet_ids = ids_by_type.get(EvaluationTargetType.SNIPPETS.value, set())
        if snippet_ids:
            for snippet in session.scalars(
                select(CustomizedSnippet).where(
                    CustomizedSnippet.tenant_id == tenant_id,
                    CustomizedSnippet.id.in_(snippet_ids),
                )
            ).all():
                names[(EvaluationTargetType.SNIPPETS.value, snippet.id)] = snippet.name
        dataset_ids = ids_by_type.get(EvaluationTargetType.KNOWLEDGE_BASE.value, set())
        if dataset_ids:
            for dataset in session.scalars(
                select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id.in_(dataset_ids))
            ).all():
                names[(EvaluationTargetType.KNOWLEDGE_BASE.value, dataset.id)] = dataset.name

        items = [
            {
                "target_type": config.target_type.value,
                "target_id": config.target_id,
                "target_name": names.get((config.target_type.value, config.target_id), ""),
            }
            for config in configs
        ]
        return dump_response(EvaluationAssociatedTargetListResponse, {"items": items})


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/template/download")
class DatasetEvaluationTemplateDownloadApi(Resource):
    @console_ns.response(200, "Knowledge base evaluation template")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()))
    @with_session(write=False)
    def post(self, session: Session, dataset_id: UUID) -> Response:
        current_user, tenant_id = current_account_with_tenant()
        _get_accessible_dataset(session, dataset_id, current_user, tenant_id)
        content, filename = EvaluationService.generate_retrieval_dataset_template()
        return _xlsx_response(content, filename)


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation")
class DatasetEvaluationDetailApi(Resource):
    @console_ns.response(200, "Evaluation configuration", console_ns.models[EvaluationConfigResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()))
    @with_session(write=False)
    def get(self, session: Session, dataset_id: UUID) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        dataset = _get_accessible_dataset(session, dataset_id, current_user, tenant_id)
        config = EvaluationService.get_evaluation_config(
            session,
            tenant_id,
            EvaluationTargetType.KNOWLEDGE_BASE.value,
            dataset.id,
        )
        return _config_response(config, target_type=EvaluationTargetType.KNOWLEDGE_BASE.value)

    @console_ns.expect(console_ns.models[EvaluationConfigPayload.__name__])
    @console_ns.response(200, "Evaluation configuration saved", console_ns.models[EvaluationConfigResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_EDIT, DatasetId()))
    @with_session
    def put(self, session: Session, dataset_id: UUID) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        dataset = _get_accessible_dataset(session, dataset_id, current_user, tenant_id)
        payload = EvaluationConfigPayload.model_validate(console_ns.payload or {})
        try:
            config = EvaluationService.save_evaluation_config(
                session,
                tenant_id,
                EvaluationTargetType.KNOWLEDGE_BASE.value,
                dataset.id,
                current_user.id,
                payload,
            )
        except ValueError as exc:
            raise BadRequest(str(exc)) from exc
        return _config_response(config, target_type=EvaluationTargetType.KNOWLEDGE_BASE.value)


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/run")
class DatasetEvaluationRunApi(Resource):
    @console_ns.expect(console_ns.models[EvaluationRunPayload.__name__])
    @console_ns.response(200, "Evaluation run started", console_ns.models[EvaluationRunResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()))
    @with_session
    def post(self, session: Session, dataset_id: UUID) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        dataset = _get_accessible_dataset(session, dataset_id, current_user, tenant_id)
        payload = EvaluationRunPayload.model_validate(console_ns.payload or {})
        run = _start_run(
            session=session,
            tenant_id=tenant_id,
            target_type=EvaluationTargetType.KNOWLEDGE_BASE.value,
            target_id=dataset.id,
            account_id=current_user.id,
            payload=payload,
        )
        return dump_response(EvaluationRunResponse, run)


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/logs")
class DatasetEvaluationLogsApi(Resource):
    @console_ns.doc(params=query_params_from_model(EvaluationRunListQuery))
    @console_ns.response(200, "Evaluation runs", console_ns.models[EvaluationRunPaginationResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()))
    @with_session(write=False)
    def get(self, session: Session, dataset_id: UUID) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        dataset = _get_accessible_dataset(session, dataset_id, current_user, tenant_id)
        query = EvaluationRunListQuery.model_validate(request.args.to_dict(flat=True))
        runs, total = EvaluationService.get_evaluation_runs(
            session,
            tenant_id,
            EvaluationTargetType.KNOWLEDGE_BASE.value,
            dataset.id,
            query.page,
            query.page_size,
        )
        return dump_response(
            EvaluationRunPaginationResponse,
            {"data": runs, "total": total, "page": query.page, "page_size": query.page_size},
        )


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/runs/<uuid:run_id>")
class DatasetEvaluationRunDetailApi(Resource):
    @console_ns.doc(params=query_params_from_model(EvaluationRunDetailQuery))
    @console_ns.response(200, "Evaluation run detail", console_ns.models[EvaluationRunDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()))
    @with_session(write=False)
    def get(self, session: Session, dataset_id: UUID, run_id: UUID) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        dataset = _get_accessible_dataset(session, dataset_id, current_user, tenant_id)
        query = EvaluationRunDetailQuery.model_validate(request.args.to_dict(flat=True))
        return _run_detail(
            session=session,
            tenant_id=tenant_id,
            target_type=EvaluationTargetType.KNOWLEDGE_BASE.value,
            target_id=dataset.id,
            run_id=str(run_id),
            query=query,
        )


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/runs/<uuid:run_id>/cancel")
class DatasetEvaluationRunCancelApi(Resource):
    @console_ns.response(200, "Evaluation run cancelled", console_ns.models[EvaluationRunResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()))
    @with_session
    def post(self, session: Session, dataset_id: UUID, run_id: UUID) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        dataset = _get_accessible_dataset(session, dataset_id, current_user, tenant_id)
        return _cancel_run(
            session=session,
            tenant_id=tenant_id,
            target_type=EvaluationTargetType.KNOWLEDGE_BASE.value,
            target_id=dataset.id,
            run_id=str(run_id),
        )


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/runs/<uuid:run_id>/retry")
class DatasetEvaluationRunRetryApi(Resource):
    @console_ns.response(200, "Evaluation run retry scheduled", console_ns.models[EvaluationRunResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()))
    @with_session
    def post(self, session: Session, dataset_id: UUID, run_id: UUID) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        dataset = _get_accessible_dataset(session, dataset_id, current_user, tenant_id)
        return _retry_run(
            session=session,
            tenant_id=tenant_id,
            target_type=EvaluationTargetType.KNOWLEDGE_BASE.value,
            target_id=dataset.id,
            run_id=str(run_id),
        )


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/metrics")
class DatasetEvaluationMetricsApi(Resource):
    @console_ns.response(200, "Retrieval evaluation metrics", console_ns.models[EvaluationMetricsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()))
    @with_session(write=False)
    def get(self, session: Session, dataset_id: UUID) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        _get_accessible_dataset(session, dataset_id, current_user, tenant_id)
        return dump_response(
            EvaluationMetricsResponse,
            {"metrics": EvaluationService.get_supported_metrics(EvaluationCategory.RETRIEVAL)},
        )


@console_ns.route("/datasets/<uuid:dataset_id>/evaluation/files/<uuid:file_id>")
class DatasetEvaluationFileDownloadApi(Resource):
    @console_ns.response(200, "Evaluation file", console_ns.models[EvaluationFileResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()))
    @with_session(write=False)
    def get(self, session: Session, dataset_id: UUID, file_id: UUID) -> dict[str, Any]:
        current_user, tenant_id = current_account_with_tenant()
        dataset = _get_accessible_dataset(session, dataset_id, current_user, tenant_id)
        return _evaluation_file_response(
            session=session,
            tenant_id=tenant_id,
            target_type=EvaluationTargetType.KNOWLEDGE_BASE.value,
            target_id=dataset.id,
            file_id=str(file_id),
        )
