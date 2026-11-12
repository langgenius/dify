"""Exercise evaluation controller contracts with persisted runs and upload files."""

import json
from datetime import datetime
from functools import partial
from inspect import unwrap
from uuid import UUID, uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import BadRequest, Forbidden, NotFound, TooManyRequests

from controllers.console import evaluation as controller
from core.evaluation.entities.config_entity import EvaluationFrameworkEnum
from core.evaluation.entities.evaluation_entity import DefaultMetric, NodeInfo
from models.account import Account
from models.dataset import Dataset
from models.evaluation import (
    EvaluationConfiguration,
    EvaluationRun,
    EvaluationRunItem,
    EvaluationRunItemStatus,
    EvaluationRunStatus,
    EvaluationTargetType,
)
from models.model import App, AppMode
from models.workflow import WorkflowKind
from services.errors.base import NoPermissionError
from services.errors.evaluation import (
    EvaluationDatasetInvalidError,
    EvaluationFrameworkNotConfiguredError,
    EvaluationMaxConcurrentRunsError,
    EvaluationNotFoundError,
)
from services.evaluation_service import EvaluationService
from services.knowledge.dataset_service import DatasetService
from services.workflow_service import WorkflowService
from tests.helpers.unit.model_factories import make_account, make_app, make_dataset, make_upload_file, make_workflow


def _evaluation_run(
    session: Session,
    *,
    run_id: str = "run-1",
    target_id: str = "target-1",
    target_type: EvaluationTargetType = EvaluationTargetType.APPS,
    status: EvaluationRunStatus = EvaluationRunStatus.PENDING,
    dataset_file_id: str | None = None,
) -> EvaluationRun:
    """Persist a scoped run for controller response and error tests."""
    config = EvaluationConfiguration(
        id="config-1",
        tenant_id="tenant-1",
        target_type=target_type,
        target_id=target_id,
        metrics_config=json.dumps({"default_metrics": [], "customized_metrics": None}),
        created_by="account-1",
        updated_by="account-1",
    )
    run = EvaluationRun(
        id=run_id,
        tenant_id="tenant-1",
        target_type=target_type,
        target_id=target_id,
        evaluation_config_id=config.id,
        config_snapshot="{}",
        status=status,
        dataset_file_id=dataset_file_id,
        total_items=1,
        created_by="account-1",
    )
    session.add_all([config, run])
    session.commit()
    return run


def test_config_response_returns_defaults_and_saved_framework(sqlite_session: Session) -> None:
    empty = controller._config_response(None, target_type="apps")
    assert empty["evaluation_framework"] == "ragas"
    assert empty["default_metrics"] is None

    _evaluation_run(sqlite_session)
    config = sqlite_session.get(EvaluationConfiguration, "config-1")
    assert config is not None
    config.evaluation_framework = EvaluationFrameworkEnum.DEEPEVAL
    config.evaluation_model_provider = "provider"
    config.evaluation_model = "model"
    sqlite_session.commit()

    response = controller._config_response(config, target_type="knowledge_base")
    assert response["evaluation_framework"] == "deepeval"
    assert response["evaluation_model_provider"] == "provider"
    assert response["default_metrics"] == []


@pytest.mark.parametrize("content", [b"index,query\n1,hello\n", b""])
def test_load_evaluation_dataset_uses_scoped_upload_file(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, content: bytes
) -> None:
    upload = make_upload_file(file_id="file-1", name="dataset.csv")
    sqlite_session.add(upload)
    sqlite_session.flush()
    loaded_keys: list[str] = []

    def load_once(key: str) -> bytes:
        loaded_keys.append(key)
        return content

    monkeypatch.setattr(controller.storage, "load_once", load_once)
    if content:
        assert controller._load_evaluation_dataset(session=sqlite_session, tenant_id="tenant-1", file_id=upload.id) == (
            content,
            "dataset.csv",
        )
    else:
        with pytest.raises(BadRequest, match="empty"):
            controller._load_evaluation_dataset(session=sqlite_session, tenant_id="tenant-1", file_id=upload.id)
    assert loaded_keys == [upload.key]


def test_load_evaluation_dataset_rejects_missing_and_unreadable_files(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    with pytest.raises(NotFound, match="not found"):
        controller._load_evaluation_dataset(session=sqlite_session, tenant_id="tenant-1", file_id="missing")

    upload = make_upload_file(file_id="file-1")
    sqlite_session.add(upload)
    sqlite_session.flush()

    def fail_load(_key: str) -> bytes:
        raise OSError("storage unavailable")

    monkeypatch.setattr(controller.storage, "load_once", fail_load)
    with pytest.raises(BadRequest, match="Failed to read"):
        controller._load_evaluation_dataset(session=sqlite_session, tenant_id="tenant-1", file_id=upload.id)


@pytest.mark.parametrize(
    ("error", "http_error"),
    [
        (EvaluationFrameworkNotConfiguredError(), BadRequest),
        (EvaluationDatasetInvalidError(), BadRequest),
        (EvaluationNotFoundError(), NotFound),
        (EvaluationMaxConcurrentRunsError(), TooManyRequests),
        (ValueError("invalid target"), BadRequest),
    ],
)
def test_start_run_maps_service_errors_to_http_status(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, error: Exception, http_error: type[Exception]
) -> None:
    upload = make_upload_file(file_id="file-1", name="dataset.csv")
    sqlite_session.add(upload)
    sqlite_session.flush()
    monkeypatch.setattr(controller.storage, "load_once", lambda _key: b"index,query\n1,hello\n")

    def fail_run(**_kwargs: object) -> EvaluationRun:
        raise error

    monkeypatch.setattr(EvaluationService, "start_evaluation_run", fail_run)
    payload = controller.EvaluationRunPayload(file_id=upload.id)

    with pytest.raises(http_error):
        controller._start_run(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="target-1",
            account_id="account-1",
            payload=payload,
        )


def test_run_detail_and_cancel_use_persisted_scoped_run(sqlite_session: Session) -> None:
    run = _evaluation_run(sqlite_session, target_type=EvaluationTargetType.KNOWLEDGE_BASE)
    item = EvaluationRunItem(
        evaluation_run_id=run.id,
        item_index=1,
        status=EvaluationRunItemStatus.COMPLETED,
        inputs='{"query": "hello"}',
        judgment="{}",
    )
    sqlite_session.add(item)
    sqlite_session.commit()

    detail = controller._run_detail(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="knowledge_base",
        target_id="target-1",
        run_id=run.id,
        query=controller.EvaluationRunDetailQuery(),
    )
    assert detail["run"]["id"] == run.id
    assert detail["items"]["data"][0]["inputs"] == {"query": "hello"}

    cancelled = controller._cancel_run(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="knowledge_base",
        target_id="target-1",
        run_id=run.id,
    )
    assert cancelled["status"] == "cancelled"
    assert run.completed_at is not None


def test_run_detail_and_cancel_reject_other_tenant(sqlite_session: Session) -> None:
    run = _evaluation_run(sqlite_session)
    with pytest.raises(NotFound):
        controller._run_detail(
            session=sqlite_session,
            tenant_id="another-tenant",
            target_type="apps",
            target_id="target-1",
            run_id=run.id,
            query=controller.EvaluationRunDetailQuery(),
        )
    with pytest.raises(NotFound):
        controller._cancel_run(
            session=sqlite_session,
            tenant_id="another-tenant",
            target_type="apps",
            target_id="target-1",
            run_id=run.id,
        )


def test_xlsx_response_sets_attachment_headers() -> None:
    response = controller._xlsx_response(b"file data", "报告 1.xlsx")
    assert response.data == b"file data"
    assert response.mimetype == controller.XLSX_MIME_TYPE
    assert "filename*=UTF-8''" in response.headers["Content-Disposition"]
    assert response.headers["Content-Length"] == "9"


def test_run_response_accepts_database_timestamps(sqlite_session: Session) -> None:
    run = _evaluation_run(sqlite_session)
    run.started_at = datetime(2026, 1, 1)
    sqlite_session.flush()
    response = controller.EvaluationRunResponse.model_validate(run)
    assert response.started_at is not None


def test_accessible_dataset_checks_tenant_and_permission(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    dataset_id = str(uuid4())
    dataset = make_dataset(dataset_id=dataset_id)
    sqlite_session.add(dataset)
    sqlite_session.flush()
    account = make_account()
    monkeypatch.setattr(controller.dify_config, "RBAC_ENABLED", False)
    checked_datasets: list[str] = []

    def check_permission(dataset: object, user: Account, session: Session) -> None:
        assert session is sqlite_session
        assert user is account
        assert isinstance(dataset, Dataset)
        checked_datasets.append(dataset.id)

    monkeypatch.setattr(DatasetService, "check_dataset_permission", check_permission)
    assert controller._get_accessible_dataset(sqlite_session, UUID(dataset_id), account, "tenant-1") is dataset
    assert checked_datasets == [dataset_id]

    with pytest.raises(NotFound):
        controller._get_accessible_dataset(sqlite_session, UUID(dataset_id), account, "other-tenant")

    def deny_permission(_dataset: object, _user: Account, _session: Session) -> None:
        raise NoPermissionError("access denied")

    monkeypatch.setattr(DatasetService, "check_dataset_permission", deny_permission)
    with pytest.raises(Forbidden, match="access denied"):
        controller._get_accessible_dataset(sqlite_session, UUID(dataset_id), account, "tenant-1")


def test_evaluation_file_response_requires_a_scoped_run(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    upload = make_upload_file(file_id="file-1", name="results.xlsx", extension="xlsx")
    sqlite_session.add(upload)
    _evaluation_run(sqlite_session, dataset_file_id=upload.id)
    monkeypatch.setattr(
        controller.file_helpers,
        "get_signed_file_url",
        lambda *, upload_file_id, as_attachment: f"/download/{upload_file_id}?attachment={as_attachment}",
    )

    response = controller._evaluation_file_response(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="target-1",
        file_id=upload.id,
    )
    assert response["name"] == "results.xlsx"
    assert response["download_url"] == "/download/file-1?attachment=True"

    with pytest.raises(NotFound):
        controller._evaluation_file_response(
            session=sqlite_session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="other-target",
            file_id=upload.id,
        )


def test_retry_run_reuses_owned_dataset_and_maps_errors(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    upload = make_upload_file(file_id="file-1", name="dataset.csv")
    sqlite_session.add(upload)
    run = _evaluation_run(sqlite_session, status=EvaluationRunStatus.FAILED, dataset_file_id=upload.id)
    monkeypatch.setattr(controller.storage, "load_once", lambda _key: b"index,query\n1,hello\n")
    retry_requests: list[dict[str, object]] = []

    def retry(**kwargs: object) -> EvaluationRun:
        retry_requests.append(kwargs)
        run.status = EvaluationRunStatus.PENDING
        return run

    monkeypatch.setattr(EvaluationService, "retry_evaluation_run", retry)
    response = controller._retry_run(
        session=sqlite_session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="target-1",
        run_id=run.id,
    )
    assert response["status"] == "pending"
    assert retry_requests[0]["dataset_file_content"] == b"index,query\n1,hello\n"
    assert retry_requests[0]["dataset_filename"] == "dataset.csv"

    with pytest.raises(NotFound):
        controller._retry_run(
            session=sqlite_session,
            tenant_id="other-tenant",
            target_type="apps",
            target_id="target-1",
            run_id=run.id,
        )


def test_target_decorator_resolves_scoped_workflow_app(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = make_account()
    app = make_app(app_id="target-1", mode=AppMode.WORKFLOW)
    sqlite_session.add(app)
    sqlite_session.flush()
    monkeypatch.setattr(controller, "current_account_with_tenant", lambda: (account, "tenant-1"))
    checks: list[dict[str, object]] = []
    monkeypatch.setattr(controller, "enforce_rbac_checks", lambda **kwargs: checks.append(kwargs))

    @controller.evaluation_target_required(app_permission=controller.RBACPermission.APP_VIEW_LAYOUT)
    def view(_resource: object, session: Session, **kwargs: object) -> App:
        assert session is sqlite_session
        assert kwargs["target_type"] == "apps"
        target = kwargs["target"]
        assert isinstance(target, App)
        return target

    assert view(None, sqlite_session, evaluate_target_type="apps", evaluate_target_id=app.id) is app
    assert checks[0]["tenant_id"] == "tenant-1"
    assert checks[0]["path_args"] == {"evaluate_target_id": app.id}

    with pytest.raises(NotFound):
        view(None, sqlite_session, evaluate_target_type="apps", evaluate_target_id="missing")
    with pytest.raises(NotFound):
        view(None, sqlite_session, evaluate_target_type="invalid", evaluate_target_id=app.id)
    with pytest.raises(TypeError):
        view(None, object(), evaluate_target_type="apps", evaluate_target_id=app.id)

    app.mode = AppMode.CHAT
    sqlite_session.flush()
    with pytest.raises(BadRequest, match="workflow apps"):
        view(None, sqlite_session, evaluate_target_type="apps", evaluate_target_id=app.id)


def test_app_read_routes_use_persisted_config_and_run(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    account = make_account()
    app = make_app(app_id="target-1", mode=AppMode.WORKFLOW)
    sqlite_session.add(app)
    run = _evaluation_run(sqlite_session, run_id=str(uuid4()))
    monkeypatch.setattr(controller, "current_account_with_tenant", lambda: (account, "tenant-1"))
    flask_app = Flask(__name__)

    with flask_app.test_request_context("/?page=1&page_size=10"):
        config = unwrap(controller.EvaluationDetailApi.get)(
            controller.EvaluationDetailApi(), sqlite_session, app, "apps"
        )
        logs = unwrap(controller.EvaluationLogsApi.get)(controller.EvaluationLogsApi(), sqlite_session, app, "apps")
        detail = unwrap(controller.EvaluationRunDetailApi.get)(
            controller.EvaluationRunDetailApi(), sqlite_session, app, "apps", UUID(run.id)
        )

    assert config["evaluation_framework"] == "ragas"
    assert logs["total"] == 1
    assert logs["data"][0]["id"] == run.id
    assert detail["run"]["id"] == run.id


def test_app_cancel_retry_and_file_routes_scope_the_run(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = make_account()
    app = make_app(app_id="target-1", mode=AppMode.WORKFLOW)
    upload = make_upload_file(file_id=str(uuid4()), name="dataset.csv")
    sqlite_session.add_all([app, upload])
    run = _evaluation_run(
        sqlite_session, run_id=str(uuid4()), status=EvaluationRunStatus.RUNNING, dataset_file_id=upload.id
    )
    monkeypatch.setattr(controller, "current_account_with_tenant", lambda: (account, "tenant-1"))
    monkeypatch.setattr(controller.storage, "load_once", lambda _key: b"index,query\n1,hello\n")
    monkeypatch.setattr(
        controller.file_helpers,
        "get_signed_file_url",
        lambda *, upload_file_id, as_attachment: f"/download/{upload_file_id}?attachment={as_attachment}",
    )

    def retry(**_kwargs: object) -> EvaluationRun:
        run.status = EvaluationRunStatus.PENDING
        return run

    monkeypatch.setattr(EvaluationService, "retry_evaluation_run", retry)
    cancelled = unwrap(controller.EvaluationRunCancelApi.post)(
        controller.EvaluationRunCancelApi(), sqlite_session, app, "apps", UUID(run.id)
    )
    retried = unwrap(controller.EvaluationRunRetryApi.post)(
        controller.EvaluationRunRetryApi(), sqlite_session, app, "apps", UUID(run.id)
    )
    file_response = unwrap(controller.EvaluationFileDownloadApi.get)(
        controller.EvaluationFileDownloadApi(), sqlite_session, app, "apps", UUID(upload.id)
    )

    assert cancelled["status"] == "cancelled"
    assert retried["status"] == "pending"
    assert file_response["id"] == upload.id


def test_available_metrics_route_uses_selected_framework() -> None:
    flask_app = Flask(__name__)
    with flask_app.test_request_context("/?evaluation_framework=ragas"):
        response = unwrap(controller.EvaluationAvailableMetricsApi.get)(controller.EvaluationAvailableMetricsApi())
    assert "faithfulness" in response["metrics"]


def test_app_configuration_and_metadata_routes_use_service_contracts(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = make_account()
    app = make_app(app_id="target-1", mode=AppMode.WORKFLOW)
    upload = make_upload_file(file_id=str(uuid4()), name="dataset.csv")
    sqlite_session.add_all([app, upload])
    run = _evaluation_run(sqlite_session)
    config = sqlite_session.get(EvaluationConfiguration, run.evaluation_config_id)
    assert config is not None
    monkeypatch.setattr(controller, "current_account_with_tenant", lambda: (account, "tenant-1"))
    monkeypatch.setattr(controller.storage, "load_once", lambda _key: b"index,query\n1,hello\n")
    monkeypatch.setattr(EvaluationService, "generate_dataset_template", lambda *_args: (b"template", "template.xlsx"))
    monkeypatch.setattr(
        EvaluationService,
        "get_dataset_column_names",
        lambda *_args: [{"name": "query", "type": "string"}],
    )
    monkeypatch.setattr(EvaluationService, "save_evaluation_config", lambda *_args: config)
    monkeypatch.setattr(EvaluationService, "start_evaluation_run", lambda **_kwargs: run)
    node = NodeInfo(node_id="llm-1", type="llm", title="Answer")
    monkeypatch.setattr(
        EvaluationService,
        "get_default_metrics_with_nodes_for_published_target",
        lambda *_args: [DefaultMetric(metric="answer_relevancy", node_info_list=[node])],
    )
    monkeypatch.setattr(EvaluationService, "get_nodes_for_metrics", lambda *_args: {"llm": [node]})
    flask_app = Flask(__name__)

    with flask_app.test_request_context("/?evaluation_framework=ragas", json={"file_id": upload.id}):
        template = unwrap(controller.EvaluationDatasetTemplateDownloadApi.post)(
            controller.EvaluationDatasetTemplateDownloadApi(), sqlite_session, app, "apps"
        )
        saved_config = unwrap(controller.EvaluationDetailApi.put)(
            controller.EvaluationDetailApi(), sqlite_session, app, "apps"
        )
        columns = unwrap(controller.EvaluationTemplateColumnsApi.post)(
            controller.EvaluationTemplateColumnsApi(), sqlite_session, app, "apps"
        )
        started = unwrap(controller.EvaluationRunApi.post)(controller.EvaluationRunApi(), sqlite_session, app, "apps")
        metrics = unwrap(controller.EvaluationMetricsApi.get)(
            controller.EvaluationMetricsApi(), sqlite_session, app, "apps"
        )
        defaults = unwrap(controller.EvaluationDefaultMetricsApi.get)(
            controller.EvaluationDefaultMetricsApi(), sqlite_session, app, "apps"
        )
        nodes = unwrap(controller.EvaluationNodeInfoApi.post)(
            controller.EvaluationNodeInfoApi(), sqlite_session, app, "apps"
        )

    assert template.data == b"template"
    assert saved_config["evaluation_framework"] == "ragas"
    assert columns["columns"] == [{"name": "query", "type": "string"}]
    assert started["id"] == run.id
    assert "llm" in metrics["metrics"]
    assert defaults["default_metrics"][0]["metric"] == "answer_relevancy"
    assert nodes["llm"][0]["node_id"] == "llm-1"


def test_dataset_routes_scope_config_runs_and_files_to_the_dataset(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = make_account()
    dataset = make_dataset(dataset_id=str(uuid4()))
    upload = make_upload_file(file_id=str(uuid4()), name="dataset.csv")
    sqlite_session.add_all([dataset, upload])
    run = _evaluation_run(
        sqlite_session,
        run_id=str(uuid4()),
        target_id=dataset.id,
        target_type=EvaluationTargetType.KNOWLEDGE_BASE,
        status=EvaluationRunStatus.RUNNING,
        dataset_file_id=upload.id,
    )
    config = sqlite_session.get(EvaluationConfiguration, run.evaluation_config_id)
    assert config is not None
    monkeypatch.setattr(controller, "current_account_with_tenant", lambda: (account, "tenant-1"))
    monkeypatch.setattr(controller.dify_config, "RBAC_ENABLED", False)
    monkeypatch.setattr(DatasetService, "check_dataset_permission", lambda *_args: None)
    monkeypatch.setattr(controller.storage, "load_once", lambda _key: b"index,query\n1,hello\n")
    monkeypatch.setattr(EvaluationService, "generate_retrieval_dataset_template", lambda: (b"template", "dataset.xlsx"))
    monkeypatch.setattr(EvaluationService, "save_evaluation_config", lambda *_args: config)
    monkeypatch.setattr(EvaluationService, "start_evaluation_run", lambda **_kwargs: run)
    monkeypatch.setattr(EvaluationService, "retry_evaluation_run", lambda **_kwargs: run)
    monkeypatch.setattr(
        controller.file_helpers,
        "get_signed_file_url",
        lambda *, upload_file_id, as_attachment: f"/download/{upload_file_id}?attachment={as_attachment}",
    )
    flask_app = Flask(__name__)

    with flask_app.test_request_context("/?page=1&page_size=10", json={"file_id": upload.id}):
        template = unwrap(controller.DatasetEvaluationTemplateDownloadApi.post)(
            controller.DatasetEvaluationTemplateDownloadApi(), sqlite_session, UUID(dataset.id)
        )
        detail = unwrap(controller.DatasetEvaluationDetailApi.get)(
            controller.DatasetEvaluationDetailApi(), sqlite_session, UUID(dataset.id)
        )
        saved = unwrap(controller.DatasetEvaluationDetailApi.put)(
            controller.DatasetEvaluationDetailApi(), sqlite_session, UUID(dataset.id)
        )
        logs = unwrap(controller.DatasetEvaluationLogsApi.get)(
            controller.DatasetEvaluationLogsApi(), sqlite_session, UUID(dataset.id)
        )
        started = unwrap(controller.DatasetEvaluationRunApi.post)(
            controller.DatasetEvaluationRunApi(), sqlite_session, UUID(dataset.id)
        )
        run_detail = unwrap(controller.DatasetEvaluationRunDetailApi.get)(
            controller.DatasetEvaluationRunDetailApi(), sqlite_session, UUID(dataset.id), UUID(run.id)
        )
        cancelled = unwrap(controller.DatasetEvaluationRunCancelApi.post)(
            controller.DatasetEvaluationRunCancelApi(), sqlite_session, UUID(dataset.id), UUID(run.id)
        )
        retried = unwrap(controller.DatasetEvaluationRunRetryApi.post)(
            controller.DatasetEvaluationRunRetryApi(), sqlite_session, UUID(dataset.id), UUID(run.id)
        )
        metrics = unwrap(controller.DatasetEvaluationMetricsApi.get)(
            controller.DatasetEvaluationMetricsApi(), sqlite_session, UUID(dataset.id)
        )
        file_response = unwrap(controller.DatasetEvaluationFileDownloadApi.get)(
            controller.DatasetEvaluationFileDownloadApi(), sqlite_session, UUID(dataset.id), UUID(upload.id)
        )

    assert template.data == b"template"
    assert detail["evaluation_framework"] == "ragas"
    assert saved["evaluation_framework"] == "ragas"
    assert logs["data"][0]["id"] == run.id
    assert started["id"] == run.id
    assert run_detail["run"]["id"] == run.id
    assert cancelled["status"] == "cancelled"
    assert retried["id"] == run.id
    assert "faithfulness" not in metrics["metrics"]
    assert file_response["id"] == upload.id


def test_evaluator_workflow_routes_list_versions_and_associated_apps(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    account = make_account()
    app = make_app(app_id=str(uuid4()), mode=AppMode.WORKFLOW, created_by=account.id)
    workflow = make_workflow(
        workflow_id=str(uuid4()), app_id=app.id, version="1", kind=WorkflowKind.EVALUATION, created_by=account.id
    )
    app.workflow_id = workflow.id
    sqlite_session.add_all([account, app, workflow])
    run = _evaluation_run(sqlite_session, target_id=app.id)
    config = sqlite_session.get(EvaluationConfiguration, run.evaluation_config_id)
    assert config is not None
    monkeypatch.setattr(controller, "current_account_with_tenant", lambda: (account, "tenant-1"))
    monkeypatch.setattr(
        controller,
        "WorkflowService",
        partial(WorkflowService, session_maker=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)),
    )
    monkeypatch.setattr(
        WorkflowService,
        "list_published_evaluation_workflows",
        lambda _self, **_kwargs: ([workflow], True),
    )
    monkeypatch.setattr(EvaluationService, "get_published_evaluator_workflow", lambda *_args: workflow)
    monkeypatch.setattr(EvaluationService, "list_targets_by_customized_workflow", lambda *_args: [config])
    flask_app = Flask(__name__)

    with flask_app.test_request_context("/?page=2&limit=5&named_only=true&keyword=judge"):
        listed = unwrap(controller.AvailableEvaluationWorkflowsApi.get)(
            controller.AvailableEvaluationWorkflowsApi(), sqlite_session
        )
        associated = unwrap(controller.EvaluationWorkflowAssociatedTargetsApi.get)(
            controller.EvaluationWorkflowAssociatedTargetsApi(), sqlite_session, UUID(workflow.id)
        )

    assert listed["items"][0]["app_name"] == app.name
    assert listed["items"][0]["kind"] == "evaluation"
    assert listed["has_more"] is True
    assert associated["items"] == [{"target_type": "apps", "target_id": app.id, "target_name": app.name}]

    with flask_app.test_request_context("/?user_id=another-account"), pytest.raises(Forbidden):
        unwrap(controller.AvailableEvaluationWorkflowsApi.get)(
            controller.AvailableEvaluationWorkflowsApi(), sqlite_session
        )

    monkeypatch.setattr(EvaluationService, "get_published_evaluator_workflow", lambda *_args: None)
    with pytest.raises(NotFound):
        unwrap(controller.EvaluationWorkflowAssociatedTargetsApi.get)(
            controller.EvaluationWorkflowAssociatedTargetsApi(), sqlite_session, UUID(workflow.id)
        )
