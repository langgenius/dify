from types import SimpleNamespace

import pytest
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.console import workflow_run_archive
from controllers.console.workflow_run_archive import (
    WorkflowRunArchiveDownloadApi,
    WorkflowRunArchiveDownloadFileApi,
    WorkflowRunArchiveDownloadsApi,
    WorkflowRunArchivesApi,
)
from models import TenantAccountRole


@pytest.mark.parametrize(
    "role",
    [TenantAccountRole.EDITOR, TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR],
)
@pytest.mark.parametrize("rbac_enabled", [False, True])
def test_current_owner_or_admin_ids_rejects_non_manager(
    monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole, rbac_enabled: bool
) -> None:
    current_user = SimpleNamespace(id="account-1", current_role=role)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", rbac_enabled)
    monkeypatch.setattr(
        workflow_run_archive,
        "current_account_with_tenant",
        lambda: (current_user, "tenant-1"),
    )

    with pytest.raises(Forbidden):
        workflow_run_archive._current_owner_or_admin_ids()


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN])
@pytest.mark.parametrize("rbac_enabled", [False, True])
def test_current_owner_or_admin_ids_returns_current_ids_for_manager(
    monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole, rbac_enabled: bool
) -> None:
    current_user = SimpleNamespace(id="account-1", current_role=role)
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", rbac_enabled)
    monkeypatch.setattr(
        workflow_run_archive,
        "current_account_with_tenant",
        lambda: (current_user, "tenant-1"),
    )

    assert workflow_run_archive._current_owner_or_admin_ids() == ("tenant-1", "account-1")


@pytest.mark.parametrize(
    ("method", "args"),
    [
        (WorkflowRunArchivesApi.get, ()),
        (WorkflowRunArchiveDownloadsApi.post, ()),
        (WorkflowRunArchiveDownloadApi.get, ("download-1",)),
        (WorkflowRunArchiveDownloadFileApi.get, ("download-1",)),
    ],
)
def test_workflow_run_archive_endpoints_enforce_fixed_workspace_roles(
    monkeypatch: pytest.MonkeyPatch, method, args: tuple[str, ...]
) -> None:
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__

    def reject_non_manager() -> tuple[str, str]:
        raise Forbidden()

    monkeypatch.setattr(workflow_run_archive, "_current_owner_or_admin_ids", reject_non_manager)

    with pytest.raises(Forbidden):
        method(None, *args)


@pytest.mark.parametrize(
    "method",
    [
        WorkflowRunArchivesApi.get,
        WorkflowRunArchiveDownloadsApi.post,
        WorkflowRunArchiveDownloadApi.get,
        WorkflowRunArchiveDownloadFileApi.get,
    ],
)
def test_workflow_run_archive_endpoints_require_cloud_paid_plan(method) -> None:
    decorator_names = set()
    while hasattr(method, "__wrapped__"):
        decorator_names.add(method.__code__.co_qualname.partition(".<locals>")[0])
        method = method.__wrapped__

    assert {
        "only_edition_cloud",
        "cloud_edition_billing_enabled",
        "cloud_edition_billing_paid_plan_required",
    } <= decorator_names
    assert "rbac_permission_required" not in decorator_names
