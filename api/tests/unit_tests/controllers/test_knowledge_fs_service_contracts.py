from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.service_api.knowledge_fs import resources
from controllers.service_api.knowledge_fs.error import (
    KnowledgeFSServiceInvalidRequestHTTPError,
    KnowledgeFSServiceUpstreamUnavailableHTTPError,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSAdmittedQueryRequest,
    KnowledgeFSBulkDocumentDeletePayload,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSDocumentCompilationJobResponse,
    KnowledgeFSDocumentReindexPayload,
    KnowledgeFSIdempotencyHeader,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSServiceSourceConnectionCreatePayload,
    KnowledgeFSServiceSourceCreatePayload,
    KnowledgeFSServiceSourceUpdatePayload,
)
from tests.unit_tests.config_override import apply_config_overrides

_NOW = "2026-09-17T00:00:00Z"
_FAILURE = {
    "code": "KNOWLEDGE_FS_RATE_LIMITED",
    "category": "rate_limit",
    "message": "untrusted provider message",
    "retryPolicy": "manual",
}


def _job() -> dict[str, object]:
    return {
        "id": "job-1",
        "knowledgeSpaceId": "space-1",
        "checkpoint": "requested",
        "runState": "queued",
        "targetId": "document-1",
        "targetType": "logical_document",
        "createdAt": _NOW,
        "updatedAt": _NOW,
    }


def _workflow() -> dict[str, object]:
    return {
        "id": "run-1",
        "knowledgeSpaceId": "space-1",
        "sourceId": "source-1",
        "kind": "source-sync",
        "state": "queued",
        "checkpoint": "queued",
        "executionAttempts": 0,
        "maxExecutionAttempts": 3,
        "progressCompleted": 0,
        "progressFailed": 0,
        "progressSkipped": 0,
        "createdAt": _NOW,
        "updatedAt": _NOW,
    }


@pytest.fixture
def runtime(monkeypatch: pytest.MonkeyPatch):
    facade = SimpleNamespace(execute_service=MagicMock())
    value = SimpleNamespace(facade=facade)
    monkeypatch.setattr(resources, "_runtime", lambda: value)
    monkeypatch.setattr(resources, "_profile", lambda *_args, **_kwargs: SimpleNamespace(tenant_id="tenant-1"))
    return value


@pytest.mark.parametrize("bad", [" leading-key", "trailing-key ", "newline\nkey", "tab\tkey", "unicode-键", "nul\0key"])
def test_idempotency_header_rejects_invalid_wire_values(bad: str) -> None:
    with pytest.raises(ValidationError):
        KnowledgeFSIdempotencyHeader.model_validate({"Idempotency-Key": bad})


def test_utf8_budget_is_identical_for_admission_and_stream() -> None:
    within = "汉" * 5461 + "a"
    assert len(within.encode()) == 16384
    assert KnowledgeFSQueryCreatePayload(query=within).query == within
    assert KnowledgeFSAdmittedQueryRequest(query=within, knowledgeSpaceId="space-1").query == within
    for model, extra in [
        (KnowledgeFSQueryCreatePayload, {}),
        (KnowledgeFSAdmittedQueryRequest, {"knowledgeSpaceId": "space-1"}),
    ]:
        with pytest.raises(ValidationError):
            model.model_validate({"query": within + "a", **extra})


def test_public_batches_bound_manifest_before_remote_calls() -> None:
    documents = [{"documentId": str(index), "expectedRevision": 1} for index in range(101)]
    KnowledgeFSBulkDocumentDeletePayload.model_validate({"documents": documents[:100]})
    with pytest.raises(ValidationError):
        KnowledgeFSBulkDocumentDeletePayload.model_validate({"documents": documents})
    with pytest.raises(ValidationError):
        KnowledgeFSDocumentReindexPayload.model_validate({"documentIds": [str(index) for index in range(101)]})


@pytest.mark.parametrize(
    "payload", [{"selection": {}}, {"syncPolicy": {}}, {"metadata": {"syncPolicy": {"everyHours": 24}}}]
)
def test_service_source_update_does_not_advertise_console_only_fields(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        KnowledgeFSServiceSourceUpdatePayload.model_validate({"name": "edited", **payload})


def test_service_sources_retain_managed_credentials_and_scope_boundaries() -> None:
    source = {"name": "source", "type": "web", "uri": "https://example.com"}
    for extra in [{"credentials": {"secret": "not-allowed"}}, {"permissionScope": ["scope-a"]}]:
        with pytest.raises(ValidationError):
            KnowledgeFSServiceSourceCreatePayload.model_validate({**source, **extra})
    assert KnowledgeFSServiceSourceCreatePayload.model_validate(source).permission_scope == []
    with pytest.raises(ValidationError):
        KnowledgeFSServiceSourceConnectionCreatePayload.model_validate(
            {"name": "binding", "providerId": "plugin-daemon-website", "credentials": {"apiKey": "secret"}}
        )


def test_compilation_and_bulk_failures_survive_safe_serialization() -> None:
    compilation = KnowledgeFSDocumentCompilationJobResponse.model_validate(
        {
            "id": "job-1",
            "knowledgeSpaceId": "space-1",
            "documentAssetId": "asset-1",
            "stage": "failed",
            "createdAt": 1,
            "updatedAt": 2,
            "version": 1,
            "failure": _FAILURE,
        }
    ).model_dump(mode="json")
    assert compilation["failure"]["code"] == "KNOWLEDGE_FS_RATE_LIMITED"
    assert "untrusted" not in compilation["failure"]["message"]
    bulk = KnowledgeFSBulkJobResponse.model_validate(
        {
            "id": "bulk-1",
            "knowledgeSpaceId": "space-1",
            "createdAt": _NOW,
            "updatedAt": _NOW,
            "type": "document_reindex",
            "status": "failed",
            "totalItems": 1,
            "completedItems": 0,
            "canceledItems": 0,
            "failedItems": 1,
            "failedItemIds": ["document-1"],
            "failures": [
                {
                    "documentId": "document-1",
                    "jobId": "job-1",
                    "errorCode": "KNOWLEDGE_FS_RATE_LIMITED",
                    "errorMessage": "Safe error",
                    "failure": _FAILURE,
                }
            ],
        }
    ).model_dump(mode="json")
    assert bulk["failures"][0]["job_id"] == "job-1"
    assert bulk["failures"][0]["failure"]["code"] == "KNOWLEDGE_FS_RATE_LIMITED"


def test_logical_read_exposes_current_cas_and_pagination(runtime) -> None:
    raw = {
        "id": "doc-1",
        "knowledgeSpaceId": "space-1",
        "active": None,
        "rowVersion": 7,
        "title": "Document",
        "status": "pending",
        "userMetadata": {"team": "docs"},
        "createdAt": _NOW,
        "updatedAt": _NOW,
    }
    runtime.facade.execute_service.return_value = {"items": [raw], "nextCursor": "next"}
    with Flask(__name__).test_request_context("/?limit=17&cursor=prev"):
        result = resources.KnowledgeFSServiceLogicalDocumentsApi().get("control-1")
    assert result["data"][0]["row_version"] == 7
    assert result["data"][0]["id"] == "doc-1"
    assert runtime.facade.execute_service.call_args.kwargs["query"] == (("limit", "17"), ("cursor", "prev"))


def test_deletion_links_and_partial_batch_results_stay_on_public_origin(
    runtime, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, SERVICE_API_URL="https://api.example/v1")
    accepted = {"documentId": "document-1", "job": _job(), "statusUrl": "http://internal/deletion-jobs/job-1"}
    runtime.facade.execute_service.return_value = {
        "items": [accepted],
        "total": 2,
        "batchId": "batch-1",
        "statusUrl": "http://internal/batches/batch-1",
        "results": [
            {**accepted, "status": "accepted"},
            {
                "documentId": "document-2",
                "status": "rejected",
                "error": {"code": "CONFLICT", "message": "Safe", "retryable": False},
            },
        ],
    }
    with Flask(__name__).test_request_context(
        "/",
        method="DELETE",
        json={"documents": [{"documentId": "document-1", "expectedRevision": 1}]},
        headers={"Idempotency-Key": "delete-once"},
    ):
        result, status, headers = resources.KnowledgeFSServiceBulkDocumentsApi().delete("control-1")
    assert status == 202
    assert headers["Location"] == "https://api.example/v1/knowledge-fs/spaces/control-1/deletion-batches/batch-1"
    assert result["results"][1]["status"] == "rejected"
    assert (
        result["results"][0]["status_url"] == "https://api.example/v1/knowledge-fs/spaces/control-1/deletion-jobs/job-1"
    )
    assert "internal" not in str(result)


@pytest.mark.parametrize("kind", ["pages", "files"])
def test_legacy_source_import_adapts_coordinates_and_admits_durable_workflow(runtime, kind: str) -> None:
    runtime.facade.execute_service.return_value = _workflow()
    if kind == "pages":
        payload = {"pages": [{"workspaceId": "ws-1", "pageId": "page-1", "type": "page"}]}
        resource = resources.KnowledgeFSServiceSourcePageImportApi()
        coordinate = '["ws-1","page-1"]'
    else:
        payload = {"files": [{"bucket": "bucket-1", "id": "file-1", "name": "file.txt"}]}
        resource = resources.KnowledgeFSServiceSourceFileImportApi()
        coordinate = '["bucket-1","file-1"]'
    with Flask(__name__).test_request_context(
        "/", method="POST", json=payload, headers={"Idempotency-Key": "import-once"}
    ):
        result, status = resource.post("control-1", "source-1")
    assert status == 202
    assert result["id"] == "run-1"
    kwargs = runtime.facade.execute_service.call_args.kwargs
    assert kwargs["operation_id"] == "importSourceWorkflow"
    assert kwargs["headers"] == (("Idempotency-Key", "import-once"),)
    assert kwargs["payload"].model_dump(mode="json", by_alias=True)["items"][0]["providerItemId"] == coordinate


def test_malformed_upstream_is_502_and_invalid_input_is_400_without_input_echo(runtime) -> None:
    runtime.facade.execute_service.return_value = {}
    with Flask(__name__).test_request_context("/"):
        with pytest.raises(KnowledgeFSServiceUpstreamUnavailableHTTPError):
            resources.KnowledgeFSServiceLogicalDocumentApi().get("control-1", "doc-1")
    runtime.facade.execute_service.reset_mock()
    with Flask(__name__).test_request_context("/?limit=private-invalid-value"):
        with pytest.raises(KnowledgeFSServiceInvalidRequestHTTPError) as caught:
            resources.KnowledgeFSServiceLogicalDocumentsApi().get("control-1")
    assert "private-invalid-value" not in str(caught.value.data)
    runtime.facade.execute_service.assert_not_called()


def test_resume_binds_original_task_and_processing_history_preserves_superseded(runtime) -> None:
    runtime.facade.execute_service.return_value = {
        "items": [
            {
                "id": "attempt-1",
                "documentId": "doc-1",
                "documentRevision": 1,
                "knowledgeSpaceId": "space-1",
                "state": "superseded",
                "stage": "queued",
                "progressPercent": 0,
                "createdAt": _NOW,
                "updatedAt": _NOW,
            }
        ]
    }
    with Flask(__name__).test_request_context("/"):
        response = resources.KnowledgeFSServiceDocumentProcessingTasksApi().get("control-1", "doc-1")
    assert response["data"][0]["state"] == "superseded"
    assert runtime.facade.execute_service.call_args.kwargs["resource_id"] == "doc-1"
    runtime.facade.execute_service.return_value = {
        "id": "task-1",
        "knowledgeSpaceId": "space-1",
        "query": "q",
        "cost": {},
        "metadata": {},
        "stage": "retrieving",
        "createdAt": 1,
        "updatedAt": 2,
    }
    with Flask(__name__).test_request_context("/", method="POST"):
        response = resources.KnowledgeFSServiceResearchTaskResumeApi().post("control-1", "task-1")
    assert response["id"] == "task-1"
    assert runtime.facade.execute_service.call_args.kwargs["operation_id"] == "resumeResearchTask"
    assert runtime.facade.execute_service.call_args.kwargs["resource_id"] == "task-1"


@pytest.mark.parametrize("status", [503, 504])
def test_service_preserves_temporary_failure_status_and_safe_violations(status: int) -> None:
    from core.knowledge_fs.errors import KnowledgeFSProductRequestRejectedError

    @resources._service_api_errors
    def rejected():
        raise KnowledgeFSProductRequestRejectedError(
            status_code=status,
            violations=[{"field": ["query"], "type": "too_long"}],
        )

    with pytest.raises(Exception) as error:
        rejected()
    assert error.value.code == status
    assert error.value.data["violations"] == [{"field": ["query"], "type": "too_long"}]


@pytest.mark.usefixtures("runtime")
def test_service_image_upload_uses_authenticated_profile_and_typed_response(monkeypatch: pytest.MonkeyPatch) -> None:
    import io

    upload = MagicMock(return_value={"upload_file_id": "image-1", "byte_size": 8, "mime_type": "image/png"})
    monkeypatch.setattr(resources, "upload_service_query_image", upload)
    with Flask(__name__).test_request_context("/", method="POST", data={"file": (io.BytesIO(b"fakepng"), "image.png")}):
        response, status = resources.KnowledgeFSServiceQueryImagesApi().post("control-1")
    assert status == 201
    assert response == {"upload_file_id": "image-1", "byte_size": 8, "mime_type": "image/png"}
    assert upload.call_args.kwargs["profile"].tenant_id == "tenant-1"
    assert upload.call_args.kwargs["file"].filename == "image.png"


def test_image_admission_checks_ownership_before_issuing_a_capability(runtime, monkeypatch: pytest.MonkeyPatch) -> None:
    from core.knowledge_fs.errors import KnowledgeFSProductRequestRejectedError

    runtime.broker = MagicMock()
    validator = MagicMock(side_effect=KnowledgeFSProductRequestRejectedError(status_code=422))
    monkeypatch.setattr(resources, "validate_service_query_image_references", validator)
    with Flask(__name__).test_request_context(
        "/",
        method="POST",
        json={"queryImages": [{"uploadFileId": "b3d672a0-f379-4c3a-ad89-6eac80aa3efd"}]},
    ):
        with pytest.raises(Exception) as error:
            resources.KnowledgeFSServiceQueryAdmissionApi().post("control-1")
    assert error.value.code == 422
    runtime.broker.issue_service.assert_not_called()
    validator.assert_called_once()


def test_atomic_crawl_edit_rejects_inline_document_content() -> None:
    from services.knowledge_fs.product_dto import KnowledgeFSCrawlImportPayload

    payload = {
        "sourceUrls": ["https://example.com/a"],
        "pages": [{"sourceUrl": "https://example.com/a", "content": "document"}],
    }
    assert KnowledgeFSCrawlImportPayload.model_validate(payload).pages is not None
    with pytest.raises(ValidationError):
        KnowledgeFSCrawlImportPayload.model_validate(
            {
                **payload,
                "sourceUpdate": {"expectedVersion": 3},
                "desiredSyncPolicy": {"enabled": False, "mode": "manual"},
            }
        )


@pytest.mark.parametrize(
    ("controller", "arguments", "operation", "resource_id", "path_parameters"),
    [
        (
            resources.KnowledgeFSServiceDeletionJobApi,
            ("control-1", "job-1"),
            "getDeletionJob",
            "job-1",
            (("jobId", "job-1"),),
        ),
        (
            resources.KnowledgeFSServiceSettingsMigrationApi,
            ("control-1", "migration-1"),
            "getProfileMigration",
            None,
            (("migrationId", "migration-1"),),
        ),
        (
            resources.KnowledgeFSServiceSourceSyncPolicyApi,
            ("control-1", "source-1"),
            "getSourceSyncPolicy",
            "source-1",
            (("sourceId", "source-1"),),
        ),
        (
            resources.KnowledgeFSServiceSourceWorkflowApi,
            ("control-1", "run-1"),
            "getSourceWorkflow",
            "run-1",
            (("runId", "run-1"),),
        ),
        (
            resources.KnowledgeFSServiceDocumentProcessingTaskApi,
            ("control-1", "document-1", "task-1"),
            "getDocumentProcessingTask",
            "task-1",
            (("documentId", "document-1"), ("taskId", "task-1")),
        ),
    ],
)
def test_recovery_reads_keep_the_authorized_space_and_child_resource_binding(
    runtime,
    monkeypatch: pytest.MonkeyPatch,
    controller,
    arguments,
    operation,
    resource_id,
    path_parameters,
) -> None:
    profile = object()
    authorize = MagicMock(return_value=profile)
    monkeypatch.setattr(resources, "_profile", authorize)
    monkeypatch.setattr(resources, "_dump_response", lambda _schema, raw: raw)
    upstream = {"id": resource_id}
    runtime.facade.execute_service.return_value = upstream
    with Flask(__name__).test_request_context("/", method="GET"):
        assert controller().get(*arguments) is upstream
    authorize.assert_called_once_with(runtime, operation_id=operation, control_space_id="control-1")
    call = runtime.facade.execute_service.call_args.kwargs
    assert call["profile"] is profile
    assert call["operation_id"] == operation
    assert call["resource_id"] == resource_id
    assert call["path_parameters"] == path_parameters


def test_source_workflow_history_keeps_source_filter_and_bounded_pagination(
    runtime, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(resources, "_dump_response", lambda _schema, raw: raw)
    with Flask(__name__).test_request_context("/?source_id=source-1&cursor=next-page&limit=25"):
        resources.KnowledgeFSServiceSourceWorkflowsApi().get("control-1")
    call = runtime.facade.execute_service.call_args.kwargs
    assert call["operation_id"] == "listSourceWorkflows"
    assert dict(call["query"]) == {"sourceId": "source-1", "cursor": "next-page", "limit": "25"}


def test_preview_selection_is_a_durable_idempotent_import_admission(runtime) -> None:
    runtime.facade.execute_service.return_value = _workflow()
    with Flask(__name__).test_request_context(
        "/",
        method="POST",
        json={"pageIds": ["page-1"]},
        headers={"Idempotency-Key": "selection-request-1"},
    ):
        result, status = resources.KnowledgeFSServiceCrawlPreviewSelectionApi().post("control-1", "run-1")
    assert status == 202
    assert result["id"] == "run-1"
    call = runtime.facade.execute_service.call_args.kwargs
    assert call["operation_id"] == "selectCrawlPreviewPages"
    assert call["resource_id"] == "run-1"
    assert call["headers"] == (("Idempotency-Key", "selection-request-1"),)
    assert call["payload"].page_ids == ["page-1"]


@pytest.mark.parametrize(
    ("controller", "method", "arguments", "operation", "body", "resource_id", "path_parameters", "requires_key"),
    [
        (
            resources.KnowledgeFSServiceSourceSyncApi,
            "post",
            ("control-1", "source-1"),
            "syncSource",
            None,
            "source-1",
            (("sourceId", "source-1"),),
            True,
        ),
        (
            resources.KnowledgeFSServiceSourceCrawlPreviewApi,
            "post",
            ("control-1", "source-1"),
            "previewSourceCrawl",
            None,
            "source-1",
            (("sourceId", "source-1"),),
            True,
        ),
        (
            resources.KnowledgeFSServiceSourceCrawlImportApi,
            "post",
            ("control-1", "source-1"),
            "importSelectedSourceCrawl",
            {"sourceUrls": ["https://example.com/a"]},
            "source-1",
            (("sourceId", "source-1"),),
            True,
        ),
        (
            resources.KnowledgeFSServiceSourceWorkflowImportApi,
            "post",
            ("control-1", "source-1"),
            "importSourceWorkflow",
            {
                "kind": "online-drive-import",
                "items": [{"id": "file-1", "name": "file.pdf", "providerItemId": "provider-1"}],
            },
            "source-1",
            (("sourceId", "source-1"),),
            True,
        ),
        (
            resources.KnowledgeFSServiceSourceSyncPolicyApi,
            "put",
            ("control-1", "source-1"),
            "updateSourceSyncPolicy",
            {"expectedRevision": 3, "expectedSourceVersion": 4, "enabled": False, "mode": "manual"},
            "source-1",
            (("sourceId", "source-1"),),
            False,
        ),
        (
            resources.KnowledgeFSServiceSourceConnectionsApi,
            "get",
            ("control-1",),
            "listSourceConnections",
            None,
            None,
            (),
            False,
        ),
        (
            resources.KnowledgeFSServiceSourceConnectionsApi,
            "post",
            ("control-1",),
            "createSourceConnection",
            {
                "name": "managed binding",
                "providerId": "plugin-daemon-website",
                "configuration": {"credentialId": "credential-1"},
            },
            None,
            (),
            False,
        ),
        (
            resources.KnowledgeFSServiceSourceConnectionRefreshApi,
            "post",
            ("control-1", "connection-1"),
            "refreshSourceConnection",
            {"expectedVersion": 3},
            None,
            (("connectionId", "connection-1"),),
            False,
        ),
        (
            resources.KnowledgeFSServiceSourceWorkflowCancelApi,
            "post",
            ("control-1", "run-1"),
            "cancelSourceWorkflow",
            {"reason": "source selection changed"},
            "run-1",
            (("runId", "run-1"),),
            False,
        ),
        (
            resources.KnowledgeFSServiceSourceWorkflowRetryApi,
            "post",
            ("control-1", "run-1"),
            "retrySourceWorkflow",
            None,
            "run-1",
            (("runId", "run-1"),),
            False,
        ),
        (
            resources.KnowledgeFSServiceCrawlPreviewPagesApi,
            "get",
            ("control-1", "run-1"),
            "listCrawlPreviewPages",
            None,
            "run-1",
            (("runId", "run-1"),),
            False,
        ),
        (
            resources.KnowledgeFSServiceSourceProvidersApi,
            "get",
            ("control-1",),
            "listSourceProviders",
            None,
            None,
            (),
            False,
        ),
    ],
)
def test_durable_source_contracts_bind_the_original_profile_and_resource(
    runtime,
    monkeypatch: pytest.MonkeyPatch,
    controller,
    method,
    arguments,
    operation,
    body,
    resource_id,
    path_parameters,
    requires_key,
) -> None:
    profile = object()
    authorize = MagicMock(return_value=profile)
    monkeypatch.setattr(resources, "_profile", authorize)
    monkeypatch.setattr(resources, "_dump_response", lambda _schema, raw: raw)
    with Flask(__name__).test_request_context(
        "/",
        method=method.upper(),
        json=body,
        headers={"Idempotency-Key": "source-command-1"},
    ):
        getattr(controller(), method)(*arguments)
    authorize.assert_called_once_with(runtime, operation_id=operation, control_space_id="control-1")
    call = runtime.facade.execute_service.call_args.kwargs
    assert call["profile"] is profile
    assert call["resource_id"] == resource_id
    assert call["path_parameters"] == path_parameters
    if requires_key:
        assert call["headers"] == (("Idempotency-Key", "source-command-1"),)
    if body is not None:
        forwarded = call["payload"].model_dump(by_alias=True, exclude_none=True)
        for field, value in body.items():
            assert forwarded[field] == value
