import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from werkzeug.exceptions import Conflict, Forbidden, NotFound

from controllers.console import flask_admission, workflow_run_archive
from controllers.console.workflow_run_archive import (
    WorkflowRunArchiveDownloadApi,
    WorkflowRunArchiveDownloadFileApi,
    WorkflowRunArchiveDownloadPayload,
    WorkflowRunArchiveDownloadsApi,
    WorkflowRunArchivesApi,
)
from enums import CloudPlan, DeploymentEdition
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models import Account, TenantAccountRole
from services.retention.workflow_run.archive_log_service import (
    WorkflowRunArchiveDownloadNotReadyError,
    WorkflowRunArchiveDownloadTaskNotFoundError,
    WorkflowRunArchiveNotFoundError,
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
    assert allowed_roles == frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})


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
            "enabled": True,
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


def test_workflow_run_archive_endpoints_delegate_to_application_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = MagicMock()
    archives = object()
    task = object()
    service.list_archives.return_value = archives
    service.create_download.return_value = task
    service.get_download.return_value = task
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

    service.list_archives.assert_called_once_with(_CONTEXT)
    service.create_download.assert_called_once_with(_CONTEXT, year=2025, month=3)
    service.get_download.assert_called_once_with(_CONTEXT, download_id="download-1")


@pytest.mark.parametrize(
    ("method", "service_method", "service_error", "http_error", "args"),
    [
        (
            WorkflowRunArchiveDownloadsApi.post,
            "create_download",
            WorkflowRunArchiveNotFoundError("archive missing"),
            NotFound,
            (WorkflowRunArchiveDownloadPayload(year=2025, month=3), _CONTEXT),
        ),
        (
            WorkflowRunArchiveDownloadApi.get,
            "get_download",
            WorkflowRunArchiveDownloadTaskNotFoundError("task missing"),
            NotFound,
            (_CONTEXT, "download-1"),
        ),
        (
            WorkflowRunArchiveDownloadFileApi.get,
            "get_download_url",
            WorkflowRunArchiveDownloadTaskNotFoundError("task missing"),
            NotFound,
            (_CONTEXT, "download-1"),
        ),
        (
            WorkflowRunArchiveDownloadFileApi.get,
            "get_download_url",
            WorkflowRunArchiveDownloadNotReadyError("task pending"),
            Conflict,
            (_CONTEXT, "download-1"),
        ),
    ],
)
def test_workflow_run_archive_endpoints_translate_service_errors(
    monkeypatch: pytest.MonkeyPatch,
    method,
    service_method: str,
    service_error: Exception,
    http_error: type[Exception],
    args: tuple[object, ...],
) -> None:
    service = MagicMock()
    service.configure_mock(**{f"{service_method}.side_effect": service_error})
    monkeypatch.setattr(
        workflow_run_archive,
        "application_services",
        lambda: SimpleNamespace(workflow_run_archives=service),
    )

    with pytest.raises(http_error):
        _original(method)(None, *args)


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
