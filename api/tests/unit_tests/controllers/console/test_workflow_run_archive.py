import pytest

from controllers.console.workflow_run_archive import (
    WorkflowRunArchiveDownloadApi,
    WorkflowRunArchiveDownloadFileApi,
    WorkflowRunArchiveDownloadsApi,
    WorkflowRunArchivesApi,
)


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
