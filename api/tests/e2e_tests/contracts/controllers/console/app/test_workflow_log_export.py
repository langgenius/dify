"""Create, prepare, poll, and download Workflow CSV exports through the Console API."""

import csv
import json
from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial
from io import StringIO
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
from botocore.exceptions import ClientError
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.app import workflow_app_log
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
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
from tests.helpers.unit.log_export_fixtures import LogExportRedisIo, LogExportStorageIo
from tests.helpers.unit.model_factories import make_account, make_app


@dataclass(frozen=True)
class _Services:
    workflow_app_logs: WorkflowAppLogQueryService
    workflow_log_exports: WorkflowLogExportService


@dataclass(frozen=True)
class _ExportClient:
    client: FlaskClient
    headers: dict[str, str]
    path: str
    tenant_id: str
    app_id: str
    account_id: str
    redis: LogExportRedisIo
    paid: MagicMock
    publish: MagicMock
    storage: LogExportStorageIo
    files: dict[str, str]
    run_id: str

    def task_key(self, task_id: str) -> str:
        """Locate the task state for this Workflow app."""
        return f"workflow_log_export:{{{self.tenant_id}}}:{self.app_id}:{task_id}"

    def get_status(self, task_id: str) -> TestResponse:
        """Poll the identified task under the admitted app."""
        return self.client.get(f"{self.path}/{task_id}", headers=self.headers)

    def get_latest(self) -> TestResponse:
        """Read this account's last task under the admitted app."""
        return self.client.get(f"{self.path}/latest", headers=self.headers)

    def cancel(self, task_id: str) -> TestResponse:
        """Cancel a queued task in the admitted app."""
        return self.client.post(f"{self.path}/{task_id}/cancel", headers=self.headers)

    def get_file(self, task_id: str, *, authenticated: bool = True) -> TestResponse:
        """Navigate to the file with only a Console session cookie, like a browser download."""
        client = self.client if authenticated else self.client.application.test_client()
        return client.get(f"/console/api{self.path}/{task_id}/file")


@pytest.fixture
def export_client(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    log_export_redis: LogExportRedisIo,
    log_export_publish: MagicMock,
    log_export_storage: LogExportStorageIo,
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
    run.created_at = datetime(2026, 1, 1, 23, 59, 59)
    log = WorkflowAppLog(
        tenant_id=tenant.id,
        app_id=target.id,
        workflow_id=run.workflow_id,
        workflow_run_id=run.id,
        created_from=WorkflowAppLogCreatedFrom.SERVICE_API,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account.id,
    )
    log.created_at = datetime(2026, 1, 2, 0, 0, 1)
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

    redis = log_export_redis
    publish = log_export_publish
    files: dict[str, str] = {}
    storage = log_export_storage

    def save_from_path(key: str, path: Path) -> None:
        """Read the completed file while it is available for upload."""
        files[key] = path.read_text(encoding="utf-8-sig")

    storage.save_from_path.side_effect = save_from_path
    logs = WorkflowAppLogQueryService(logs=WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory))
    app.extensions["application_services"] = _Services(
        workflow_app_logs=logs,
        workflow_log_exports=WorkflowLogExportService(
            tasks=RedisLogExportTasks(
                redis=redis.client, task_type=WorkflowLogExportTask, key_prefix="workflow_log_export"
            ),
            dispatch=partial(log_export_adapters.dispatch_log_export_head, redis=redis.client),
            store_csv=log_export_adapters.store_log_export_csv,
            write_csv=WorkflowLogCsvWriter(logs=logs).write_csv,
            open_csv=log_export_adapters.open_log_export_csv,
        ),
    )
    api = ExternalApi(app)
    path = "/apps/<uuid:app_id>/workflow-log-exports"
    logs_path = "/apps/<uuid:app_id>/workflow-app-logs"
    api.add_resource(workflow_app_log.WorkflowAppLogApi, logs_path)
    api.add_resource(workflow_app_log.WorkflowAppLogIdentityOptionsApi, f"{logs_path}/identity-options")
    api.add_resource(workflow_app_log.WorkflowLogExportApi, path)
    api.add_resource(workflow_app_log.WorkflowLogExportIdentityOptionsApi, f"{path}/identity-options")
    api.add_resource(workflow_app_log.WorkflowLogExportLatestApi, f"{path}/latest")
    api.add_resource(workflow_app_log.WorkflowLogExportTaskApi, f"{path}/<uuid:task_id>")
    api.add_resource(workflow_app_log.WorkflowLogExportCancelApi, f"{path}/<uuid:task_id>/cancel")
    api.add_resource(workflow_app_log.WorkflowLogExportFileApi, f"/console/api{path}/<uuid:task_id>/file")

    client = app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = account.id
        session["_fresh"] = True
    token = generate_csrf_token(account.id)
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
    with patch.object(workflow_app_log, "is_cloud_edition_billing_paid_plan", return_value=True) as paid:
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
        json={
            "status": "failed",
            "created_at__after": "2026-01-02T12:00:00+08:00",
            "end_user_ids": [end_user_id],
            "estimated_rows": 0,
        },
    )

    assert response.status_code == 202
    task_id = response.get_json()["task_id"]
    assert str(UUID(task_id)) == task_id
    assert response.json == {"task_id": task_id, "status": "pending", "estimated_rows": 0}
    key = export_client.task_key(task_id)
    ttl, raw = export_client.redis.client.ttl(key), export_client.redis.get(key)
    task = WorkflowLogExportTask.model_validate_json(raw)
    assert task.estimated_rows == 0
    assert (task.task_id, task.tenant_id, task.app_id, task.requested_by) == (
        task_id,
        export_client.tenant_id,
        export_client.app_id,
        export_client.account_id,
    )
    assert task.filters == WorkflowLogExportFilters(
        status=WorkflowExecutionStatus.FAILED, created_at_after=datetime(2026, 1, 2, 4), end_user_ids=(end_user_id,)
    )
    assert task.expires_at is None
    assert ttl == -1
    latest_key = (
        f"workflow_log_export_latest:{{{export_client.tenant_id}}}:{export_client.app_id}:{export_client.account_id}"
    )
    assert export_client.redis.get(latest_key) == task_id
    assert export_client.redis.client.ttl(latest_key) == ttl
    export_client.redis.reject_submission = True
    blocked = export_client.client.post(export_client.path, headers=export_client.headers, json={})
    assert (blocked.status_code, blocked.get_json()["code"]) == (429, "log_export_limit_reached")
    export_client.publish.assert_called_once_with(
        kwargs={
            "tenant_id": export_client.tenant_id,
            "app_id": export_client.app_id,
            "task_id": task_id,
            "export_kind": "workflow",
        },
        task_id=task_id,
    )


@pytest.mark.parametrize(
    ("payload", "expected_status"),
    [
        ({"page": 1}, 422),
        ({"created_at__after": "2026-01-02", "created_at__before": "2026-01-01"}, 400),
        ({"estimated_rows": -1}, 422),
        ({"estimated_rows": 1.5}, 422),
        ({"estimated_rows": True}, 422),
    ],
)
def test_create_workflow_log_export_rejects_invalid_filters(
    export_client: _ExportClient, payload: object, expected_status: int
) -> None:
    response = export_client.client.post(export_client.path, headers=export_client.headers, json=payload)

    assert response.status_code == expected_status
    assert not export_client.redis.cache


def test_workflow_log_export_requires_cloud_entitlement(export_client: _ExportClient) -> None:
    export_client.paid.return_value = False

    response = export_client.client.post(export_client.path, headers=export_client.headers, json={})

    assert response.status_code == 403
    assert export_client.get_status(str(uuid4())).status_code == 403
    assert export_client.get_latest().status_code == 403
    assert export_client.get_file(str(uuid4())).status_code == 403
    assert not export_client.redis.cache
    export_client.redis.get.assert_not_called()


def test_workflow_list_accepts_multiple_identities_without_requiring_export_entitlement(
    export_client: _ExportClient,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    former = make_account(account_id=str(uuid4()), name="Former Operator", email="former@example.test")
    with sqlite_session_factory.begin() as session:
        session.add(former)
        session.get_one(WorkflowRun, export_client.run_id).created_by = former.id
        log = session.scalars(
            select(WorkflowAppLog).where(WorkflowAppLog.workflow_run_id == export_client.run_id)
        ).one()
        log.created_by = former.id

    export_client.paid.return_value = False
    logs_path = f"/apps/{export_client.app_id}/workflow-app-logs"
    query = {"keyword": "former ope"}

    identities = export_client.client.get(
        f"{logs_path}/identity-options", query_string=query, headers=export_client.headers
    )
    assert identities.status_code == 200
    assert [(item["id"], item["source"]) for item in identities.get_json()["data"]] == [
        (former.id, "account"),
    ]
    assert (
        export_client.client.get(
            f"{export_client.path}/identity-options", query_string=query, headers=export_client.headers
        ).status_code
        == 403
    )

    logs = export_client.client.get(
        logs_path,
        query_string=[
            ("account_ids", str(uuid4())),
            ("account_ids", former.id),
            ("end_user_ids", str(uuid4())),
        ],
        headers=export_client.headers,
    )
    assert logs.status_code == 200
    assert [item["workflow_run"]["id"] for item in logs.get_json()["data"]] == [export_client.run_id]


def test_workflow_export_worker_uploads_once_and_marks_task_ready(export_client: _ExportClient) -> None:
    response = export_client.client.post(
        export_client.path,
        headers=export_client.headers,
        json={
            "status": "succeeded",
            "account_ids": [export_client.account_id],
            "keyword": export_client.run_id,
            "created_at__after": "2026-01-02T00:00:00Z",
            "estimated_rows": 3,
        },
    )
    assert response.status_code == 202
    task_id = response.get_json()["task_id"]
    pending = export_client.get_status(task_id)
    assert (pending.status_code, pending.json) == (
        200,
        {"task_id": task_id, "status": "pending", "estimated_rows": 3, "progress": None},
    )
    arguments = export_client.publish.call_args.kwargs["kwargs"]
    with export_client.client.application.app_context():
        prepare_log_export_task.run(**arguments)
        prepare_log_export_task.run(**arguments)

    key = export_client.task_key(task_id)
    task = WorkflowLogExportTask.model_validate_json(export_client.redis.get(key))
    assert task.status is LogExportStatus.READY
    assert (
        task.storage_key
        == f"workflow-log-exports/{export_client.tenant_id}/{export_client.app_id}/{task.task_id}/1.csv"
    )
    reader = csv.DictReader(StringIO(export_client.files[task.storage_key].removeprefix("\ufeff")))
    assert reader.fieldnames == [
        "app_id",
        "app_type",
        "end_user_id",
        "account_id",
        "account_name",
        "run_id",
        "created_at",
        "user_input",
        "app_response",
        "status",
        "trigger_by",
    ]
    (row,) = reader
    assert (row["app_type"], row["run_id"], row["status"], row["trigger_by"]) == (
        "Workflow",
        export_client.run_id,
        "succeeded",
        "schedule",
    )
    assert row["account_id"] == export_client.account_id
    assert row["created_at"] == "2026-01-02T00:00:01+00:00"
    assert json.loads(row["app_response"]) == {"result": "ready"}
    export_client.storage.save_from_path.assert_called_once()
    ready = export_client.get_status(task_id)
    assert (ready.status_code, ready.json) == (
        200,
        {
            "task_id": task_id,
            "status": "ready",
            "estimated_rows": 3,
            "progress": {"stage": "uploading", "rows_written": 1},
        },
    )
    assert ready.headers["Cache-Control"] == "no-store"
    latest = export_client.get_latest().get_json()["task"]
    assert latest["status"] == "ready"
    assert latest["estimated_rows"] == 3
    assert latest["progress"] == ready.get_json()["progress"]
    assert task.expires_at is not None
    assert latest["expires_at"] == task.expires_at.isoformat().replace("+00:00", "Z")


def test_workflow_export_stays_queued_if_publication_fails(export_client: _ExportClient) -> None:
    export_client.publish.side_effect = RuntimeError("broker unavailable")

    response = export_client.client.post(export_client.path, headers=export_client.headers, json={})

    assert response.status_code == 202
    key = export_client.task_key(export_client.publish.call_args.kwargs["task_id"])
    task = WorkflowLogExportTask.model_validate_json(export_client.redis.get(key))
    assert task.status is LogExportStatus.PENDING
    assert task.expires_at is None
    export_client.storage.save_from_path.assert_not_called()
    assert export_client.get_status(task.task_id).json == {
        "task_id": task.task_id,
        "status": "pending",
        "estimated_rows": None,
        "progress": None,
    }


def test_latest_workflow_export_returns_saved_filters_in_utc(export_client: _ExportClient) -> None:
    empty = export_client.get_latest()
    assert (empty.status_code, empty.json) == (200, {"task": None})
    missing = export_client.get_status(str(uuid4()))
    assert missing.status_code == 404
    assert missing.get_json()["code"] == "workflow_log_export_task_not_found"

    end_user_id = str(uuid4())
    labels = [{"id": end_user_id, "source": "end-user", "label": "customer-042"}]
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
            "identity_labels": labels,
        },
    )
    assert submitted.status_code == 202
    task_id = submitted.get_json()["task_id"]
    latest = export_client.get_latest()
    assert latest.status_code == 200
    assert latest.headers["Cache-Control"] == "no-store"
    assert latest.json == {
        "task": {
            "task_id": task_id,
            "status": "pending",
            "estimated_rows": None,
            "progress": None,
            "identity_labels": labels,
            "expires_at": None,
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
    key = export_client.task_key(response.get_json()["task_id"])
    ttl, raw = export_client.redis.client.ttl(key), export_client.redis.get(key)
    task = WorkflowLogExportTask.model_validate_json(raw).model_copy(update=changes)
    export_client.redis.client.setex(key, ttl, task.model_dump_json())

    assert export_client.get_status(task.task_id).status_code == task_status
    assert export_client.get_latest().json == {"task": None}
    email = export_client.client.put(
        f"{export_client.path}/{task.task_id}", headers=export_client.headers, json={"enabled": True}
    )
    assert email.status_code == 404
    assert email.get_json()["code"] == "workflow_log_export_task_not_found"
    canceled = export_client.cancel(task.task_id)
    assert (canceled.status_code, canceled.get_json()["code"]) == (404, "workflow_log_export_task_not_found")


def test_cancel_workflow_export_frees_the_app_for_a_new_submission(export_client: _ExportClient) -> None:
    submitted = export_client.client.post(export_client.path, headers=export_client.headers, json={})
    assert submitted.status_code == 202
    task_id = submitted.get_json()["task_id"]

    canceled = export_client.cancel(task_id)

    assert (canceled.status_code, canceled.get_json()["status"]) == (200, "canceled")
    assert canceled.cache_control.no_store
    assert export_client.get_latest().get_json()["task"]["status"] == "canceled"
    assert export_client.client.post(export_client.path, headers=export_client.headers, json={}).status_code == 202


@pytest.fixture
def ready_export(export_client: _ExportClient) -> WorkflowLogExportTask:
    """Create an export and run the worker so the file and task are available for download."""
    submitted = export_client.client.post(export_client.path, headers=export_client.headers, json={})
    assert submitted.status_code == 202
    with export_client.client.application.app_context():
        prepare_log_export_task.run(**export_client.publish.call_args.kwargs["kwargs"])
    task_key = export_client.task_key(submitted.get_json()["task_id"])
    task = WorkflowLogExportTask.model_validate_json(export_client.redis.get(task_key))
    assert task.status is LogExportStatus.READY
    return task


def test_cancel_workflow_export_conflicts_after_completion(
    export_client: _ExportClient, ready_export: WorkflowLogExportTask
) -> None:
    canceled = export_client.cancel(ready_export.task_id)

    assert (canceled.status_code, canceled.get_json()["code"]) == (409, "log_export_task_not_cancelable")


def test_workflow_export_download_signs_cloud_s3_file(
    export_client: _ExportClient,
    ready_export: WorkflowLogExportTask,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(STORAGE_TYPE=StorageType.S3)
    key = export_client.task_key(ready_export.task_id)
    ttl = export_client.redis.client.ttl(key)
    task = ready_export.model_copy(update={"expires_at": utc_now() + timedelta(minutes=2)})
    export_client.redis.client.setex(key, ttl, task.model_dump_json())
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
    task_id = submitted.get_json()["task_id"]

    assert export_client.get_file(task_id, authenticated=False).status_code == 401
    export_client.redis.get.assert_not_called()
    response = export_client.get_file(task_id)
    assert (response.status_code, response.get_json()["code"]) == (409, "workflow_log_export_task_not_ready")
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

    assert (response.status_code, response.get_json()["code"]) == (404, "workflow_log_export_file_not_found")
    export_client.storage.generate_presigned_url.assert_not_called()


def test_workflow_export_download_propagates_s3_failure(
    export_client: _ExportClient,
    ready_export: WorkflowLogExportTask,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(STORAGE_TYPE=StorageType.S3)
    export_client.storage.exists.side_effect = ClientError({"Error": {"Code": "AccessDenied"}}, "HeadObject")

    response = export_client.get_file(ready_export.task_id)

    assert response.status_code == 500
    export_client.storage.generate_presigned_url.assert_not_called()
