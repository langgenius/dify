from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from hashlib import sha256
from http import HTTPStatus
from inspect import unwrap
from types import SimpleNamespace
from typing import Literal
from unittest.mock import MagicMock

import pytest
from flask import Flask
from flask_restx import Resource
from pydantic import BaseModel
from werkzeug.exceptions import NotFound, ServiceUnavailable

from controllers.console.knowledge_fs import resources as console_resources
from controllers.console.knowledge_fs.error import (
    KnowledgeFSAccessDeniedHTTPError,
    KnowledgeFSConflictHTTPError,
    KnowledgeFSInvalidRequestHTTPError,
    KnowledgeFSOperationUnavailableHTTPError,
    KnowledgeFSRateLimitHTTPError,
    KnowledgeFSRequestRejectedHTTPError,
    KnowledgeFSRequestTooLargeHTTPError,
    KnowledgeFSResourceNotFoundHTTPError,
    KnowledgeFSSpaceNotFoundHTTPError,
    KnowledgeFSUpstreamUnavailableHTTPError,
)
from controllers.service_api.knowledge_fs import resources as service_resources
from controllers.service_api.knowledge_fs.error import (
    KnowledgeFSInvalidCredentialHTTPError,
    KnowledgeFSServiceAccessDeniedHTTPError,
    KnowledgeFSServiceConflictHTTPError,
    KnowledgeFSServiceInvalidRequestHTTPError,
    KnowledgeFSServiceOperationUnavailableHTTPError,
    KnowledgeFSServiceRateLimitHTTPError,
    KnowledgeFSServiceRequestRejectedHTTPError,
    KnowledgeFSServiceRequestTooLargeHTTPError,
    KnowledgeFSServiceResourceNotFoundHTTPError,
    KnowledgeFSServiceUpstreamUnavailableHTTPError,
)
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs.product_dto import (
    KnowledgeFSOverviewBaseStatsResponse,
    KnowledgeFSOverviewQueryOutcomesResponse,
    KnowledgeFSPublicFailureResponse,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSSourceResponse,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSStreamCapabilityPayload,
)
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError
from services.knowledge_fs.runtime import KnowledgeFSRuntime
from tests.unit_tests.config_override import apply_config_overrides

_RAW_RESULT = object()


def source_response(**overrides: object) -> KnowledgeFSSourceResponse:
    return KnowledgeFSSourceResponse.model_validate(
        {
            "id": "source-1",
            "created_at": datetime(2026, 1, 1, tzinfo=UTC),
            "updated_at": datetime(2026, 1, 1, tzinfo=UTC),
            "knowledge_space_id": "space-1",
            "name": "Source",
            "permission_scope": [],
            "status": "active",
            "metadata": {},
            "type": "web",
            "uri": "https://example.com",
            "version": 1,
            **overrides,
        }
    )


def _invoke[R](resource_type: type[Resource], handler: Callable[..., R], *args: object) -> R:
    return unwrap(handler)(resource_type(), *args)


# Each case names the public resource, HTTP method, route arguments, and the one
# application boundary that owns the operation. Route-specific identifiers are
# asserted below so accidental delegation to a sibling resource is observable.
_CONSOLE_DELEGATION_CASES = (
    (
        console_resources.KnowledgeFSSpacesApi,
        console_resources.KnowledgeFSSpacesApi.get,
        (),
        "application",
        "list_spaces",
        dict[str, object](),
    ),
    (
        console_resources.KnowledgeFSSpacesApi,
        console_resources.KnowledgeFSSpacesApi.post,
        (),
        "application",
        "create_space",
        dict[str, object](),
    ),
    (
        console_resources.KnowledgeFSSpaceApi,
        console_resources.KnowledgeFSSpaceApi.get,
        ("space-1",),
        "application",
        "get_space",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceApi,
        console_resources.KnowledgeFSSpaceApi.patch,
        ("space-1",),
        "application",
        "update_space",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceApi,
        console_resources.KnowledgeFSSpaceApi.delete,
        ("space-1",),
        "application",
        "delete_space",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpacePermissionsApi,
        console_resources.KnowledgeFSSpacePermissionsApi.get,
        ("space-1",),
        "control_plane",
        "list_permissions",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceMembersApi,
        console_resources.KnowledgeFSSpaceMembersApi.put,
        ("space-1",),
        "control_plane",
        "replace_members",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceExternalAccessApi,
        console_resources.KnowledgeFSSpaceExternalAccessApi.get,
        ("space-1",),
        "control_plane",
        "get_external_access",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceExternalAccessApi,
        console_resources.KnowledgeFSSpaceExternalAccessApi.put,
        ("space-1",),
        "control_plane",
        "update_external_access",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceAppBindingsApi,
        console_resources.KnowledgeFSSpaceAppBindingsApi.get,
        ("space-1",),
        "app_bindings",
        "list",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceAppBindingsApi,
        console_resources.KnowledgeFSSpaceAppBindingsApi.put,
        ("space-1",),
        "app_bindings",
        "upsert",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceAppBindingApi,
        console_resources.KnowledgeFSSpaceAppBindingApi.delete,
        ("space-1", KnowledgeFSAppSpaceJoinType.AGENT.value, "app-1"),
        "app_bindings",
        "revoke",
        {
            "control_space_id": "space-1",
            "app_id": "app-1",
            "caller_kind": KnowledgeFSAppSpaceJoinType.AGENT,
        },
    ),
    (
        console_resources.KnowledgeFSSpaceSettingsApi,
        console_resources.KnowledgeFSSpaceSettingsApi.get,
        ("space-1",),
        "facade",
        "get_settings",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSettingsApi,
        console_resources.KnowledgeFSSpaceSettingsApi.patch,
        ("space-1",),
        "facade",
        "update_settings",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceOverviewQueryOutcomesApi,
        console_resources.KnowledgeFSSpaceOverviewQueryOutcomesApi.get,
        ("space-1",),
        "facade",
        "get_overview_query_outcomes",
        {"control_space_id": "space-1", "window": "24h"},
    ),
    (
        console_resources.KnowledgeFSSpaceOverviewInventoryApi,
        console_resources.KnowledgeFSSpaceOverviewInventoryApi.get,
        ("space-1",),
        "facade",
        "get_overview_inventory",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceOverviewAttentionApi,
        console_resources.KnowledgeFSSpaceOverviewAttentionApi.get,
        ("space-1",),
        "facade",
        "list_overview_attention",
        {"control_space_id": "space-1", "include_dismissed": False, "limit": 50},
    ),
    (
        console_resources.KnowledgeFSSpaceOverviewActivityApi,
        console_resources.KnowledgeFSSpaceOverviewActivityApi.get,
        ("space-1",),
        "facade",
        "list_overview_activity",
        {
            "control_space_id": "space-1",
            "action": None,
            "actor_id": None,
            "actor_type": None,
            "cursor": None,
            "from_at": None,
            "limit": 50,
            "resource_type": None,
            "result": None,
            "to_at": None,
        },
    ),
    (
        console_resources.KnowledgeFSSpaceOverviewHealthApi,
        console_resources.KnowledgeFSSpaceOverviewHealthApi.get,
        ("space-1",),
        "facade",
        "get_overview_health",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceDocumentsApi,
        console_resources.KnowledgeFSSpaceDocumentsApi.get,
        ("space-1",),
        "facade",
        "list_documents",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceBulkDocumentsApi,
        console_resources.KnowledgeFSSpaceBulkDocumentsApi.delete,
        ("space-1",),
        "facade",
        "bulk_delete_documents",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceDocumentReindexApi,
        console_resources.KnowledgeFSSpaceDocumentReindexApi.post,
        ("space-1",),
        "facade",
        "reindex_documents",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceDocumentApi,
        console_resources.KnowledgeFSSpaceDocumentApi.get,
        ("space-1", "document-1"),
        "facade",
        "get_document",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceDocumentApi,
        console_resources.KnowledgeFSSpaceDocumentApi.patch,
        ("space-1", "document-1"),
        "facade",
        "update_document_metadata",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceMetadataApi,
        console_resources.KnowledgeFSSpaceMetadataApi.get,
        ("space-1",),
        "facade",
        "list_metadata_fields",
        {"control_space_id": "space-1", "cursor": None, "limit": 100},
    ),
    (
        console_resources.KnowledgeFSSpaceMetadataApi,
        console_resources.KnowledgeFSSpaceMetadataApi.post,
        ("space-1",),
        "facade",
        "create_metadata_field",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceMetadataFieldApi,
        console_resources.KnowledgeFSSpaceMetadataFieldApi.patch,
        ("space-1", "field-1"),
        "facade",
        "update_metadata_field",
        {"control_space_id": "space-1", "field_id": "field-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceDocumentApi,
        console_resources.KnowledgeFSSpaceDocumentApi.delete,
        ("space-1", "document-1"),
        "facade",
        "delete_document",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceLogicalDocumentApi,
        console_resources.KnowledgeFSSpaceLogicalDocumentApi.delete,
        ("space-1", "document-1"),
        "facade",
        "delete_logical_document",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceDocumentOutlineApi,
        console_resources.KnowledgeFSSpaceDocumentOutlineApi.get,
        ("space-1", "document-1"),
        "facade",
        "get_document_outline",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceDocumentRevisionsApi,
        console_resources.KnowledgeFSSpaceDocumentRevisionsApi.get,
        ("space-1", "document-1"),
        "facade",
        "list_document_revisions",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceDocumentChunksApi,
        console_resources.KnowledgeFSSpaceDocumentChunksApi.get,
        ("space-1", "document-1", 3),
        "facade",
        "list_document_chunks",
        {"control_space_id": "space-1", "document_id": "document-1", "revision": 3},
    ),
    (
        console_resources.KnowledgeFSSpaceDocumentChunkApi,
        console_resources.KnowledgeFSSpaceDocumentChunkApi.get,
        ("space-1", "document-1", 3, "chunk-1"),
        "facade",
        "get_document_chunk",
        {
            "control_space_id": "space-1",
            "document_id": "document-1",
            "revision": 3,
            "chunk_id": "chunk-1",
        },
    ),
    (
        console_resources.KnowledgeFSSpaceCompilationJobApi,
        console_resources.KnowledgeFSSpaceCompilationJobApi.get,
        ("space-1", "job-1"),
        "facade",
        "get_compilation_job",
        {"control_space_id": "space-1", "job_id": "job-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceCompilationJobApi,
        console_resources.KnowledgeFSSpaceCompilationJobApi.delete,
        ("space-1", "job-1"),
        "facade",
        "cancel_compilation_job",
        {"control_space_id": "space-1", "job_id": "job-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceCompilationJobRetryApi,
        console_resources.KnowledgeFSSpaceCompilationJobRetryApi.post,
        ("space-1", "job-1"),
        "facade",
        "retry_compilation_job",
        {"control_space_id": "space-1", "job_id": "job-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceBulkJobApi,
        console_resources.KnowledgeFSSpaceBulkJobApi.get,
        ("space-1", "job-1"),
        "facade",
        "get_bulk_job",
        {"control_space_id": "space-1", "job_id": "job-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceBackgroundTasksApi,
        console_resources.KnowledgeFSSpaceBackgroundTasksApi.get,
        ("space-1",),
        "facade",
        "list_background_tasks",
        {"control_space_id": "space-1", "cursor": None, "limit": 50},
    ),
    (
        console_resources.KnowledgeFSSpaceBackgroundTaskCancelApi,
        console_resources.KnowledgeFSSpaceBackgroundTaskCancelApi.post,
        ("space-1", "source", "task-1"),
        "facade",
        "cancel_background_task",
        {"control_space_id": "space-1", "task_kind": "source", "task_id": "task-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceBackgroundTaskRetryApi,
        console_resources.KnowledgeFSSpaceBackgroundTaskRetryApi.post,
        ("space-1", "document_bulk", "task-1"),
        "facade",
        "retry_background_task",
        {
            "control_space_id": "space-1",
            "task_kind": "document_bulk",
            "task_id": "task-1",
        },
    ),
    (
        console_resources.KnowledgeFSSpaceSourcesApi,
        console_resources.KnowledgeFSSpaceSourcesApi.get,
        ("space-1",),
        "facade",
        "list_sources",
        {"control_space_id": "space-1", "limit": 50},
    ),
    (
        console_resources.KnowledgeFSSpaceSourcesApi,
        console_resources.KnowledgeFSSpaceSourcesApi.post,
        ("space-1",),
        "facade",
        "create_source",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSourceApi,
        console_resources.KnowledgeFSSpaceSourceApi.get,
        ("space-1", "source-1"),
        "facade",
        "get_source",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSourceApi,
        console_resources.KnowledgeFSSpaceSourceApi.patch,
        ("space-1", "source-1"),
        "facade",
        "update_source",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSourceApi,
        console_resources.KnowledgeFSSpaceSourceApi.delete,
        ("space-1", "source-1"),
        "facade",
        "delete_source",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSourceTestApi,
        console_resources.KnowledgeFSSpaceSourceTestApi.post,
        ("space-1", "source-1"),
        "facade",
        "test_source",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSourceSyncApi,
        console_resources.KnowledgeFSSpaceSourceSyncApi.post,
        ("space-1", "source-1"),
        "facade",
        "sync_source",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSourceWorkflowImportApi,
        console_resources.KnowledgeFSSpaceSourceWorkflowImportApi.post,
        ("space-1", "source-1"),
        "facade",
        "import_source_workflow",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSourcePagesApi,
        console_resources.KnowledgeFSSpaceSourcePagesApi.get,
        ("space-1", "source-1"),
        "facade",
        "list_source_pages",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSourcePageImportApi,
        console_resources.KnowledgeFSSpaceSourcePageImportApi.post,
        ("space-1", "source-1"),
        "facade",
        "import_source_pages",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSourceFilesApi,
        console_resources.KnowledgeFSSpaceSourceFilesApi.get,
        ("space-1", "source-1"),
        "facade",
        "list_source_files",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSourceFileImportApi,
        console_resources.KnowledgeFSSpaceSourceFileImportApi.post,
        ("space-1", "source-1"),
        "facade",
        "import_source_files",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceResearchTasksApi,
        console_resources.KnowledgeFSSpaceResearchTasksApi.get,
        ("space-1",),
        "facade",
        "list_research_tasks",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceResearchTasksApi,
        console_resources.KnowledgeFSSpaceResearchTasksApi.post,
        ("space-1",),
        "facade",
        "create_research_task",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceResearchTaskPlanApi,
        console_resources.KnowledgeFSSpaceResearchTaskPlanApi.post,
        ("space-1",),
        "facade",
        "plan_research_task",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceResearchTaskApi,
        console_resources.KnowledgeFSSpaceResearchTaskApi.get,
        ("space-1", "task-1"),
        "facade",
        "get_research_task",
        {"control_space_id": "space-1", "task_id": "task-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceResearchTaskApi,
        console_resources.KnowledgeFSSpaceResearchTaskApi.delete,
        ("space-1", "task-1"),
        "facade",
        "cancel_research_task",
        {"control_space_id": "space-1", "task_id": "task-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceResearchTaskPartialsApi,
        console_resources.KnowledgeFSSpaceResearchTaskPartialsApi.get,
        ("space-1", "task-1"),
        "facade",
        "list_research_task_partials",
        {"control_space_id": "space-1", "task_id": "task-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceTracesApi,
        console_resources.KnowledgeFSSpaceTracesApi.get,
        ("space-1",),
        "facade",
        "list_traces",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceTraceApi,
        console_resources.KnowledgeFSSpaceTraceApi.get,
        ("space-1", "trace-1"),
        "facade",
        "get_trace",
        {"control_space_id": "space-1", "trace_id": "trace-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceTraceEvidenceApi,
        console_resources.KnowledgeFSSpaceTraceEvidenceApi.get,
        ("space-1", "trace-1"),
        "facade",
        "list_trace_entries",
        {"control_space_id": "space-1", "trace_id": "trace-1", "kind": "evidence"},
    ),
    (
        console_resources.KnowledgeFSSpaceTraceConflictsApi,
        console_resources.KnowledgeFSSpaceTraceConflictsApi.get,
        ("space-1", "trace-1"),
        "facade",
        "list_trace_entries",
        {"control_space_id": "space-1", "trace_id": "trace-1", "kind": "conflicts"},
    ),
    (
        console_resources.KnowledgeFSSpaceTraceMissingApi,
        console_resources.KnowledgeFSSpaceTraceMissingApi.get,
        ("space-1", "trace-1"),
        "facade",
        "list_trace_entries",
        {"control_space_id": "space-1", "trace_id": "trace-1", "kind": "missing"},
    ),
    (
        console_resources.KnowledgeFSSpaceUploadSessionsApi,
        console_resources.KnowledgeFSSpaceUploadSessionsApi.post,
        ("space-1",),
        "facade",
        "create_upload_session",
        {"control_space_id": "space-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceUploadSessionPartPresignApi,
        console_resources.KnowledgeFSSpaceUploadSessionPartPresignApi.post,
        ("space-1", "session-1", 3),
        "facade",
        "presign_upload_session_part",
        {"control_space_id": "space-1", "upload_session_id": "session-1", "part_number": 3},
    ),
    (
        console_resources.KnowledgeFSSpaceUploadSessionCompleteApi,
        console_resources.KnowledgeFSSpaceUploadSessionCompleteApi.post,
        ("space-1", "session-1"),
        "facade",
        "complete_upload_session",
        {"control_space_id": "space-1", "upload_session_id": "session-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceUploadSessionAbortApi,
        console_resources.KnowledgeFSSpaceUploadSessionAbortApi.post,
        ("space-1", "session-1"),
        "facade",
        "abort_upload_session",
        {"control_space_id": "space-1", "upload_session_id": "session-1"},
    ),
    (
        console_resources.KnowledgeFSSpaceSmallFileUploadApi,
        console_resources.KnowledgeFSSpaceSmallFileUploadApi.post,
        ("space-1", "session-1"),
        "facade",
        "upload_small_file",
        {"control_space_id": "space-1", "upload_session_id": "session-1"},
    ),
)


@pytest.mark.parametrize(
    ("class_name", "method_name", "route_args", "component_name", "delegate_name", "expected_fields"),
    _CONSOLE_DELEGATION_CASES,
)
def test_console_resources_delegate_one_tenant_scoped_product_operation(
    monkeypatch: pytest.MonkeyPatch,
    class_name: type[Resource],
    method_name: Callable[..., object],
    route_args: tuple[object, ...],
    component_name: str,
    delegate_name: str,
    expected_fields: dict[str, object],
) -> None:
    payload = (
        KnowledgeFSSourceUpdatePayload(name="Renamed")
        if class_name.__name__ == "KnowledgeFSSpaceSourceApi" and method_name.__name__ == "patch"
        else SimpleNamespace(members=("member-1",), query_images=[])
    )
    runtime = SimpleNamespace(
        application=MagicMock(),
        control_plane=MagicMock(),
        app_bindings=MagicMock(),
        facade=MagicMock(),
    )
    component = {
        "application": runtime.application,
        "control_plane": runtime.control_plane,
        "app_bindings": runtime.app_bindings,
        "facade": runtime.facade,
    }[component_name]
    delegate = MagicMock(return_value=_RAW_RESULT)
    component.configure_mock(**{delegate_name: delegate})
    dump_response = MagicMock(side_effect=lambda schema, raw: (schema.__name__, raw))
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    monkeypatch.setattr(console_resources, "_payload", lambda _: payload)
    monkeypatch.setattr(console_resources, "_idempotency_key", lambda: "idempotency-1")
    monkeypatch.setattr(console_resources, "_query_pairs", lambda _: (("normalized", "true"),))
    monkeypatch.setattr(console_resources, "dump_response", dump_response)
    app = Flask(__name__)

    with app.test_request_context("/", method="POST"):
        result = _invoke(class_name, method_name, *route_args)

    delegate.assert_called_once()
    call_fields = delegate.call_args.kwargs
    assert call_fields["tenant_id"] == "tenant-1"
    assert call_fields.get("account_id", call_fields.get("actor_account_id")) == "account-1"
    for field_name, expected in expected_fields.items():
        assert call_fields[field_name] == expected
    if "payload" in call_fields:
        if class_name.__name__ == "KnowledgeFSSpaceSourceApi" and method_name.__name__ == "patch":
            assert call_fields["payload"] == payload
        else:
            assert call_fields["payload"] is payload
    if "members" in call_fields:
        assert call_fields["members"] == ("member-1",)
    if "idempotency_key" in call_fields:
        assert call_fields["idempotency_key"] == "idempotency-1"
    if dump_response.called:
        assert dump_response.call_args.args[1] is _RAW_RESULT
    else:
        assert result == ("", HTTPStatus.NO_CONTENT)


def test_console_document_reference_delegates_exact_asset_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    facade = MagicMock()
    facade.resolve_document_reference.return_value = _RAW_RESULT
    runtime = SimpleNamespace(facade=facade)
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
    app = Flask(__name__)

    with app.test_request_context("/?document_asset_id=asset-1&document_asset_version=7"):
        result = _invoke(
            console_resources.KnowledgeFSSpaceDocumentReferenceApi,
            console_resources.KnowledgeFSSpaceDocumentReferenceApi.get,
            "space-1",
        )

    assert result is _RAW_RESULT
    facade.resolve_document_reference.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="space-1",
        document_asset_id="asset-1",
        document_asset_version=7,
    )


def test_console_space_list_preserves_repeated_creator_filters(monkeypatch: pytest.MonkeyPatch) -> None:
    application = MagicMock()
    application.list_spaces.return_value = _RAW_RESULT
    runtime = SimpleNamespace(application=application)
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
    app = Flask(__name__)

    with app.test_request_context(
        "/?page=2&limit=10&creator_ids=creator-1&creator_ids=creator-2&tag_ids=tag-1&tag_ids=tag-2&query=%20Support%20"
    ):
        result = _invoke(console_resources.KnowledgeFSSpacesApi, console_resources.KnowledgeFSSpacesApi.get)

    application.list_spaces.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        page=2,
        limit=10,
        creator_ids=["creator-1", "creator-2"],
        tag_ids=["tag-1", "tag-2"],
        query="Support",
    )
    assert result is _RAW_RESULT


def test_console_source_update_does_not_start_sync_before_resource_selection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    facade = MagicMock()
    facade.update_source.return_value = _RAW_RESULT
    runtime = SimpleNamespace(facade=facade)
    payload = KnowledgeFSSourceUpdatePayload.model_validate(
        {
            "expectedVersion": 3,
            "status": "disabled",
            "uri": "https://new.example.com",
        }
    )
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    monkeypatch.setattr(console_resources, "_payload", lambda _: payload)
    monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
    app = Flask(__name__)

    with app.test_request_context("/", method="PATCH"):
        result = _invoke(
            console_resources.KnowledgeFSSpaceSourceApi,
            console_resources.KnowledgeFSSpaceSourceApi.patch,
            "space-1",
            "source-1",
        )

    forwarded = facade.update_source.call_args.kwargs["payload"]
    assert forwarded is not payload
    assert forwarded.status == "disabled"
    assert forwarded.sync_after_update is None
    assert result is _RAW_RESULT


@pytest.mark.parametrize(
    ("selection", "expected_import_kind"),
    [
        (
            {"kind": "website_crawl", "sourceUrls": ["https://new.example.com/a"]},
            "website-crawl-import",
        ),
        (
            {
                "kind": "online_document",
                "items": [
                    {
                        "pageId": "page-1",
                        "providerItemId": "provider-page-1",
                        "type": "page",
                        "workspaceId": "workspace-1",
                    }
                ],
            },
            "online-document-import",
        ),
        (
            {
                "kind": "online_drive",
                "items": [{"id": "file-1", "name": "Plan.pdf", "providerItemId": "provider-file-1"}],
            },
            "online-drive-import",
        ),
    ],
)
def test_console_source_update_commits_complete_edit_selection(
    monkeypatch: pytest.MonkeyPatch,
    selection: dict[str, object],
    expected_import_kind: str,
) -> None:
    facade = MagicMock()
    facade.update_source.return_value = SimpleNamespace(version=4)
    selection_kind = selection["kind"]
    assert isinstance(selection_kind, str)
    provider_kind = {"online_document": "online-document", "online_drive": "online-drive"}.get(selection_kind)
    original = source_response(
        metadata={"providerKind": provider_kind} if provider_kind is not None else {},
        type="web" if selection_kind == "website_crawl" else "connector",
        uri="https://old.example.com",
    )
    updated = SimpleNamespace(sync_workflow=None)
    facade.get_source.side_effect = [original, updated]
    workflow = SimpleNamespace(id="workflow-1")
    runtime = SimpleNamespace(facade=facade)
    payload = KnowledgeFSSourceUpdatePayload.model_validate(
        {
            "expectedVersion": 3,
            "name": "Edited source",
            "selection": selection,
            "syncPolicy": {"enabled": True, "mode": "interval"},
        }
    )
    commit = MagicMock(return_value=workflow)
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    monkeypatch.setattr(console_resources, "_payload", lambda _: payload)
    monkeypatch.setattr(console_resources, "commit_source_import", commit)
    monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
    app = Flask(__name__)

    with app.test_request_context("/", method="PATCH"):
        result = _invoke(
            console_resources.KnowledgeFSSpaceSourceApi,
            console_resources.KnowledgeFSSpaceSourceApi.patch,
            "space-1",
            "source-1",
        )

    source_payload = facade.update_source.call_args.kwargs["payload"]
    assert source_payload.status == "disabled"
    assert source_payload.sync_after_update is False
    assert source_payload.selection is None
    assert source_payload.sync_policy is None
    import_payload = commit.call_args.kwargs["payload"]
    assert import_payload.kind == expected_import_kind
    assert commit.call_args.kwargs["idempotency_key"] == "source-edit:source-1:4"
    assert updated.sync_workflow is workflow
    assert result is updated


def test_console_source_update_does_not_import_an_unchanged_complete_selection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    facade = MagicMock()
    source = source_response(
        metadata={"crawled": {"https://example.com/a": {}}},
        sync_policy=None,
        type="web",
        uri="https://example.com",
        version=3,
    )
    facade.get_source.return_value = source
    facade.get_source_sync_policy.return_value = SimpleNamespace(revision=2)
    facade.update_source_sync_policy.return_value = SimpleNamespace(revision=3)
    runtime = SimpleNamespace(facade=facade)
    payload = KnowledgeFSSourceUpdatePayload.model_validate(
        {
            "selection": {"kind": "website_crawl", "sourceUrls": ["https://example.com/a"]},
            "syncPolicy": {"enabled": True, "mode": "interval"},
        }
    )
    commit = MagicMock()
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    monkeypatch.setattr(console_resources, "_payload", lambda _: payload)
    monkeypatch.setattr(console_resources, "commit_source_import", commit)
    monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
    app = Flask(__name__)

    with app.test_request_context("/", method="PATCH"):
        result = _invoke(
            console_resources.KnowledgeFSSpaceSourceApi,
            console_resources.KnowledgeFSSpaceSourceApi.patch,
            "space-1",
            "source-1",
        )

    facade.update_source.assert_not_called()
    commit.assert_not_called()
    facade.update_source_sync_policy.assert_called_once()
    assert result is source


def test_source_edit_reimports_when_selection_adds_a_canonical_duplicate() -> None:
    source = source_response(
        metadata={"crawled": {"https://docs.dify.ai/a": {}}},
        status="active",
        type="web",
        uri="https://docs.dify.ai",
    )
    payload = KnowledgeFSSourceUpdatePayload.model_validate(
        {
            "selection": {
                "kind": "website_crawl",
                "sourceUrls": [
                    "https://docs.dify.ai/a/",
                    "https://DOCS.dify.ai:443/a#section",
                ],
            },
            "syncPolicy": {"enabled": True, "mode": "interval"},
        }
    )

    assert console_resources._source_edit_requires_import(source, payload) is True


def test_source_edit_ignores_order_when_canonical_url_multiplicity_is_unchanged() -> None:
    source = source_response(
        metadata={
            "crawled": {
                "https://docs.dify.ai/a/": {},
                "https://DOCS.dify.ai:443/a#stored": {},
            }
        },
        status="active",
        type="web",
        uri="https://docs.dify.ai",
    )
    payload = KnowledgeFSSourceUpdatePayload.model_validate(
        {
            "selection": {
                "kind": "website_crawl",
                "sourceUrls": [
                    "https://docs.dify.ai/a#selected",
                    "https://docs.dify.ai/a/",
                ],
            },
            "syncPolicy": {"enabled": True, "mode": "interval"},
        }
    )

    assert console_resources._source_edit_requires_import(source, payload) is False


def test_source_edit_uses_latest_effective_website_selection_instead_of_stale_crawl_metadata() -> None:
    source = source_response(
        metadata={
            "crawled": {"https://docs.dify.ai/old": {}},
            "initialPreview": {"canonicalSourceUrls": ["https://docs.dify.ai/old"]},
            "__knowledgeFsWebsiteSelection": {
                "sourceUrls": ["https://docs.dify.ai/current/"],
                "version": 1,
            },
        },
        status="active",
        type="web",
        uri="https://docs.dify.ai",
    )
    unchanged = KnowledgeFSSourceUpdatePayload.model_validate(
        {
            "selection": {
                "kind": "website_crawl",
                "sourceUrls": ["https://DOCS.dify.ai:443/current#selected"],
            },
            "syncPolicy": {"enabled": True, "mode": "interval"},
        }
    )
    changed = KnowledgeFSSourceUpdatePayload.model_validate(
        {
            "selection": {
                "kind": "website_crawl",
                "sourceUrls": ["https://docs.dify.ai/old"],
            },
            "syncPolicy": {"enabled": True, "mode": "interval"},
        }
    )

    assert console_resources._source_edit_requires_import(source, unchanged) is False
    assert console_resources._source_edit_requires_import(source, changed) is True


def test_source_edit_reimports_an_unchanged_selection_when_source_is_in_error() -> None:
    provider_item_id = '["workspace-a","page-a"]'
    identity_hash = sha256(f"online-document\0{provider_item_id}".encode()).hexdigest()
    source = source_response(
        metadata={
            "providerKind": "online-document",
            "__knowledgeFsProviderSelection": {"identityHashes": [identity_hash]},
        },
        status="error",
        type="connector",
        uri="notion://connection-a",
    )
    payload = KnowledgeFSSourceUpdatePayload.model_validate(
        {
            "selection": {
                "kind": "online_document",
                "items": [
                    {
                        "pageId": "page-a",
                        "providerItemId": provider_item_id,
                        "type": "page",
                        "workspaceId": "workspace-a",
                    }
                ],
            },
            "syncPolicy": {"enabled": True, "mode": "interval"},
        }
    )

    assert console_resources._source_edit_requires_import(source, payload) is True


def test_console_source_update_applies_policy_without_creating_import_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    facade = MagicMock()
    source = source_response(version=5, sync_policy=None)
    facade.get_source.return_value = source
    facade.get_source_sync_policy.return_value = SimpleNamespace(revision=2)
    policy = SimpleNamespace(revision=3)
    facade.update_source_sync_policy.return_value = policy
    runtime = SimpleNamespace(facade=facade)
    payload = KnowledgeFSSourceUpdatePayload.model_validate(
        {"syncPolicy": {"customIntervalSeconds": 7200, "enabled": True, "mode": "custom"}}
    )
    commit = MagicMock()
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    monkeypatch.setattr(console_resources, "_payload", lambda _: payload)
    monkeypatch.setattr(console_resources, "commit_source_import", commit)
    monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
    app = Flask(__name__)

    with app.test_request_context("/", method="PATCH"):
        result = _invoke(
            console_resources.KnowledgeFSSpaceSourceApi,
            console_resources.KnowledgeFSSpaceSourceApi.patch,
            "space-1",
            "source-1",
        )

    facade.update_source.assert_not_called()
    commit.assert_not_called()
    policy_payload = facade.update_source_sync_policy.call_args.kwargs["payload"]
    assert policy_payload.expected_revision == 2
    assert policy_payload.expected_source_version == 5
    assert policy_payload.custom_interval_seconds == 7200
    assert source.sync_policy is policy
    assert result is source


def test_console_metadata_delete_forwards_row_version_cas(monkeypatch: pytest.MonkeyPatch) -> None:
    facade = MagicMock()
    facade.delete_metadata_field.return_value = _RAW_RESULT
    runtime = SimpleNamespace(facade=facade)
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
    app = Flask(__name__)

    with app.test_request_context("/?expectedRowVersion=7", method="DELETE"):
        result = _invoke(
            console_resources.KnowledgeFSSpaceMetadataFieldApi,
            console_resources.KnowledgeFSSpaceMetadataFieldApi.delete,
            "space-1",
            "field-1",
        )

    facade.delete_metadata_field.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="space-1",
        field_id="field-1",
        expected_row_version=7,
    )
    assert result is _RAW_RESULT


def test_console_overview_stats_composes_kfs_metrics_with_dify_app_bindings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stats = KnowledgeFSOverviewBaseStatsResponse.model_validate(
        {
            "current": {
                "freshSourceCount": 2,
                "knowledgeCount": 13,
                "latestSourceSyncAt": "2026-07-23T11:00:00.000Z",
                "linkedAppCount": 0,
                "sourceCount": 3,
                "staleSourceCount": 1,
            },
            "generatedAt": "2026-07-23T11:59:59.000Z",
            "knowledgeSpaceId": "knowledge-space-1",
            "windows": {
                "24h": {
                    "answerRate": 0.8,
                    "answeredQueryCount": 8,
                    "queryCount": 10,
                    "since": "2026-07-22T12:00:00.000Z",
                },
                "7d": {
                    "answerRate": 0.75,
                    "answeredQueryCount": 75,
                    "queryCount": 100,
                    "since": "2026-07-16T12:00:00.000Z",
                },
                "30d": {
                    "answerRate": 0.7,
                    "answeredQueryCount": 210,
                    "queryCount": 300,
                    "since": "2026-06-23T12:00:00.000Z",
                },
            },
        }
    )
    outcomes = KnowledgeFSOverviewQueryOutcomesResponse.model_validate(
        {
            "buckets": [],
            "current": {
                "answerRate": 0.8,
                "answered": 96,
                "lowConfidence": 12,
                "noEvidence": 12,
                "queryCount": 120,
            },
            "generatedAt": "2026-07-23T12:00:00.000Z",
            "knowledgeSpaceId": "knowledge-space-1",
            "previous": {
                "answerRate": 0.85,
                "answered": 85,
                "lowConfidence": 8,
                "noEvidence": 7,
                "queryCount": 100,
            },
            "previousSince": "2026-07-09T12:00:00.000Z",
            "since": "2026-07-16T12:00:00.000Z",
            "window": "7d",
        }
    )
    runtime = SimpleNamespace(
        facade=SimpleNamespace(
            get_overview_query_outcomes=MagicMock(return_value=outcomes),
            get_overview_stats=MagicMock(return_value=stats),
        ),
        app_bindings=SimpleNamespace(count_active=MagicMock(return_value=7)),
    )
    dump_response = MagicMock(side_effect=lambda _schema, raw: raw)
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    monkeypatch.setattr(console_resources, "dump_response", dump_response)
    app = Flask(__name__)

    with app.test_request_context("/?window=7d"):
        result = _invoke(
            console_resources.KnowledgeFSSpaceOverviewStatsApi,
            console_resources.KnowledgeFSSpaceOverviewStatsApi.get,
            "control-space-1",
        )

    runtime.facade.get_overview_stats.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-space-1",
    )
    runtime.facade.get_overview_query_outcomes.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-space-1",
        window="7d",
    )
    runtime.app_bindings.count_active.assert_called_once_with(
        tenant_id="tenant-1",
        actor_account_id="account-1",
        control_space_id="control-space-1",
    )
    assert result.documents == 13
    assert result.linked_apps == 7
    assert result.queries.value == 120
    assert result.queries.previous_value == 100
    assert result.queries.change_rate == pytest.approx(0.2)
    assert result.answer_rate.value == pytest.approx(0.8)
    assert result.answer_rate.change_percentage_points == pytest.approx(-5)
    assert result.freshness_seconds == 3600
    assert result.generated_at == outcomes.generated_at
    assert dump_response.call_args.args[1] is result


_SERVICE_DELEGATION_CASES = (
    (
        service_resources.KnowledgeFSServiceBulkDocumentsApi,
        service_resources.KnowledgeFSServiceBulkDocumentsApi.delete,
        ("space-1",),
        "bulkDeleteDocuments",
        dict[str, object](),
    ),
    (
        service_resources.KnowledgeFSServiceDocumentReindexApi,
        service_resources.KnowledgeFSServiceDocumentReindexApi.post,
        ("space-1",),
        "reindexDocuments",
        dict[str, object](),
    ),
    (
        service_resources.KnowledgeFSServiceDocumentApi,
        service_resources.KnowledgeFSServiceDocumentApi.get,
        ("space-1", "document-1"),
        "getDocument",
        {"resource_id": "document-1", "path_parameters": (("documentId", "document-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceDocumentApi,
        service_resources.KnowledgeFSServiceDocumentApi.patch,
        ("space-1", "document-1"),
        "updateDocumentMetadata",
        {"resource_id": "document-1", "path_parameters": (("documentId", "document-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceDocumentApi,
        service_resources.KnowledgeFSServiceDocumentApi.delete,
        ("space-1", "document-1"),
        "deleteDocument",
        {"resource_id": "document-1", "path_parameters": (("documentId", "document-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceDocumentOutlineApi,
        service_resources.KnowledgeFSServiceDocumentOutlineApi.get,
        ("space-1", "document-1"),
        "getDocumentOutline",
        {"resource_id": "document-1", "path_parameters": (("documentId", "document-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceDocumentRevisionsApi,
        service_resources.KnowledgeFSServiceDocumentRevisionsApi.get,
        ("space-1", "document-1"),
        "listDocumentRevisions",
        {"resource_id": "document-1", "path_parameters": (("documentId", "document-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceDocumentChunksApi,
        service_resources.KnowledgeFSServiceDocumentChunksApi.get,
        ("space-1", "document-1", 3),
        "listDocumentChunks",
        {
            "resource_id": "document-1",
            "path_parameters": (("documentId", "document-1"), ("revision", "3")),
        },
    ),
    (
        service_resources.KnowledgeFSServiceDocumentChunkApi,
        service_resources.KnowledgeFSServiceDocumentChunkApi.get,
        ("space-1", "document-1", 3, "chunk-1"),
        "getDocumentChunk",
        {
            "resource_id": "document-1",
            "path_parameters": (("documentId", "document-1"), ("revision", "3"), ("chunkId", "chunk-1")),
        },
    ),
    (
        service_resources.KnowledgeFSServiceCompilationJobApi,
        service_resources.KnowledgeFSServiceCompilationJobApi.get,
        ("space-1", "job-1"),
        "getCompilationJob",
        {"resource_id": "job-1"},
    ),
    (
        service_resources.KnowledgeFSServiceCompilationJobApi,
        service_resources.KnowledgeFSServiceCompilationJobApi.delete,
        ("space-1", "job-1"),
        "cancelCompilationJob",
        {"resource_id": "job-1"},
    ),
    (
        service_resources.KnowledgeFSServiceCompilationJobRetryApi,
        service_resources.KnowledgeFSServiceCompilationJobRetryApi.post,
        ("space-1", "job-1"),
        "retryCompilationJob",
        {"resource_id": "job-1"},
    ),
    (
        service_resources.KnowledgeFSServiceBulkJobApi,
        service_resources.KnowledgeFSServiceBulkJobApi.get,
        ("space-1", "job-1"),
        "getBulkJob",
        {"resource_id": "job-1"},
    ),
    (
        service_resources.KnowledgeFSServiceSourceApi,
        service_resources.KnowledgeFSServiceSourceApi.get,
        ("space-1", "source-1"),
        "getSource",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceSourceApi,
        service_resources.KnowledgeFSServiceSourceApi.patch,
        ("space-1", "source-1"),
        "updateSource",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceSourceApi,
        service_resources.KnowledgeFSServiceSourceApi.delete,
        ("space-1", "source-1"),
        "deleteSource",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceSourceTestApi,
        service_resources.KnowledgeFSServiceSourceTestApi.post,
        ("space-1", "source-1"),
        "testSource",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceSourceCrawlApi,
        service_resources.KnowledgeFSServiceSourceCrawlApi.post,
        ("space-1", "source-1"),
        "crawlSource",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceSourcePagesApi,
        service_resources.KnowledgeFSServiceSourcePagesApi.get,
        ("space-1", "source-1"),
        "listSourcePages",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceSourcePageImportApi,
        service_resources.KnowledgeFSServiceSourcePageImportApi.post,
        ("space-1", "source-1"),
        "importSourcePages",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceSourceFilesApi,
        service_resources.KnowledgeFSServiceSourceFilesApi.get,
        ("space-1", "source-1"),
        "listSourceFiles",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceSourceFileImportApi,
        service_resources.KnowledgeFSServiceSourceFileImportApi.post,
        ("space-1", "source-1"),
        "importSourceFiles",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceResearchTasksApi,
        service_resources.KnowledgeFSServiceResearchTasksApi.post,
        ("space-1",),
        "createResearchTask",
        {"bind_space_in_body": True},
    ),
    (
        service_resources.KnowledgeFSServiceResearchTaskPlanApi,
        service_resources.KnowledgeFSServiceResearchTaskPlanApi.post,
        ("space-1",),
        "planResearchTask",
        {"bind_space_in_body": True},
    ),
    (
        service_resources.KnowledgeFSServiceResearchTaskApi,
        service_resources.KnowledgeFSServiceResearchTaskApi.get,
        ("space-1", "task-1"),
        "getResearchTask",
        {"resource_id": "task-1"},
    ),
    (
        service_resources.KnowledgeFSServiceResearchTaskApi,
        service_resources.KnowledgeFSServiceResearchTaskApi.delete,
        ("space-1", "task-1"),
        "cancelResearchTask",
        {"resource_id": "task-1"},
    ),
    (
        service_resources.KnowledgeFSServiceResearchTaskPartialsApi,
        service_resources.KnowledgeFSServiceResearchTaskPartialsApi.get,
        ("space-1", "task-1"),
        "listResearchTaskPartials",
        {"resource_id": "task-1"},
    ),
    (
        service_resources.KnowledgeFSServiceTraceApi,
        service_resources.KnowledgeFSServiceTraceApi.get,
        ("space-1", "trace-1"),
        "getTrace",
        {"resource_id": "trace-1", "path_parameters": (("traceId", "trace-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceTraceEvidenceApi,
        service_resources.KnowledgeFSServiceTraceEvidenceApi.get,
        ("space-1", "trace-1"),
        "listTraceEvidence",
        {"resource_id": "trace-1", "path_parameters": (("traceId", "trace-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceTraceConflictsApi,
        service_resources.KnowledgeFSServiceTraceConflictsApi.get,
        ("space-1", "trace-1"),
        "listTraceConflicts",
        {"resource_id": "trace-1", "path_parameters": (("traceId", "trace-1"),)},
    ),
    (
        service_resources.KnowledgeFSServiceTraceMissingApi,
        service_resources.KnowledgeFSServiceTraceMissingApi.get,
        ("space-1", "trace-1"),
        "listTraceMissing",
        {"resource_id": "trace-1", "path_parameters": (("traceId", "trace-1"),)},
    ),
)


@pytest.mark.parametrize(
    ("class_name", "method_name", "route_args", "operation_id", "expected_fields"),
    _SERVICE_DELEGATION_CASES,
)
def test_service_resources_bind_route_identifiers_to_one_declared_operation(
    monkeypatch: pytest.MonkeyPatch,
    class_name: type[Resource],
    method_name: Callable[..., object],
    route_args: tuple[object, ...],
    operation_id: str,
    expected_fields: dict[str, object],
) -> None:
    payload = object()
    execute = MagicMock(return_value=_RAW_RESULT)
    dump_response = MagicMock(side_effect=lambda schema, raw: (schema.__name__, raw))
    monkeypatch.setattr(service_resources, "_execute_service_operation", execute)
    monkeypatch.setattr(service_resources, "_payload", lambda _: payload)
    monkeypatch.setattr(service_resources, "_idempotency_key", lambda: "idempotency-1")
    monkeypatch.setattr(service_resources, "_query_pairs", lambda _: (("normalized", "true"),))
    monkeypatch.setattr(service_resources, "dump_response", dump_response)
    app = Flask(__name__)

    with app.test_request_context("/", method="POST"):
        _invoke(class_name, method_name, *route_args)

    execute.assert_called_once()
    call_fields = execute.call_args.kwargs
    assert call_fields["control_space_id"] == "space-1"
    assert call_fields["operation_id"] == operation_id
    for field_name, expected in expected_fields.items():
        assert call_fields[field_name] == expected
    if "payload" in call_fields:
        assert call_fields["payload"] is payload
    if "headers" in call_fields:
        assert call_fields["headers"] == (("Idempotency-Key", "idempotency-1"),)
    if "query" in call_fields:
        assert call_fields["query"] == (("normalized", "true"),)
    assert dump_response.call_args.args[1] is _RAW_RESULT


@pytest.mark.parametrize(
    ("class_name", "method_name", "operation_id"),
    [
        (
            service_resources.KnowledgeFSServiceDocumentsApi,
            service_resources.KnowledgeFSServiceDocumentsApi.get,
            "listDocuments",
        ),
        (
            service_resources.KnowledgeFSServiceSettingsApi,
            service_resources.KnowledgeFSServiceSettingsApi.get,
            "getSettings",
        ),
        (
            service_resources.KnowledgeFSServiceSettingsApi,
            service_resources.KnowledgeFSServiceSettingsApi.patch,
            "updateSettings",
        ),
        (
            service_resources.KnowledgeFSServiceSourcesApi,
            service_resources.KnowledgeFSServiceSourcesApi.get,
            "listSources",
        ),
        (
            service_resources.KnowledgeFSServiceSourcesApi,
            service_resources.KnowledgeFSServiceSourcesApi.post,
            "createSource",
        ),
        (
            service_resources.KnowledgeFSServiceResearchTasksApi,
            service_resources.KnowledgeFSServiceResearchTasksApi.get,
            "listResearchTasks",
        ),
        (
            service_resources.KnowledgeFSServiceTracesApi,
            service_resources.KnowledgeFSServiceTracesApi.get,
            "listTraces",
        ),
    ],
)
@pytest.mark.parametrize("cursor", [None, "cursor-2"])
def test_service_credential_routes_validate_profile_before_facade_delegation(
    monkeypatch: pytest.MonkeyPatch,
    class_name: type[Resource],
    method_name: Callable[..., object],
    operation_id: str,
    cursor: str | None,
) -> None:
    facade = SimpleNamespace(execute_service=MagicMock(return_value=_RAW_RESULT))
    runtime = SimpleNamespace(facade=facade)
    profile = object()
    validate_profile = MagicMock(return_value=profile)
    monkeypatch.setattr(service_resources, "_runtime", lambda: runtime)
    monkeypatch.setattr(service_resources, "_profile", validate_profile)
    monkeypatch.setattr(service_resources, "_payload", lambda _: object())
    monkeypatch.setattr(service_resources, "dump_response", lambda schema, raw: (schema.__name__, raw))
    app = Flask(__name__)
    query_string = {"cursor": cursor} if cursor is not None else None

    with app.test_request_context("/", method="POST", query_string=query_string):
        _invoke(class_name, method_name, "space-1")

    validate_profile.assert_called_once_with(runtime, operation_id=operation_id, control_space_id="space-1")
    assert facade.execute_service.call_args.kwargs["profile"] is profile
    assert facade.execute_service.call_args.kwargs["operation_id"] == operation_id
    if "query" in facade.execute_service.call_args.kwargs:
        expected_query = (("cursor", cursor),) if cursor else ()
        assert facade.execute_service.call_args.kwargs["query"] == expected_query


@pytest.mark.parametrize(
    "class_name",
    [
        console_resources.KnowledgeFSSpaceQueriesApi,
    ],
)
def test_deprecated_buffered_routes_fail_closed(class_name: type[console_resources.KnowledgeFSSpaceQueriesApi]) -> None:
    with pytest.raises(KnowledgeFSOperationUnavailableError, match="deprecated"):
        _invoke(class_name, class_name.post, "space-1")


def test_console_stream_capabilities_bind_the_authorized_resource(monkeypatch: pytest.MonkeyPatch) -> None:
    issued = SimpleNamespace(
        token="capability-token",
        expires_at=datetime(2026, 7, 21, tzinfo=UTC),
        knowledge_space_id="knowledge-space-1",
    )
    broker = SimpleNamespace(issue_interactive=MagicMock(return_value=issued))
    payloads = iter(
        [
            KnowledgeFSQueryCreatePayload(query="question", mode="deep"),
            KnowledgeFSStreamCapabilityPayload(control_space_id="space-2"),
        ]
    )
    apply_config_overrides(monkeypatch, CONSOLE_API_URL="https://dify.example")
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(
        console_resources,
        "_console_services",
        lambda: SimpleNamespace(broker=broker),
    )
    monkeypatch.setattr(console_resources, "_payload", lambda _: next(payloads))
    monkeypatch.setattr(console_resources, "dump_response", lambda _, response: response)
    app = Flask(__name__)

    with app.test_request_context("/", method="POST"):
        query = _invoke(
            console_resources.KnowledgeFSSpaceQueryAdmissionApi,
            console_resources.KnowledgeFSSpaceQueryAdmissionApi.post,
            "space-1",
        )
        task = _invoke(
            console_resources.KnowledgeFSTaskStreamCapabilityApi,
            console_resources.KnowledgeFSTaskStreamCapabilityApi.post,
            "task/1",
        )
        legacy_query = _invoke(
            console_resources.KnowledgeFSSpaceQueryStreamCapabilityApi,
            console_resources.KnowledgeFSSpaceQueryStreamCapabilityApi.post,
            "space-1",
        )

    assert query.request.knowledge_space_id == "knowledge-space-1"
    assert query.url == "https://dify.example/console/api/knowledge-fs/query-stream"
    assert (
        task.url == "https://dify.example/console/api/knowledge-fs/research-tasks/task%2F1/events"
        "?knowledgeSpaceId=knowledge-space-1"
    )
    assert legacy_query.url == "https://dify.example/console/api/knowledge-fs/query-stream"
    assert broker.issue_interactive.call_args_list[0].kwargs["operation_id"] == "createQuery"
    assert broker.issue_interactive.call_args_list[1].kwargs == {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "control_space_id": "space-2",
        "operation_id": "streamResearchTask",
        "resource_id": "task/1",
    }
    assert broker.issue_interactive.call_args_list[2].kwargs["operation_id"] == "createQuery"


def test_service_query_admission_binds_profile_space_and_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    issued = SimpleNamespace(
        token="capability-token",
        expires_at=datetime(2026, 7, 21, tzinfo=UTC),
        knowledge_space_id="knowledge-space-1",
    )
    broker = SimpleNamespace(issue_service=MagicMock(return_value=issued))
    runtime = SimpleNamespace(broker=broker)
    profile = object()
    apply_config_overrides(monkeypatch, SERVICE_API_URL="https://api.dify.example")
    monkeypatch.setattr(service_resources, "_runtime", lambda: runtime)
    monkeypatch.setattr(service_resources, "_profile", lambda *_args, **_kwargs: profile)
    monkeypatch.setattr(service_resources, "_payload", lambda _: KnowledgeFSQueryCreatePayload(query="question"))
    monkeypatch.setattr(service_resources, "dump_response", lambda _, response: response)
    app = Flask(__name__)

    with app.test_request_context("/", method="POST"):
        response = _invoke(
            service_resources.KnowledgeFSServiceQueryAdmissionApi,
            service_resources.KnowledgeFSServiceQueryAdmissionApi.post,
            "space-1",
        )

    broker.issue_service.assert_called_once_with(profile=profile, operation_id="createQuery")
    assert response.request.knowledge_space_id == "knowledge-space-1"
    assert response.request.query == "question"
    assert response.url == "https://api.dify.example/v1/knowledge-fs/query-stream"


def test_console_resource_helpers_validate_feature_payload_headers_and_query_pairs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = object()
    session_maker = object()
    get_runtime = MagicMock(return_value=runtime)
    apply_config_overrides(monkeypatch, KNOWLEDGE_FS_ENABLED=True)
    monkeypatch.setattr(console_resources.session_factory, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(console_resources, "get_knowledge_fs_runtime", get_runtime)
    monkeypatch.setattr(
        console_resources,
        "current_account_with_tenant",
        lambda: (SimpleNamespace(id="account-1"), "tenant-1"),
    )
    app = Flask(__name__)

    assert console_resources._console_services() is runtime
    get_runtime.assert_called_once_with(session_maker)
    assert console_resources._actor() == ("account-1", "tenant-1")
    query = KnowledgeFSQueryCreatePayload(query="question", mode="fast", active_document_ids=["doc-1"])
    assert console_resources._query_pairs(query) == (
        ("query", "question"),
        ("mode", "fast"),
        ("activeDocumentIds", "['doc-1']"),
        ("activeEntityIds", "[]"),
    )
    with app.test_request_context(
        "/",
        method="POST",
        json={"query": "question"},
        headers={"Idempotency-Key": "request-key"},
    ):
        assert console_resources._payload(KnowledgeFSQueryCreatePayload).query == "question"
        assert console_resources._idempotency_key() == "request-key"

    apply_config_overrides(monkeypatch, KNOWLEDGE_FS_ENABLED=False)
    with pytest.raises(NotFound):
        console_resources._console_services()


def test_service_resource_helpers_validate_feature_bearer_headers_and_boolean_queries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = object()
    session_maker = object()
    get_runtime = MagicMock(return_value=runtime)
    apply_config_overrides(monkeypatch, KNOWLEDGE_FS_ENABLED=True)
    monkeypatch.setattr(service_resources.session_factory, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(service_resources, "get_knowledge_fs_runtime", get_runtime)
    app = Flask(__name__)

    assert service_resources._runtime() is runtime
    get_runtime.assert_called_once_with(session_maker)

    class Query(BaseModel):
        enabled: bool = True
        disabled: bool = False
        count: int = 2

    query = Query()
    assert service_resources._query_pairs(query) == (
        ("enabled", "true"),
        ("disabled", "false"),
        ("count", "2"),
    )
    with app.test_request_context(
        "/",
        method="POST",
        json={"query": "question"},
        headers={"Authorization": "bEaReR  credential-value  ", "Idempotency-Key": "request-key"},
    ):
        assert service_resources._payload(KnowledgeFSQueryCreatePayload).query == "question"
        assert service_resources._idempotency_key() == "request-key"

    apply_config_overrides(monkeypatch, KNOWLEDGE_FS_ENABLED=False)
    with pytest.raises(NotFound):
        service_resources._runtime()


def test_console_request_rejections_preserve_conflict_size_and_validation_contracts() -> None:
    from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError

    expected: dict[Literal[400, 403, 409, 413, 422, 429], type[Exception]] = {
        400: KnowledgeFSInvalidRequestHTTPError,
        403: KnowledgeFSAccessDeniedHTTPError,
        409: KnowledgeFSConflictHTTPError,
        413: KnowledgeFSRequestTooLargeHTTPError,
        422: KnowledgeFSRequestRejectedHTTPError,
        429: KnowledgeFSRateLimitHTTPError,
    }
    for status, http_error in expected.items():
        reject = console_resources._knowledge_fs_errors(
            MagicMock(side_effect=KnowledgeFSProductRequestRejectedError(status_code=status))
        )

        with pytest.raises(http_error):
            reject()


def test_console_request_rejection_preserves_safe_failure_metadata() -> None:
    from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError

    failure = KnowledgeFSPublicFailureResponse.model_validate(
        {
            "action": "configure_model",
            "category": "configuration",
            "code": "MODEL_SELECTION_NOT_FOUND",
            "message": "Select another model before retrying.",
            "retryPolicy": "after_configuration",
            "traceId": "trace-model",
        }
    )
    reject = console_resources._knowledge_fs_errors(
        MagicMock(side_effect=KnowledgeFSProductRequestRejectedError(status_code=422, failure=failure))
    )

    with pytest.raises(KnowledgeFSRequestRejectedHTTPError) as raised:
        reject()

    assert raised.value.data == {
        "code": "knowledge_fs_request_rejected",
        "message": "The KnowledgeFS operation requires a configuration change before it can continue.",
        "status": 422,
        "failure": {
            "action": "configure_model",
            "category": "configuration",
            "code": "MODEL_SELECTION_NOT_FOUND",
            "message": "The KnowledgeFS operation requires a configuration change before it can continue.",
            "retryPolicy": "after_configuration",
            "traceId": "trace-model",
        },
    }


def test_jwks_resource_fails_closed_for_disabled_missing_and_misconfigured_issuers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services.knowledge_fs_capability import KnowledgeFSCapabilityConfigurationError

    app = Flask(__name__)
    apply_config_overrides(monkeypatch, KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=False)
    with app.app_context(), pytest.raises(NotFound):
        console_resources.KnowledgeFSJWKSApi().get()

    apply_config_overrides(monkeypatch, KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=True)
    monkeypatch.setattr(console_resources.session_factory, "get_session_maker", lambda: object())
    monkeypatch.setattr(console_resources, "create_configured_knowledge_fs_capability_issuer", lambda **_: None)
    with app.app_context(), pytest.raises(NotFound):
        console_resources.KnowledgeFSJWKSApi().get()

    def misconfigured(**_: object) -> None:
        raise KnowledgeFSCapabilityConfigurationError("missing signing key")

    monkeypatch.setattr(console_resources, "create_configured_knowledge_fs_capability_issuer", misconfigured)
    with app.app_context(), pytest.raises(ServiceUnavailable, match="not configured"):
        console_resources.KnowledgeFSJWKSApi().get()


def test_console_error_adapter_maps_every_domain_boundary_to_the_stable_http_contract() -> None:
    from pydantic import ValidationError

    from services.knowledge_fs.app_binding_management import KnowledgeFSAppBindingManagementError
    from services.knowledge_fs.control_plane_service import KnowledgeFSControlPlaneInvariantError
    from services.knowledge_fs.product_authorization import KnowledgeFSProductNotFoundError
    from services.knowledge_fs.product_remote import (
        KnowledgeFSProductRemoteError,
        KnowledgeFSProductResourceNotFoundError,
    )
    from services.knowledge_fs_capability import KnowledgeFSCapabilityConfigurationError

    with pytest.raises(ValidationError) as raised_validation:
        KnowledgeFSQueryCreatePayload.model_validate({"query": ""})
    validation_error = raised_validation.value
    mappings = (
        (KnowledgeFSProductNotFoundError("hidden"), KnowledgeFSSpaceNotFoundHTTPError),
        (KnowledgeFSProductResourceNotFoundError("missing child"), KnowledgeFSResourceNotFoundHTTPError),
        (KnowledgeFSOperationUnavailableError("manifest mismatch"), KnowledgeFSOperationUnavailableHTTPError),
        (KnowledgeFSProductRemoteError("upstream unavailable"), KnowledgeFSUpstreamUnavailableHTTPError),
        (KnowledgeFSAppBindingManagementError("invalid binding"), KnowledgeFSInvalidRequestHTTPError),
        (KnowledgeFSControlPlaneInvariantError("missing revision"), KnowledgeFSInvalidRequestHTTPError),
        (validation_error, KnowledgeFSInvalidRequestHTTPError),
        (PermissionError("forbidden"), KnowledgeFSAccessDeniedHTTPError),
        (KnowledgeFSCapabilityConfigurationError("missing issuer"), KnowledgeFSOperationUnavailableHTTPError),
    )

    for domain_error, http_error in mappings:
        fail = console_resources._knowledge_fs_errors(MagicMock(side_effect=domain_error))

        with pytest.raises(http_error):
            fail()

    assert KnowledgeFSUpstreamUnavailableHTTPError.code == HTTPStatus.SERVICE_UNAVAILABLE


def test_service_error_adapter_maps_every_domain_boundary_to_the_stable_http_contract() -> None:
    from pydantic import ValidationError

    from services.knowledge_fs.product_remote import (
        KnowledgeFSProductRemoteError,
        KnowledgeFSProductRequestRejectedError,
        KnowledgeFSProductResourceNotFoundError,
    )
    from services.knowledge_fs.service_api_authorization import KnowledgeFSServiceApiAuthorizationError

    with pytest.raises(ValidationError) as raised_validation:
        KnowledgeFSQueryCreatePayload.model_validate({"query": ""})
    validation_error = raised_validation.value
    mappings = (
        (KnowledgeFSServiceApiAuthorizationError("revoked"), KnowledgeFSInvalidCredentialHTTPError),
        (KnowledgeFSOperationUnavailableError("manifest mismatch"), KnowledgeFSServiceOperationUnavailableHTTPError),
        (
            KnowledgeFSProductResourceNotFoundError("missing child"),
            KnowledgeFSServiceResourceNotFoundHTTPError,
        ),
        (KnowledgeFSProductRemoteError("upstream unavailable"), KnowledgeFSServiceUpstreamUnavailableHTTPError),
        (validation_error, KnowledgeFSServiceInvalidRequestHTTPError),
    )

    for domain_error, http_error in mappings:
        fail = service_resources._service_api_errors(MagicMock(side_effect=domain_error))

        with pytest.raises(http_error):
            fail()

    rejected_mappings = (
        (400, KnowledgeFSServiceInvalidRequestHTTPError),
        (403, KnowledgeFSServiceAccessDeniedHTTPError),
        (409, KnowledgeFSServiceConflictHTTPError),
        (413, KnowledgeFSServiceRequestTooLargeHTTPError),
        (422, KnowledgeFSServiceRequestRejectedHTTPError),
        (429, KnowledgeFSServiceRateLimitHTTPError),
    )
    for status, http_error in rejected_mappings:
        fail = service_resources._service_api_errors(
            MagicMock(side_effect=KnowledgeFSProductRequestRejectedError(status_code=status))
        )
        with pytest.raises(http_error):
            fail()


def test_console_small_file_reader_rejects_malformed_and_empty_multipart_bodies() -> None:
    from io import BytesIO

    from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError

    app = Flask(__name__)
    with app.test_request_context(
        "/",
        method="POST",
        data=b"x",
        environ_overrides={"CONTENT_LENGTH": str(64 * 1024 + 2)},
    ):
        with pytest.raises(KnowledgeFSProductRequestRejectedError) as too_large:
            console_resources._read_small_file_body(1)
    assert too_large.value.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE

    malformed_payloads = (
        dict[str, object](),
        {"file": (BytesIO(b"content"), "")},
        {"file": (BytesIO(b""), "empty.txt")},
    )
    for payload in malformed_payloads:
        with app.test_request_context("/", method="POST", data=payload, content_type="multipart/form-data"):
            with pytest.raises(KnowledgeFSProductRequestRejectedError) as rejected:
                console_resources._read_small_file_body(10)
        assert rejected.value.status_code == HTTPStatus.UNPROCESSABLE_ENTITY


def test_console_app_binding_route_rejects_unknown_caller_kind_before_revoke(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services.knowledge_fs.app_binding_management import KnowledgeFSAppBindingManagementError

    revoke = MagicMock()
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(
        console_resources,
        "_console_services",
        lambda: SimpleNamespace(app_bindings=SimpleNamespace(revoke=revoke)),
    )

    with pytest.raises(KnowledgeFSAppBindingManagementError, match="caller kind"):
        _invoke(
            console_resources.KnowledgeFSSpaceAppBindingApi,
            console_resources.KnowledgeFSSpaceAppBindingApi.delete,
            "space-1",
            "unknown-caller",
            "app-1",
        )

    revoke.assert_not_called()


def test_service_profile_hides_unknown_operations_before_dataset_key_authorization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    authorization = SimpleNamespace(authorize=MagicMock())
    runtime = MagicMock(spec=KnowledgeFSRuntime, service_api_authorization=authorization)
    monkeypatch.setattr(service_resources, "product_operation_action", MagicMock(side_effect=KeyError("unknown")))

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="unknownOperation"):
        service_resources._profile(
            runtime,
            operation_id="unknownOperation",
            control_space_id="space-1",
        )

    authorization.authorize.assert_not_called()


def test_service_operation_helper_forwards_the_complete_validated_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = object()
    payload = KnowledgeFSQueryCreatePayload(query="question")
    facade = SimpleNamespace(execute_service=MagicMock(return_value={"id": "result-1"}))
    runtime = SimpleNamespace(facade=facade)
    monkeypatch.setattr(service_resources, "_runtime", lambda: runtime)
    monkeypatch.setattr(service_resources, "_profile", MagicMock(return_value=profile))

    result = service_resources._execute_service_operation(
        control_space_id="space-1",
        operation_id="createResearchTask",
        payload=payload,
        query=(("cursor", "next"),),
        bind_space_in_body=True,
        resource_id="task-1",
        path_parameters=(("taskId", "task-1"),),
        headers=(("Idempotency-Key", "request-key"),),
    )

    assert result == {"id": "result-1"}
    facade.execute_service.assert_called_once_with(
        profile=profile,
        operation_id="createResearchTask",
        payload=payload,
        query=(("cursor", "next"),),
        bind_space_in_body=True,
        resource_id="task-1",
        path_parameters=(("taskId", "task-1"),),
        headers=(("Idempotency-Key", "request-key"),),
    )
