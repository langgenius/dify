"""Create, prepare, poll, and download Workflow CSV exports through the Console API."""

import csv
import json
from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.app import workflow_app_log
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
from extensions.storage.storage_type import StorageType
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import utc_now
from libs.external_api import ExternalApi
from libs.token import generate_csrf_token
from models import Account, Tenant, TenantAccountJoin, WorkflowAppLog, WorkflowRun
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import AppMode, DifySetup
from models.workflow import WorkflowAppLogCreatedFrom, WorkflowType
from repositories.workflow_app_log_query_repository import WorkflowAppLogQueryRepository
from services.retention import log_export_adapters
from services.retention.log_export_task import LogExportStatus
from services.retention.log_export_task_cache import RedisLogExportTasks
from services.retention.workflow_run.log_export_csv import WorkflowLogCsvWriter
from services.retention.workflow_run.log_export_service import (
    WorkflowLogExportFilters,
    WorkflowLogExportService,
    WorkflowLogExportTask,
)
from services.workflow_app_log_query_service import WorkflowAppLogQueryService
from tasks.log_export_tasks import prepare_log_export_task
from tests.helpers.unit.model_factories import make_account, make_app


@dataclass(frozen=True)
class _ExportClient:
    client: FlaskClient
    headers: dict[str, str]
    path: str
    tenant_id: str
    app_id: str
    account_id: str
    redis: Mock
    paid: Mock
    publish: Mock
    storage: Mock
    files: dict[str, str]
    run_id: str

    def get_status(self, task_id: str) -> TestResponse:
        """Poll the identified task under the admitted app."""
        return self.client.get(f"{self.path}/{task_id}", headers=self.headers)

    def get_latest(self) -> TestResponse:
        """Read this account's last task under the admitted app."""
        return self.client.get(f"{self.path}/latest", headers=self.headers)

    def get_file(self, task_id: str, *, authenticated: bool = True) -> TestResponse:
        """Navigate to the file with only a Console session cookie, like a browser download."""
        client = self.client if authenticated else self.client.application.test_client()
        return client.get(f"/console/api{self.path}/{task_id}/file")


@pytest.fixture
def export_client(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[_ExportClient]:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        STORAGE_TYPE=StorageType.LOCAL,
        LOGIN_DISABLED=False,
        RBAC_ENABLED=False,
        SECRET_KEY="workflow-export-http-tests-key-at-least-32-bytes",
        CONSOLE_WEB_URL="http://localhost",
        CONSOLE_API_URL="http://localhost",
        COOKIE_DOMAIN="",
    )
    tenant = Tenant(name="Workflow workspace")
    account = make_account(account_id=str(uuid4()))
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id, mode=AppMode.WORKFLOW)
    run = WorkflowRun(
        tenant_id=tenant.id,
        app_id=target.id,
        workflow_id=str(uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.SCHEDULE,
        status=WorkflowExecutionStatus.SUCCEEDED,
        version="2026-01-02",
        inputs='{"query":"report"}',
        outputs='{"result":"ready"}',
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account.id,
    )
    run.created_at = datetime(2026, 1, 2, 4)
    log = WorkflowAppLog(
        tenant_id=tenant.id,
        app_id=target.id,
        workflow_id=run.workflow_id,
        workflow_run_id=run.id,
        created_from=WorkflowAppLogCreatedFrom.SERVICE_API,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account.id,
    )
    log.created_at = run.created_at
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                account,
                tenant,
                target,
                run,
                log,
                DifySetup(version="test"),
                TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER),
            ]
        )

    app = Flask(__name__)
    app.config.update(
        TESTING=True, SECRET_KEY="workflow-export-test-session", SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url)
    )
    db.init_app(app)
    login_manager = DifyLoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized_handler(unauthorized_handler)

    @login_manager.user_loader
    def load_account(account_id: str) -> Account | None:
        with sqlite_session_factory() as session:
            loaded = session.get(Account, account_id)
            if loaded is not None:
                loaded.set_tenant_id_with_session(tenant.id, session=session)
            return loaded

    cache: dict[str, str] = {}
    redis = Mock(spec=RedisClientWrapper)
    redis.setex.side_effect = lambda key, _ttl, value: cache.__setitem__(key, value)
    redis.get.side_effect = cache.get

    def transition(*, keys: list[str], args: list[str]) -> int:
        """Emulate the adapter's compare-and-set on the stored task."""
        key = keys[0]
        if key not in cache or json.loads(cache[key])["status"] != args[0]:
            return 0
        cache[key] = args[1]
        return 1

    redis.register_script.return_value = transition
    paid = Mock(return_value=True)
    monkeypatch.setattr(workflow_app_log, "is_cloud_edition_billing_paid_plan", paid)
    publish = Mock()
    monkeypatch.setattr(prepare_log_export_task, "apply_async", publish)
    files: dict[str, str] = {}
    storage = Mock()

    def save_file(key: str, path: Path) -> None:
        """Read the completed file while it is available for upload."""
        files[key] = path.read_text(encoding="utf-8-sig")

    storage.save_file.side_effect = save_file
    monkeypatch.setattr(log_export_adapters, "storage", storage)
    logs = WorkflowAppLogQueryService(logs=WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory))
    app.extensions["application_services"] = SimpleNamespace(
        workflow_app_logs=logs,
        workflow_log_exports=WorkflowLogExportService(
            tasks=RedisLogExportTasks(redis=redis, task_type=WorkflowLogExportTask, key_prefix="workflow_log_export"),
            dispatch=partial(log_export_adapters.dispatch_log_export, export_kind="workflow"),
            store_csv=log_export_adapters.store_log_export_csv,
            write_csv=WorkflowLogCsvWriter(logs=logs).write_csv,
            open_csv=log_export_adapters.open_log_export_csv,
        ),
    )
    api = ExternalApi(app)
    path = "/apps/<uuid:app_id>/workflow-log-exports"
    api.add_resource(workflow_app_log.WorkflowLogExportApi, path)
    api.add_resource(workflow_app_log.WorkflowLogExportLatestApi, f"{path}/latest")
    api.add_resource(workflow_app_log.WorkflowLogExportTaskApi, f"{path}/<uuid:task_id>")
    api.add_resource(workflow_app_log.WorkflowLogExportFileApi, f"/console/api{path}/<uuid:task_id>/file")

    client = app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = account.id
        session["_fresh"] = True
    token = generate_csrf_token(account.id)
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
    yield _ExportClient(
        client,
        {HEADER_NAME_CSRF_TOKEN: token},
        f"/apps/{target.id}/workflow-log-exports",
        tenant.id,
        target.id,
        account.id,
        redis,
        paid,
        publish,
        storage,
        files,
        run.id,
    )
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def test_create_workflow_log_export_saves_the_admitted_scope_and_filters(export_client: _ExportClient) -> None:
    end_user_id = str(uuid4())
    response = export_client.client.post(
        export_client.path,
        headers=export_client.headers,
        json={"status": "failed", "created_at__after": "2026-01-02T12:00:00+08:00", "end_user_ids": [end_user_id]},
    )

    assert response.status_code == 202
    task_id = response.json["task_id"]
    assert str(UUID(task_id)) == task_id
    assert response.json == {"task_id": task_id, "status": "pending"}
    key, ttl, raw = export_client.redis.setex.call_args_list[0].args
    task = WorkflowLogExportTask.model_validate_json(raw)
    assert key == f"workflow_log_export:{export_client.tenant_id}:{export_client.app_id}:{task_id}"
    assert (task.task_id, task.tenant_id, task.app_id, task.requested_by) == (
        task_id,
        export_client.tenant_id,
        export_client.app_id,
        export_client.account_id,
    )
    assert task.filters == WorkflowLogExportFilters(
        status=WorkflowExecutionStatus.FAILED, created_at_after=datetime(2026, 1, 2, 4), end_user_ids=(end_user_id,)
    )
    assert task.expires_at - task.created_at == timedelta(days=1)
    assert 0 < ttl <= 86400
    export_client.redis.setex.assert_called_with(
        f"workflow_log_export_latest:{export_client.tenant_id}:{export_client.app_id}:{export_client.account_id}",
        ttl,
        task_id,
    )
    export_client.publish.assert_called_once_with(
        kwargs={
            "tenant_id": export_client.tenant_id,
            "app_id": export_client.app_id,
            "task_id": task_id,
            "export_kind": "workflow",
        },
        task_id=task_id,
        expires=task.expires_at,
    )


@pytest.mark.parametrize(
    ("payload", "expected_status"),
    [({"page": 1}, 422), ({"created_at__after": "2026-01-02", "created_at__before": "2026-01-01"}, 400)],
)
def test_create_workflow_log_export_rejects_invalid_filters(
    export_client: _ExportClient, payload: object, expected_status: int
) -> None:
    response = export_client.client.post(export_client.path, headers=export_client.headers, json=payload)

    assert response.status_code == expected_status
    export_client.redis.setex.assert_not_called()


def test_workflow_log_export_requires_cloud_entitlement(export_client: _ExportClient) -> None:
    export_client.paid.return_value = False

    response = export_client.client.post(export_client.path, headers=export_client.headers, json={})

    assert response.status_code == 403
    assert export_client.get_status(str(uuid4())).status_code == 403
    assert export_client.get_latest().status_code == 403
    assert export_client.get_file(str(uuid4())).status_code == 403
    export_client.redis.setex.assert_not_called()
    export_client.redis.get.assert_not_called()


def test_workflow_export_worker_uploads_once_and_marks_task_ready(export_client: _ExportClient) -> None:
    response = export_client.client.post(
        export_client.path,
        headers=export_client.headers,
        json={"status": "succeeded", "account_ids": [export_client.account_id]},
    )
    assert response.status_code == 202
    task_id = response.json["task_id"]
    pending = export_client.get_status(task_id)
    assert (pending.status_code, pending.json) == (200, {"task_id": task_id, "status": "pending"})
    arguments = export_client.publish.call_args.kwargs["kwargs"]
    with export_client.client.application.app_context():
        prepare_log_export_task.run(**arguments)
        prepare_log_export_task.run(**arguments)

    key = export_client.redis.setex.call_args_list[0].args[0]
    task = WorkflowLogExportTask.model_validate_json(export_client.redis.get(key))
    assert task.status is LogExportStatus.READY
    assert (
        task.storage_key == f"workflow-log-exports/{export_client.tenant_id}/{export_client.app_id}/{task.task_id}.csv"
    )
    (row,) = csv.DictReader(StringIO(export_client.files[task.storage_key]))
    assert (row["app_type"], row["run_id"], row["status"], row["trigger_by"]) == (
        "Workflow",
        export_client.run_id,
        "succeeded",
        "schedule",
    )
    assert row["account_id"] == export_client.account_id
    assert json.loads(row["app_response"]) == {"result": "ready"}
    export_client.storage.save_file.assert_called_once()
    ready = export_client.get_status(task_id)
    assert (ready.status_code, ready.json) == (200, {"task_id": task_id, "status": "ready"})
    assert ready.headers["Cache-Control"] == "no-store"
    assert export_client.get_latest().json["task"]["status"] == "ready"


def test_workflow_export_marks_task_failed_if_publication_fails(export_client: _ExportClient) -> None:
    export_client.publish.side_effect = RuntimeError("broker unavailable")

    response = export_client.client.post(export_client.path, headers=export_client.headers, json={})

    assert response.status_code == 500
    key = export_client.redis.setex.call_args_list[0].args[0]
    task = WorkflowLogExportTask.model_validate_json(export_client.redis.get(key))
    assert task.status is LogExportStatus.FAILED
    export_client.storage.save_file.assert_not_called()
    assert export_client.get_status(task.task_id).json == {"task_id": task.task_id, "status": "failed"}


def test_latest_workflow_export_returns_saved_filters_in_utc(export_client: _ExportClient) -> None:
    empty = export_client.get_latest()
    assert (empty.status_code, empty.json) == (200, {"task": None})
    missing = export_client.get_status(str(uuid4()))
    assert missing.status_code == 404
    assert missing.json["code"] == "workflow_log_export_task_not_found"

    previous = export_client.client.post(export_client.path, headers=export_client.headers, json={})
    assert previous.status_code == 202
    end_user_id = str(uuid4())
    submitted = export_client.client.post(
        export_client.path,
        headers=export_client.headers,
        json={
            "keyword": "report",
            "status": "succeeded",
            "created_at__after": "2026-01-02T12:00:00+08:00",
            "created_at__before": "2026-01-03T00:00:00+08:00",
            "end_user_ids": [end_user_id],
            "account_ids": [export_client.account_id],
        },
    )
    assert submitted.status_code == 202

    latest = export_client.get_latest()
    assert latest.status_code == 200
    assert latest.headers["Cache-Control"] == "no-store"
    assert latest.json == {
        "task": {
            "task_id": submitted.json["task_id"],
            "status": "pending",
            "filters": {
                "keyword": "report",
                "status": "succeeded",
                "created_at__after": "2026-01-02T04:00:00Z",
                "created_at__before": "2026-01-02T16:00:00Z",
                "end_user_ids": [end_user_id],
                "account_ids": [export_client.account_id],
            },
        },
    }


@pytest.mark.parametrize(
    ("changes", "task_status"),
    [
        pytest.param({"expires_at": datetime(2000, 1, 1, tzinfo=UTC)}, 404, id="expired"),
        pytest.param({"tenant_id": str(uuid4())}, 404, id="other-workspace"),
        pytest.param({"app_id": str(uuid4())}, 404, id="other-app"),
        pytest.param({"requested_by": str(uuid4())}, 200, id="other-requester"),
    ],
)
def test_workflow_export_status_and_latest_respect_their_scope(
    export_client: _ExportClient, changes: dict[str, object], task_status: int
) -> None:
    response = export_client.client.post(export_client.path, headers=export_client.headers, json={})
    assert response.status_code == 202
    key, ttl, raw = export_client.redis.setex.call_args_list[0].args
    task = WorkflowLogExportTask.model_validate_json(raw).model_copy(update=changes)
    export_client.redis.setex(key, ttl, task.model_dump_json())

    assert export_client.get_status(task.task_id).status_code == task_status
    assert export_client.get_latest().json == {"task": None}


@pytest.fixture
def ready_export(export_client: _ExportClient) -> WorkflowLogExportTask:
    """Create an export and run the worker so the file and task are available for download."""
    submitted = export_client.client.post(export_client.path, headers=export_client.headers, json={})
    assert submitted.status_code == 202
    with export_client.client.application.app_context():
        prepare_log_export_task.run(**export_client.publish.call_args.kwargs["kwargs"])
    task_key = export_client.redis.setex.call_args_list[0].args[0]
    task = WorkflowLogExportTask.model_validate_json(export_client.redis.get(task_key))
    assert task.status is LogExportStatus.READY
    return task


def test_workflow_export_download_signs_cloud_s3_file(
    export_client: _ExportClient,
    ready_export: WorkflowLogExportTask,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(STORAGE_TYPE=StorageType.S3)
    key, ttl, _ = export_client.redis.setex.call_args_list[0].args
    task = ready_export.model_copy(update={"expires_at": utc_now() + timedelta(minutes=2)})
    export_client.redis.setex(key, ttl, task.model_dump_json())
    export_client.storage.exists.side_effect = export_client.files.__contains__
    url = "https://storage.example.test/workflow-logs.csv?signature=signed"
    export_client.storage.generate_presigned_url.return_value = url

    response = export_client.get_file(task.task_id)

    assert response.status_code == 302
    assert response.headers["Location"] == url
    assert response.cache_control.no_store
    expires_in = export_client.storage.generate_presigned_url.call_args.kwargs["expires_in"]
    assert 0 < expires_in <= 120
    export_client.storage.generate_presigned_url.assert_called_once_with(
        task.storage_key,
        expires_in=expires_in,
        content_type="text/csv; charset=utf-8",
        download_filename=f"workflow-logs-{task.task_id}.csv",
    )
    export_client.storage.load.assert_not_called()


def test_workflow_export_download_streams_for_self_hosted_s3(
    export_client: _ExportClient,
    ready_export: WorkflowLogExportTask,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, STORAGE_TYPE=StorageType.S3)
    assert ready_export.storage_key is not None
    payload = export_client.files[ready_export.storage_key].encode("utf-8-sig")
    closed = False

    def chunks() -> Generator[bytes]:
        """Leave data unread so closing the response must release the open stream."""
        nonlocal closed
        try:
            yield payload[:16]
            yield payload[16:]
        finally:
            closed = True

    export_client.storage.load.return_value = chunks()

    with export_client.get_file(ready_export.task_id) as response:
        assert response.status_code == 200
        assert response.mimetype == "text/csv"
        assert (
            response.headers["Content-Disposition"] == f"attachment; filename=workflow-logs-{ready_export.task_id}.csv"
        )
        assert response.cache_control.no_store
        assert next(iter(response.response)) == payload[:16]
        assert not closed

    assert closed
    export_client.storage.load.assert_called_once_with(ready_export.storage_key, stream=True)
    export_client.storage.generate_presigned_url.assert_not_called()


def test_workflow_export_download_requires_login_and_ready_task(export_client: _ExportClient) -> None:
    submitted = export_client.client.post(export_client.path, headers=export_client.headers, json={})
    assert submitted.status_code == 202
    task_id = submitted.json["task_id"]

    assert export_client.get_file(task_id, authenticated=False).status_code == 401
    export_client.redis.get.assert_not_called()
    response = export_client.get_file(task_id)
    assert (response.status_code, response.json["code"]) == (409, "workflow_log_export_task_not_ready")
    export_client.storage.exists.assert_not_called()
    export_client.storage.load.assert_not_called()


def test_workflow_export_download_reports_missing_file(
    export_client: _ExportClient,
    ready_export: WorkflowLogExportTask,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(STORAGE_TYPE=StorageType.S3)
    export_client.storage.exists.return_value = False

    response = export_client.get_file(ready_export.task_id)

    assert (response.status_code, response.json["code"]) == (404, "workflow_log_export_file_not_found")
    export_client.storage.generate_presigned_url.assert_not_called()
