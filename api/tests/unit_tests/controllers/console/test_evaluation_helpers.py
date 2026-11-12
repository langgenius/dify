"""Exercise evaluation controller contracts with persisted runs and upload files."""

import json
from datetime import datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, NotFound, TooManyRequests

from controllers.console import evaluation as controller
from core.evaluation.entities.config_entity import EvaluationFrameworkEnum
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
from services.errors.base import NoPermissionError
from services.errors.evaluation import (
    EvaluationDatasetInvalidError,
    EvaluationFrameworkNotConfiguredError,
    EvaluationMaxConcurrentRunsError,
    EvaluationNotFoundError,
)
from services.evaluation_service import EvaluationService
from services.knowledge.dataset_service import DatasetService
from tests.helpers.unit.model_factories import make_account, make_dataset, make_upload_file


def _evaluation_run(
    session: Session,
    *,
    target_type: EvaluationTargetType = EvaluationTargetType.APPS,
    status: EvaluationRunStatus = EvaluationRunStatus.PENDING,
    dataset_file_id: str | None = None,
) -> EvaluationRun:
    """Persist a scoped run for controller response and error tests."""
    config = EvaluationConfiguration(
        id="config-1",
        tenant_id="tenant-1",
        target_type=target_type,
        target_id="target-1",
        metrics_config=json.dumps({"default_metrics": [], "customized_metrics": None}),
        created_by="account-1",
        updated_by="account-1",
    )
    run = EvaluationRun(
        id="run-1",
        tenant_id="tenant-1",
        target_type=target_type,
        target_id="target-1",
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
