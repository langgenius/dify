import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask.testing import FlaskClient
from flask_restx import Api, Resource
from werkzeug.exceptions import Forbidden, NotFound

from controllers.console import api as console_api
from controllers.console import flask_admission, workflow_run_archive
from controllers.console.workflow_run_archive import (
    WorkflowRunArchiveDownloadApi,
    WorkflowRunArchiveDownloadFileApi,
    WorkflowRunArchiveDownloadPayload,
    WorkflowRunArchiveDownloadsApi,
    WorkflowRunArchiveMonthApi,
    WorkflowRunArchivesApi,
)
from enums import CloudPlan, DeploymentEdition
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models import Account, TenantAccountRole
from services.retention.workflow_run.archive_deletion_task import (
    WorkflowRunArchiveDeletionStatus,
    WorkflowRunArchiveDeletionTask,
)
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveDownloadNotReadyError,
    WorkflowRunArchiveDownloadTaskNotFoundError,
    WorkflowRunArchiveInvalidMonthError,
    WorkflowRunArchiveNotFoundError,
    WorkflowRunArchiveService,
)

_CONTEXT = RequestContext(
    request_id="request-1",
    trace_id="trace-1",
    account_id="account-1",
    active_workspace_id="tenant-1",
)
_ENDPOINTS = [
    WorkflowRunArchivesApi.get,
    WorkflowRunArchiveDownloadsApi.post,
    WorkflowRunArchiveDownloadApi.get,
    WorkflowRunArchiveDownloadFileApi.get,
    WorkflowRunArchiveMonthApi.delete,
]
from tests.unit_tests.config_override import apply_config_overrides


def _account(role: TenantAccountRole) -> Account:
    account = Account(name="Test User", email="user@example.com")
    account.id = "account-1"
    account.role = role
    return account


def _original(method):
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__
    return method


def _admission_injector(method):
    method = inspect.getclosurevars(method).nonlocals["admitted"]
    while "inject_request_context" not in method.__code__.co_qualname:
        method = method.__wrapped__
    return method


@pytest.fixture
def archive_service(
    monkeypatch: pytest.MonkeyPatch,
) -> WorkflowRunArchiveService:
    service = MagicMock(spec=WorkflowRunArchiveService)
    monkeypatch.setattr(
        workflow_run_archive,
        "application_services",
        lambda: SimpleNamespace(workflow_run_archives=service),
    )
    return service


@pytest.mark.parametrize("method", _ENDPOINTS)
def test_workflow_run_archive_endpoints_declare_cloud_paid_plan_admission(method) -> None:
    decorator_names = set()
    current = method
    while hasattr(current, "__wrapped__"):
        decorator_names.add(current.__code__.co_qualname.partition(".<locals>")[0])
        current = current.__wrapped__

    admission = _admission_injector(method)
    allowed_roles = inspect.getclosurevars(admission).nonlocals["allowed_roles"]

    assert "console_account_admission" in decorator_names
    assert "cloud_edition_billing_paid_plan_required" in decorator_names
    assert "only_edition_cloud" not in decorator_names
    expected_roles = (
        {TenantAccountRole.OWNER}
        if method == WorkflowRunArchiveMonthApi.delete
        else {TenantAccountRole.OWNER, TenantAccountRole.ADMIN}
    )
    assert allowed_roles == frozenset(expected_roles)


@pytest.mark.parametrize("method", _ENDPOINTS)
def test_workflow_run_archive_endpoints_reject_non_manager_when_rbac_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
    method,
) -> None:
    account = _account(TenantAccountRole.NORMAL)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    monkeypatch.setattr(
        flask_admission,
        "current_account_with_tenant",
        lambda: AccountWithTenant(account=account, tenant_id="tenant-1"),
    )
    app = Flask(__name__)

    with app.test_request_context(), pytest.raises(Forbidden):
        _admission_injector(method)(None)


@pytest.mark.parametrize(
    ("method", "args"),
    [
        (WorkflowRunArchivesApi.get, ()),
        (WorkflowRunArchiveDownloadsApi.post, ()),
        (WorkflowRunArchiveDownloadApi.get, ("download-1",)),
        (WorkflowRunArchiveDownloadFileApi.get, ("download-1",)),
        (WorkflowRunArchiveMonthApi.delete, (2025, 3)),
    ],
)
def test_workflow_run_archive_endpoints_are_hidden_outside_cloud(
    monkeypatch: pytest.MonkeyPatch,
    method,
    args: tuple[object, ...],
) -> None:
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    app = Flask(__name__)

    with app.test_request_context(), pytest.raises(NotFound):
        method(None, *args)


def test_workflow_run_archive_endpoint_allows_admitted_role_when_rbac_is_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _account(TenantAccountRole.NORMAL)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    account_with_tenant = AccountWithTenant(account=account, tenant_id="tenant-1")
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: account_with_tenant)
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: account_with_tenant)

    def get_billing_info(tenant_id: str, *, exclude_vector_space: bool):
        assert tenant_id == "tenant-1"
        assert exclude_vector_space
        return {
            "subscription": {"plan": CloudPlan.TEAM},
        }

    monkeypatch.setattr(
        "controllers.console.wraps.BillingService.get_info",
        get_billing_info,
    )
    service = MagicMock()
    service.list_archives.return_value = object()
    monkeypatch.setattr(
        workflow_run_archive,
        "application_services",
        lambda: SimpleNamespace(workflow_run_archives=service),
    )
    monkeypatch.setattr(workflow_run_archive, "dump_response", lambda _model, value: value)
    app = Flask(__name__)

    with app.test_request_context():
        _admission_injector(WorkflowRunArchivesApi.get)(None)

    context = service.list_archives.call_args.args[0]
    assert context.account_id == "account-1"
    assert context.active_workspace_id == "tenant-1"


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.NORMAL])
def test_workflow_run_archive_role_permissions_when_rbac_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
    archive_service: WorkflowRunArchiveService,
    role: TenantAccountRole,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    identity = AccountWithTenant(account=_account(role), tenant_id="tenant-1")
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: identity)
    monkeypatch.setattr(
        "controllers.console.wraps.BillingService.get_info",
        lambda _tenant_id, **_kwargs: {"subscription": {"plan": CloudPlan.TEAM}},
    )
    task = object()
    archives = object()
    monkeypatch.setattr(workflow_run_archive, "dump_response", lambda _model, value: value)
    app = Flask(__name__)

    with (
        patch.object(archive_service, "delete_archive", return_value=task) as delete_archive,
        patch.object(archive_service, "create_download", return_value=task) as create_download,
        patch.object(archive_service, "list_archives", return_value=archives) as list_archives,
        app.test_request_context(method="POST", json={"year": 2025, "month": 3}),
    ):
        if role == TenantAccountRole.OWNER:
            assert _admission_injector(WorkflowRunArchiveMonthApi.delete)(None, 2025, 3) == (task, 202)
            context = delete_archive.call_args.args[0]
            assert context.account_id == "account-1"
            assert context.active_workspace_id == "tenant-1"
            delete_archive.assert_called_once_with(context, year=2025, month=3)
        else:
            with pytest.raises(Forbidden):
                _admission_injector(WorkflowRunArchiveMonthApi.delete)(None, 2025, 3)
            delete_archive.assert_not_called()

        if role == TenantAccountRole.ADMIN:
            assert _admission_injector(WorkflowRunArchivesApi.get)(None) is archives
            assert _admission_injector(WorkflowRunArchiveDownloadsApi.post)(None) == (task, 202)
            context = list_archives.call_args.args[0]
            assert context.account_id == "account-1"
            assert context.active_workspace_id == "tenant-1"
            list_archives.assert_called_once_with(context)
            create_download.assert_called_once_with(context, year=2025, month=3)


def test_workflow_run_archive_endpoints_delegate_to_application_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = MagicMock()
    archives = object()
    task = object()
    service.list_archives.return_value = archives
    service.create_download.return_value = task
    service.get_download.return_value = task
    service.delete_archive.return_value = task
    monkeypatch.setattr(
        workflow_run_archive,
        "application_services",
        lambda: SimpleNamespace(workflow_run_archives=service),
    )
    dump_response = MagicMock(side_effect=lambda _model, value: value)
    monkeypatch.setattr(workflow_run_archive, "dump_response", dump_response)

    assert _original(WorkflowRunArchivesApi.get)(None, _CONTEXT) is archives
    assert _original(WorkflowRunArchiveDownloadsApi.post)(
        None,
        WorkflowRunArchiveDownloadPayload(year=2025, month=3),
        _CONTEXT,
    ) == (task, 202)
    assert _original(WorkflowRunArchiveDownloadApi.get)(None, _CONTEXT, "download-1") is task
    assert _original(WorkflowRunArchiveMonthApi.delete)(None, _CONTEXT, 2025, 3) == (task, 202)

    service.list_archives.assert_called_once_with(_CONTEXT)
    service.create_download.assert_called_once_with(_CONTEXT, year=2025, month=3)
    service.get_download.assert_called_once_with(_CONTEXT, download_id="download-1")
    service.delete_archive.assert_called_once_with(_CONTEXT, year=2025, month=3)


@pytest.mark.parametrize(
    ("method", "service_method", "service_error", "args"),
    [
        (
            WorkflowRunArchiveDownloadsApi.post,
            "create_download",
            WorkflowRunArchiveNotFoundError("archive missing"),
            (WorkflowRunArchiveDownloadPayload(year=2025, month=3), _CONTEXT),
        ),
        (
            WorkflowRunArchiveDownloadsApi.post,
            "create_download",
            WorkflowRunArchiveDownloadNotReadyError("archive deleting"),
            (WorkflowRunArchiveDownloadPayload(year=2025, month=3), _CONTEXT),
        ),
        (
            WorkflowRunArchiveDownloadApi.get,
            "get_download",
            WorkflowRunArchiveDownloadTaskNotFoundError("task missing"),
            (_CONTEXT, "download-1"),
        ),
        (
            WorkflowRunArchiveDownloadFileApi.get,
            "get_download_url",
            WorkflowRunArchiveDownloadTaskNotFoundError("task missing"),
            (_CONTEXT, "download-1"),
        ),
        (
            WorkflowRunArchiveDownloadFileApi.get,
            "get_download_url",
            WorkflowRunArchiveDownloadNotReadyError("task pending"),
            (_CONTEXT, "download-1"),
        ),
    ],
)
def test_workflow_run_archive_endpoints_propagate_domain_errors(
    monkeypatch: pytest.MonkeyPatch,
    method,
    service_method: str,
    service_error: Exception,
    args: tuple[object, ...],
) -> None:
    service = MagicMock()
    service.configure_mock(**{f"{service_method}.side_effect": service_error})
    monkeypatch.setattr(
        workflow_run_archive,
        "application_services",
        lambda: SimpleNamespace(workflow_run_archives=service),
    )

    with pytest.raises(type(service_error)) as raised:
        _original(method)(None, *args)
    assert raised.value is service_error


def test_workflow_run_archive_file_redirects_to_signed_url(monkeypatch: pytest.MonkeyPatch) -> None:
    service = MagicMock()
    service.get_download_url.return_value = "https://storage.example.com/archive.zip"
    monkeypatch.setattr(
        workflow_run_archive,
        "application_services",
        lambda: SimpleNamespace(workflow_run_archives=service),
    )
    app = Flask(__name__)

    with app.test_request_context():
        response = _original(WorkflowRunArchiveDownloadFileApi.get)(None, _CONTEXT, "download-1")

    assert response.status_code == 302
    assert response.location == "https://storage.example.com/archive.zip"


@pytest.mark.parametrize(("year", "month"), [(0, 3), (-1, 3), (10000, 3), (2025, 0), (2025, 13), (2025, -1)])
def test_delete_archive_validates_path_month_before_dispatch(
    archive_service: WorkflowRunArchiveService,
    year: int,
    month: int,
) -> None:
    with patch.object(archive_service, "delete_archive") as delete_archive:
        with pytest.raises(WorkflowRunArchiveInvalidMonthError):
            _original(WorkflowRunArchiveMonthApi.delete)(None, _CONTEXT, year, month)

        delete_archive.assert_not_called()


@pytest.fixture
def archive_http_client() -> FlaskClient:
    app = Flask(__name__)
    app.config["RESTX_ERROR_404_HELP"] = False
    api = Api(app, doc=False)
    # Exercise the production handler registrations and their dispatch order.
    api.error_handlers = console_api.error_handlers.copy()

    class ArchiveMonth(Resource):
        def delete(self, year: int, month: int) -> object:
            return _original(WorkflowRunArchiveMonthApi.delete)(self, _CONTEXT, year, month)

    class ArchiveDownloads(Resource):
        def post(self) -> object:
            return _original(WorkflowRunArchiveDownloadsApi.post)(
                self, WorkflowRunArchiveDownloadPayload(year=2025, month=3), _CONTEXT
            )

    class ArchiveDownload(Resource):
        def get(self, download_id: str) -> object:
            return _original(WorkflowRunArchiveDownloadApi.get)(self, _CONTEXT, download_id)

    class ArchiveDownloadFile(Resource):
        def get(self, download_id: str) -> object:
            return _original(WorkflowRunArchiveDownloadFileApi.get)(self, _CONTEXT, download_id)

    api.add_resource(ArchiveMonth, "/workflow-run-archives/<int:year>/<int:month>")
    api.add_resource(ArchiveDownloads, "/workflow-run-archives/downloads")
    api.add_resource(ArchiveDownload, "/workflow-run-archives/downloads/<string:download_id>")
    api.add_resource(ArchiveDownloadFile, "/workflow-run-archives/downloads/<string:download_id>/file")
    return app.test_client()


@pytest.mark.parametrize(
    ("method", "path", "service_method", "error", "status", "code"),
    [
        (
            "delete",
            "/workflow-run-archives/2025/3",
            "delete_archive",
            WorkflowRunArchiveInvalidMonthError("Invalid archive month"),
            400,
            "bad_request",
        ),
        (
            "post",
            "/workflow-run-archives/downloads",
            "create_download",
            WorkflowRunArchiveNotFoundError("archive missing"),
            404,
            "not_found",
        ),
        (
            "post",
            "/workflow-run-archives/downloads",
            "create_download",
            WorkflowRunArchiveDownloadNotReadyError("archive deleting"),
            409,
            "conflict",
        ),
        (
            "get",
            "/workflow-run-archives/downloads/download-1",
            "get_download",
            WorkflowRunArchiveDownloadTaskNotFoundError("task missing"),
            404,
            "not_found",
        ),
        (
            "get",
            "/workflow-run-archives/downloads/download-1/file",
            "get_download_url",
            WorkflowRunArchiveDownloadTaskNotFoundError("task missing"),
            404,
            "not_found",
        ),
        (
            "get",
            "/workflow-run-archives/downloads/download-1/file",
            "get_download_url",
            WorkflowRunArchiveDownloadNotReadyError("task pending"),
            409,
            "conflict",
        ),
    ],
)
def test_workflow_run_archive_domain_errors_keep_http_responses(
    archive_service: WorkflowRunArchiveService,
    archive_http_client: FlaskClient,
    method: str,
    path: str,
    service_method: str,
    error: Exception,
    status: int,
    code: str,
) -> None:
    with patch.object(archive_service, service_method, side_effect=error):
        response = archive_http_client.open(path, method=method.upper())

    assert response.status_code == status
    assert response.json == {"code": code, "message": str(error), "status": status}


def test_invalid_archive_month_keeps_bad_request_response(
    archive_service: WorkflowRunArchiveService,
    archive_http_client: FlaskClient,
) -> None:
    with patch.object(archive_service, "delete_archive") as delete_archive:
        response = archive_http_client.delete("/workflow-run-archives/2025/13")

        delete_archive.assert_not_called()

    assert response.status_code == 400
    payload = response.json
    assert isinstance(payload, dict)
    assert payload["code"] == "bad_request"
    assert payload["status"] == 400
    assert "month" in payload["message"]


def test_archive_domain_error_handlers_preserve_accepted_deletion_and_download_redirect(
    archive_service: WorkflowRunArchiveService,
    archive_http_client: FlaskClient,
) -> None:
    task = WorkflowRunArchiveDeletionTask(year=2025, month=3, status=WorkflowRunArchiveDeletionStatus.PENDING)
    with (
        patch.object(archive_service, "delete_archive", return_value=task),
        patch.object(archive_service, "get_download_url", return_value="https://storage.example.com/archive.zip"),
    ):
        deletion = archive_http_client.delete("/workflow-run-archives/2025/3")
        download = archive_http_client.get("/workflow-run-archives/downloads/download-1/file")

    assert deletion.status_code == 202
    assert deletion.json == {"year": 2025, "month": 3, "status": "pending", "error": None}
    assert download.status_code == 302
    assert download.location == "https://storage.example.com/archive.zip"
