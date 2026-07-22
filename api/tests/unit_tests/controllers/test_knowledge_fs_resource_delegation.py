from __future__ import annotations

from datetime import UTC, datetime
from http import HTTPStatus
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from werkzeug.exceptions import (
    Conflict,
    NotFound,
    RequestEntityTooLarge,
    ServiceUnavailable,
    UnprocessableEntity,
)

from controllers.console.knowledge_fs import resources as console_resources
from controllers.console.knowledge_fs.error import (
    KnowledgeFSAccessDeniedHTTPError,
    KnowledgeFSInvalidRequestHTTPError,
    KnowledgeFSOperationUnavailableHTTPError,
    KnowledgeFSSpaceNotFoundHTTPError,
    KnowledgeFSUpstreamUnavailableHTTPError,
)
from controllers.service_api.knowledge_fs import resources as service_resources
from controllers.service_api.knowledge_fs.error import (
    KnowledgeFSInvalidCredentialHTTPError,
    KnowledgeFSServiceInvalidRequestHTTPError,
    KnowledgeFSServiceOperationUnavailableHTTPError,
    KnowledgeFSServiceUpstreamUnavailableHTTPError,
)
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs.product_dto import (
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSStreamCapabilityPayload,
    KnowledgeFSUploadCapabilityPayload,
)
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError

_RAW_RESULT = object()


def _invoke(resource_module: object, class_name: str, method_name: str, *args: object) -> object:
    resource_type = getattr(resource_module, class_name)
    method = unwrap(getattr(resource_type, method_name))
    return method(resource_type(), *args)


# Each case names the public resource, HTTP method, route arguments, and the one
# application boundary that owns the operation. Route-specific identifiers are
# asserted below so accidental delegation to a sibling resource is observable.
_CONSOLE_DELEGATION_CASES = (
    ("KnowledgeFSSpacesApi", "get", (), "application", "list_spaces", {}),
    ("KnowledgeFSSpacesApi", "post", (), "application", "create_space", {}),
    ("KnowledgeFSSpaceApi", "get", ("space-1",), "application", "get_space", {"control_space_id": "space-1"}),
    (
        "KnowledgeFSSpaceApi",
        "patch",
        ("space-1",),
        "application",
        "update_space",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceApi",
        "delete",
        ("space-1",),
        "application",
        "delete_space",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpacePermissionsApi",
        "get",
        ("space-1",),
        "control_plane",
        "list_permissions",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceMembersApi",
        "put",
        ("space-1",),
        "control_plane",
        "replace_members",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceExternalAccessApi",
        "get",
        ("space-1",),
        "control_plane",
        "get_external_access",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceExternalAccessApi",
        "put",
        ("space-1",),
        "control_plane",
        "update_external_access",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceAppBindingsApi",
        "get",
        ("space-1",),
        "app_bindings",
        "list",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceAppBindingsApi",
        "put",
        ("space-1",),
        "app_bindings",
        "upsert",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceAppBindingApi",
        "delete",
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
        "KnowledgeFSSpaceCredentialsApi",
        "get",
        ("space-1",),
        "credentials",
        "list",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceCredentialsApi",
        "post",
        ("space-1",),
        "credentials",
        "create",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceCredentialApi",
        "delete",
        ("space-1", "credential-1"),
        "credentials",
        "revoke",
        {"control_space_id": "space-1", "credential_id": "credential-1"},
    ),
    ("KnowledgeFSSpaceSettingsApi", "get", ("space-1",), "facade", "get_settings", {"control_space_id": "space-1"}),
    (
        "KnowledgeFSSpaceSettingsApi",
        "patch",
        ("space-1",),
        "facade",
        "update_settings",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceDocumentsApi",
        "get",
        ("space-1",),
        "facade",
        "list_documents",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceBulkDocumentsApi",
        "delete",
        ("space-1",),
        "facade",
        "bulk_delete_documents",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceDocumentReindexApi",
        "post",
        ("space-1",),
        "facade",
        "reindex_documents",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceDocumentApi",
        "get",
        ("space-1", "document-1"),
        "facade",
        "get_document",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        "KnowledgeFSSpaceDocumentApi",
        "patch",
        ("space-1", "document-1"),
        "facade",
        "update_document_metadata",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        "KnowledgeFSSpaceDocumentApi",
        "delete",
        ("space-1", "document-1"),
        "facade",
        "delete_document",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        "KnowledgeFSSpaceDocumentOutlineApi",
        "get",
        ("space-1", "document-1"),
        "facade",
        "get_document_outline",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        "KnowledgeFSSpaceDocumentRevisionsApi",
        "get",
        ("space-1", "document-1"),
        "facade",
        "list_document_revisions",
        {"control_space_id": "space-1", "document_id": "document-1"},
    ),
    (
        "KnowledgeFSSpaceDocumentChunksApi",
        "get",
        ("space-1", "document-1", 3),
        "facade",
        "list_document_chunks",
        {"control_space_id": "space-1", "document_id": "document-1", "revision": 3},
    ),
    (
        "KnowledgeFSSpaceDocumentChunkApi",
        "get",
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
        "KnowledgeFSSpaceCompilationJobApi",
        "get",
        ("space-1", "job-1"),
        "facade",
        "get_compilation_job",
        {"control_space_id": "space-1", "job_id": "job-1"},
    ),
    (
        "KnowledgeFSSpaceCompilationJobApi",
        "delete",
        ("space-1", "job-1"),
        "facade",
        "cancel_compilation_job",
        {"control_space_id": "space-1", "job_id": "job-1"},
    ),
    (
        "KnowledgeFSSpaceCompilationJobRetryApi",
        "post",
        ("space-1", "job-1"),
        "facade",
        "retry_compilation_job",
        {"control_space_id": "space-1", "job_id": "job-1"},
    ),
    (
        "KnowledgeFSSpaceBulkJobApi",
        "get",
        ("space-1", "job-1"),
        "facade",
        "get_bulk_job",
        {"control_space_id": "space-1", "job_id": "job-1"},
    ),
    (
        "KnowledgeFSSpaceSourcesApi",
        "get",
        ("space-1",),
        "facade",
        "list_sources",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceSourcesApi",
        "post",
        ("space-1",),
        "facade",
        "create_source",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceSourceApi",
        "get",
        ("space-1", "source-1"),
        "facade",
        "get_source",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        "KnowledgeFSSpaceSourceApi",
        "patch",
        ("space-1", "source-1"),
        "facade",
        "update_source",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        "KnowledgeFSSpaceSourceApi",
        "delete",
        ("space-1", "source-1"),
        "facade",
        "delete_source",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        "KnowledgeFSSpaceSourceTestApi",
        "post",
        ("space-1", "source-1"),
        "facade",
        "test_source",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        "KnowledgeFSSpaceSourceCrawlApi",
        "post",
        ("space-1", "source-1"),
        "facade",
        "crawl_source",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        "KnowledgeFSSpaceSourcePagesApi",
        "get",
        ("space-1", "source-1"),
        "facade",
        "list_source_pages",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        "KnowledgeFSSpaceSourcePageImportApi",
        "post",
        ("space-1", "source-1"),
        "facade",
        "import_source_pages",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        "KnowledgeFSSpaceSourceFilesApi",
        "get",
        ("space-1", "source-1"),
        "facade",
        "list_source_files",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        "KnowledgeFSSpaceSourceFileImportApi",
        "post",
        ("space-1", "source-1"),
        "facade",
        "import_source_files",
        {"control_space_id": "space-1", "source_id": "source-1"},
    ),
    (
        "KnowledgeFSSpaceResearchTasksApi",
        "get",
        ("space-1",),
        "facade",
        "list_research_tasks",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceResearchTasksApi",
        "post",
        ("space-1",),
        "facade",
        "create_research_task",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceResearchTaskPlanApi",
        "post",
        ("space-1",),
        "facade",
        "plan_research_task",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceResearchTaskApi",
        "get",
        ("space-1", "task-1"),
        "facade",
        "get_research_task",
        {"control_space_id": "space-1", "task_id": "task-1"},
    ),
    (
        "KnowledgeFSSpaceResearchTaskApi",
        "delete",
        ("space-1", "task-1"),
        "facade",
        "cancel_research_task",
        {"control_space_id": "space-1", "task_id": "task-1"},
    ),
    (
        "KnowledgeFSSpaceResearchTaskPartialsApi",
        "get",
        ("space-1", "task-1"),
        "facade",
        "list_research_task_partials",
        {"control_space_id": "space-1", "task_id": "task-1"},
    ),
    (
        "KnowledgeFSSpaceTracesApi",
        "get",
        ("space-1",),
        "facade",
        "list_traces",
        {"control_space_id": "space-1"},
    ),
    (
        "KnowledgeFSSpaceTraceApi",
        "get",
        ("space-1", "trace-1"),
        "facade",
        "get_trace",
        {"control_space_id": "space-1", "trace_id": "trace-1"},
    ),
    (
        "KnowledgeFSSpaceTraceEvidenceApi",
        "get",
        ("space-1", "trace-1"),
        "facade",
        "list_trace_entries",
        {"control_space_id": "space-1", "trace_id": "trace-1", "kind": "evidence"},
    ),
    (
        "KnowledgeFSSpaceTraceConflictsApi",
        "get",
        ("space-1", "trace-1"),
        "facade",
        "list_trace_entries",
        {"control_space_id": "space-1", "trace_id": "trace-1", "kind": "conflicts"},
    ),
    (
        "KnowledgeFSSpaceTraceMissingApi",
        "get",
        ("space-1", "trace-1"),
        "facade",
        "list_trace_entries",
        {"control_space_id": "space-1", "trace_id": "trace-1", "kind": "missing"},
    ),
    (
        "KnowledgeFSSpaceSmallFileUploadApi",
        "post",
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
    class_name: str,
    method_name: str,
    route_args: tuple[object, ...],
    component_name: str,
    delegate_name: str,
    expected_fields: dict[str, object],
) -> None:
    payload = SimpleNamespace(members=("member-1",))
    runtime = SimpleNamespace(
        application=MagicMock(),
        control_plane=MagicMock(),
        app_bindings=MagicMock(),
        credentials=MagicMock(),
        facade=MagicMock(),
    )
    delegate = getattr(runtime, component_name).__getattr__(delegate_name)
    delegate.return_value = _RAW_RESULT
    dump_response = MagicMock(side_effect=lambda schema, raw: (schema.__name__, raw))
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    monkeypatch.setattr(console_resources, "_payload", lambda _: payload)
    monkeypatch.setattr(console_resources, "_idempotency_key", lambda: "idempotency-1")
    monkeypatch.setattr(console_resources, "_query_pairs", lambda _: (("normalized", "true"),))
    monkeypatch.setattr(console_resources, "dump_response", dump_response)
    app = Flask(__name__)

    with app.test_request_context("/", method="POST"):
        result = _invoke(console_resources, class_name, method_name, *route_args)

    delegate.assert_called_once()
    call_fields = delegate.call_args.kwargs
    assert call_fields["tenant_id"] == "tenant-1"
    assert call_fields.get("account_id", call_fields.get("actor_account_id")) == "account-1"
    for field_name, expected in expected_fields.items():
        assert call_fields[field_name] == expected
    if "payload" in call_fields:
        assert call_fields["payload"] is payload
    if "members" in call_fields:
        assert call_fields["members"] == payload.members
    if "idempotency_key" in call_fields:
        assert call_fields["idempotency_key"] == "idempotency-1"
    if dump_response.called:
        assert dump_response.call_args.args[1] is _RAW_RESULT
    else:
        assert result == ("", HTTPStatus.NO_CONTENT)


_SERVICE_DELEGATION_CASES = (
    ("KnowledgeFSServiceBulkDocumentsApi", "delete", ("space-1",), "bulkDeleteDocuments", {}),
    ("KnowledgeFSServiceDocumentReindexApi", "post", ("space-1",), "reindexDocuments", {}),
    (
        "KnowledgeFSServiceDocumentApi",
        "get",
        ("space-1", "document-1"),
        "getDocument",
        {"resource_id": "document-1", "path_parameters": (("documentId", "document-1"),)},
    ),
    (
        "KnowledgeFSServiceDocumentApi",
        "patch",
        ("space-1", "document-1"),
        "updateDocumentMetadata",
        {"resource_id": "document-1", "path_parameters": (("documentId", "document-1"),)},
    ),
    (
        "KnowledgeFSServiceDocumentApi",
        "delete",
        ("space-1", "document-1"),
        "deleteDocument",
        {"resource_id": "document-1", "path_parameters": (("documentId", "document-1"),)},
    ),
    (
        "KnowledgeFSServiceDocumentOutlineApi",
        "get",
        ("space-1", "document-1"),
        "getDocumentOutline",
        {"resource_id": "document-1", "path_parameters": (("documentId", "document-1"),)},
    ),
    (
        "KnowledgeFSServiceDocumentRevisionsApi",
        "get",
        ("space-1", "document-1"),
        "listDocumentRevisions",
        {"resource_id": "document-1", "path_parameters": (("documentId", "document-1"),)},
    ),
    (
        "KnowledgeFSServiceDocumentChunksApi",
        "get",
        ("space-1", "document-1", 3),
        "listDocumentChunks",
        {
            "resource_id": "document-1",
            "path_parameters": (("documentId", "document-1"), ("revision", "3")),
        },
    ),
    (
        "KnowledgeFSServiceDocumentChunkApi",
        "get",
        ("space-1", "document-1", 3, "chunk-1"),
        "getDocumentChunk",
        {
            "resource_id": "document-1",
            "path_parameters": (("documentId", "document-1"), ("revision", "3"), ("chunkId", "chunk-1")),
        },
    ),
    ("KnowledgeFSServiceCompilationJobApi", "get", ("space-1", "job-1"), "getCompilationJob", {"resource_id": "job-1"}),
    (
        "KnowledgeFSServiceCompilationJobApi",
        "delete",
        ("space-1", "job-1"),
        "cancelCompilationJob",
        {"resource_id": "job-1"},
    ),
    (
        "KnowledgeFSServiceCompilationJobRetryApi",
        "post",
        ("space-1", "job-1"),
        "retryCompilationJob",
        {"resource_id": "job-1"},
    ),
    ("KnowledgeFSServiceBulkJobApi", "get", ("space-1", "job-1"), "getBulkJob", {"resource_id": "job-1"}),
    (
        "KnowledgeFSServiceSourceApi",
        "get",
        ("space-1", "source-1"),
        "getSource",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        "KnowledgeFSServiceSourceApi",
        "patch",
        ("space-1", "source-1"),
        "updateSource",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        "KnowledgeFSServiceSourceApi",
        "delete",
        ("space-1", "source-1"),
        "deleteSource",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        "KnowledgeFSServiceSourceTestApi",
        "post",
        ("space-1", "source-1"),
        "testSource",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        "KnowledgeFSServiceSourceCrawlApi",
        "post",
        ("space-1", "source-1"),
        "crawlSource",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        "KnowledgeFSServiceSourcePagesApi",
        "get",
        ("space-1", "source-1"),
        "listSourcePages",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        "KnowledgeFSServiceSourcePageImportApi",
        "post",
        ("space-1", "source-1"),
        "importSourcePages",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        "KnowledgeFSServiceSourceFilesApi",
        "get",
        ("space-1", "source-1"),
        "listSourceFiles",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    (
        "KnowledgeFSServiceSourceFileImportApi",
        "post",
        ("space-1", "source-1"),
        "importSourceFiles",
        {"resource_id": "source-1", "path_parameters": (("sourceId", "source-1"),)},
    ),
    ("KnowledgeFSServiceResearchTasksApi", "post", ("space-1",), "createResearchTask", {"bind_space_in_body": True}),
    ("KnowledgeFSServiceResearchTaskPlanApi", "post", ("space-1",), "planResearchTask", {"bind_space_in_body": True}),
    (
        "KnowledgeFSServiceResearchTaskApi",
        "get",
        ("space-1", "task-1"),
        "getResearchTask",
        {"resource_id": "task-1"},
    ),
    (
        "KnowledgeFSServiceResearchTaskApi",
        "delete",
        ("space-1", "task-1"),
        "cancelResearchTask",
        {"resource_id": "task-1"},
    ),
    (
        "KnowledgeFSServiceResearchTaskPartialsApi",
        "get",
        ("space-1", "task-1"),
        "listResearchTaskPartials",
        {"resource_id": "task-1"},
    ),
    (
        "KnowledgeFSServiceTraceApi",
        "get",
        ("space-1", "trace-1"),
        "getTrace",
        {"resource_id": "trace-1", "path_parameters": (("traceId", "trace-1"),)},
    ),
    (
        "KnowledgeFSServiceTraceEvidenceApi",
        "get",
        ("space-1", "trace-1"),
        "listTraceEvidence",
        {"resource_id": "trace-1", "path_parameters": (("traceId", "trace-1"),)},
    ),
    (
        "KnowledgeFSServiceTraceConflictsApi",
        "get",
        ("space-1", "trace-1"),
        "listTraceConflicts",
        {"resource_id": "trace-1", "path_parameters": (("traceId", "trace-1"),)},
    ),
    (
        "KnowledgeFSServiceTraceMissingApi",
        "get",
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
    class_name: str,
    method_name: str,
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
        _invoke(service_resources, class_name, method_name, *route_args)

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
        ("KnowledgeFSServiceDocumentsApi", "get", "listDocuments"),
        ("KnowledgeFSServiceSettingsApi", "get", "getSettings"),
        ("KnowledgeFSServiceSettingsApi", "patch", "updateSettings"),
        ("KnowledgeFSServiceSourcesApi", "get", "listSources"),
        ("KnowledgeFSServiceSourcesApi", "post", "createSource"),
        ("KnowledgeFSServiceResearchTasksApi", "get", "listResearchTasks"),
        ("KnowledgeFSServiceTracesApi", "get", "listTraces"),
    ],
)
@pytest.mark.parametrize("cursor", [None, "cursor-2"])
def test_service_credential_routes_validate_profile_before_facade_delegation(
    monkeypatch: pytest.MonkeyPatch,
    class_name: str,
    method_name: str,
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
        _invoke(service_resources, class_name, method_name, "space-1")

    validate_profile.assert_called_once_with(runtime, operation_id=operation_id, control_space_id="space-1")
    assert facade.execute_service.call_args.kwargs["profile"] is profile
    assert facade.execute_service.call_args.kwargs["operation_id"] == operation_id
    if "query" in facade.execute_service.call_args.kwargs:
        expected_query = (("cursor", cursor),) if cursor else ()
        assert facade.execute_service.call_args.kwargs["query"] == expected_query


@pytest.mark.parametrize(
    ("resource_module", "class_name"),
    [
        (console_resources, "KnowledgeFSSpaceDocumentsApi"),
        (console_resources, "KnowledgeFSSpaceQueriesApi"),
        (service_resources, "KnowledgeFSServiceDocumentsApi"),
        (service_resources, "KnowledgeFSServiceQueriesApi"),
    ],
)
def test_deprecated_buffered_routes_fail_closed(resource_module: object, class_name: str) -> None:
    with pytest.raises(KnowledgeFSOperationUnavailableError, match="deprecated"):
        _invoke(resource_module, class_name, "post", "space-1")


def test_console_direct_capabilities_bind_the_authorized_resource(monkeypatch: pytest.MonkeyPatch) -> None:
    issued = SimpleNamespace(
        token="capability-token",
        expires_at=datetime(2026, 7, 21, tzinfo=UTC),
        knowledge_space_id="knowledge-space-1",
    )
    admission = SimpleNamespace(issue_interactive=MagicMock(return_value=issued))
    payloads = iter(
        [
            KnowledgeFSUploadCapabilityPayload(operation_id="completeUploadSession", upload_session_id="session-1"),
            KnowledgeFSQueryCreatePayload(query="question", mode="deep"),
            KnowledgeFSStreamCapabilityPayload(control_space_id="space-2"),
        ]
    )
    monkeypatch.setattr(console_resources.dify_config, "KNOWLEDGE_FS_DIRECT_ORIGIN", "https://kfs.example/")
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(
        console_resources,
        "_console_services",
        lambda: SimpleNamespace(direct_operation_admission=admission),
    )
    monkeypatch.setattr(console_resources, "_payload", lambda _: next(payloads))
    monkeypatch.setattr(console_resources, "dump_response", lambda _, response: response)
    app = Flask(__name__)

    with app.test_request_context("/", method="POST"):
        upload = _invoke(console_resources, "KnowledgeFSSpaceUploadCapabilitiesApi", "post", "space-1")
        query = _invoke(console_resources, "KnowledgeFSSpaceQueryAdmissionApi", "post", "space-1")
        task = _invoke(console_resources, "KnowledgeFSTaskStreamCapabilityApi", "post", "task/1")
        legacy_query = _invoke(console_resources, "KnowledgeFSSpaceQueryStreamCapabilityApi", "post", "space-1")

    assert upload.operation_id == "completeUploadSession"
    assert query.request.knowledge_space_id == "knowledge-space-1"
    assert query.url == "https://kfs.example/queries"
    assert task.url == "https://kfs.example//research-tasks/task%2F1/events?knowledgeSpaceId=knowledge-space-1"
    assert legacy_query.url == "https://kfs.example/queries"
    assert admission.issue_interactive.call_args_list[0].kwargs["resource_id"] == "session-1"
    assert admission.issue_interactive.call_args_list[1].kwargs["operation_id"] == "createQuery"
    assert admission.issue_interactive.call_args_list[2].kwargs == {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "control_space_id": "space-2",
        "operation_id": "streamResearchTask",
        "resource_id": "task/1",
    }


def test_service_direct_query_admission_binds_profile_space_and_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    issued = SimpleNamespace(
        token="capability-token",
        expires_at=datetime(2026, 7, 21, tzinfo=UTC),
        knowledge_space_id="knowledge-space-1",
    )
    admission = SimpleNamespace(issue_service=MagicMock(return_value=issued))
    runtime = SimpleNamespace(direct_operation_admission=admission)
    profile = object()
    monkeypatch.setattr(service_resources.dify_config, "KNOWLEDGE_FS_DIRECT_ORIGIN", "https://kfs.example/")
    monkeypatch.setattr(service_resources, "_runtime", lambda: runtime)
    monkeypatch.setattr(service_resources, "_profile", lambda *_args, **_kwargs: profile)
    monkeypatch.setattr(service_resources, "_payload", lambda _: KnowledgeFSQueryCreatePayload(query="question"))
    monkeypatch.setattr(service_resources, "dump_response", lambda _, response: response)
    app = Flask(__name__)

    with app.test_request_context("/", method="POST"):
        response = _invoke(service_resources, "KnowledgeFSServiceQueryAdmissionApi", "post", "space-1")

    admission.issue_service.assert_called_once_with(profile=profile, operation_id="createQuery")
    assert response.request.knowledge_space_id == "knowledge-space-1"
    assert response.request.query == "question"
    assert response.url == "https://kfs.example/queries"


@pytest.mark.parametrize(
    ("resource_module", "class_name", "message"),
    [
        (console_resources, "KnowledgeFSSpaceUploadCapabilitiesApi", "direct upload"),
        (console_resources, "KnowledgeFSSpaceQueryAdmissionApi", "direct query"),
        (console_resources, "KnowledgeFSSpaceQueryStreamCapabilityApi", "direct query"),
        (console_resources, "KnowledgeFSTaskStreamCapabilityApi", "direct streaming"),
        (service_resources, "KnowledgeFSServiceQueryAdmissionApi", "direct query"),
    ],
)
def test_direct_routes_fail_before_admission_when_origin_is_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
    resource_module: object,
    class_name: str,
    message: str,
) -> None:
    monkeypatch.setattr(resource_module.dify_config, "KNOWLEDGE_FS_DIRECT_ORIGIN", None)

    with pytest.raises(KnowledgeFSOperationUnavailableError, match=message):
        _invoke(resource_module, class_name, "post", "resource-1")


def test_console_resource_helpers_validate_feature_payload_headers_and_query_pairs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = object()
    session_maker = object()
    create_runtime = MagicMock(return_value=runtime)
    monkeypatch.setattr(console_resources.dify_config, "KNOWLEDGE_FS_ENABLED", True)
    monkeypatch.setattr(console_resources.session_factory, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(console_resources, "create_knowledge_fs_runtime", create_runtime)
    monkeypatch.setattr(
        console_resources,
        "current_account_with_tenant",
        lambda: (SimpleNamespace(id="account-1"), "tenant-1"),
    )
    app = Flask(__name__)

    assert console_resources._console_services() is runtime
    create_runtime.assert_called_once_with(session_maker)
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

    monkeypatch.setattr(console_resources.dify_config, "KNOWLEDGE_FS_ENABLED", False)
    with pytest.raises(NotFound):
        console_resources._console_services()


def test_service_resource_helpers_validate_feature_bearer_headers_and_boolean_queries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = object()
    session_maker = object()
    create_runtime = MagicMock(return_value=runtime)
    monkeypatch.setattr(service_resources.dify_config, "KNOWLEDGE_FS_ENABLED", True)
    monkeypatch.setattr(service_resources.session_factory, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(service_resources, "create_knowledge_fs_runtime", create_runtime)
    app = Flask(__name__)

    assert service_resources._runtime() is runtime
    create_runtime.assert_called_once_with(session_maker)
    query = SimpleNamespace(model_dump=lambda **_: {"enabled": True, "disabled": False, "count": 2})
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
        assert service_resources._raw_bearer_credential() == "credential-value"
        assert service_resources._idempotency_key() == "request-key"

    for authorization in (None, "Basic token", "Bearer", "Bearer   "):
        headers = {"Authorization": authorization} if authorization is not None else {}
        with app.test_request_context("/", headers=headers), pytest.raises(Exception) as raised:
            service_resources._raw_bearer_credential()
        assert raised.value.__class__.__name__ == "KnowledgeFSInvalidCredentialHTTPError"

    monkeypatch.setattr(service_resources.dify_config, "KNOWLEDGE_FS_ENABLED", False)
    with pytest.raises(NotFound):
        service_resources._runtime()


def test_console_request_rejections_preserve_conflict_size_and_validation_contracts() -> None:
    from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError

    expected = {
        HTTPStatus.CONFLICT: Conflict,
        HTTPStatus.REQUEST_ENTITY_TOO_LARGE: RequestEntityTooLarge,
        HTTPStatus.UNPROCESSABLE_ENTITY: UnprocessableEntity,
    }
    for status, http_error in expected.items():
        reject = console_resources._knowledge_fs_errors(
            MagicMock(side_effect=KnowledgeFSProductRequestRejectedError(status_code=status))
        )

        with pytest.raises(http_error):
            reject()


def test_jwks_resource_fails_closed_for_disabled_missing_and_misconfigured_issuers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from services.knowledge_fs_capability import KnowledgeFSCapabilityConfigurationError

    app = Flask(__name__)
    monkeypatch.setattr(console_resources.dify_config, "KNOWLEDGE_FS_CAPABILITY_V2_ENABLED", False)
    with app.app_context(), pytest.raises(NotFound):
        console_resources.KnowledgeFSJWKSApi().get()

    monkeypatch.setattr(console_resources.dify_config, "KNOWLEDGE_FS_CAPABILITY_V2_ENABLED", True)
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
    from services.knowledge_fs.credential_service import KnowledgeFSCredentialPolicyError
    from services.knowledge_fs.product_authorization import KnowledgeFSProductNotFoundError
    from services.knowledge_fs.product_remote import KnowledgeFSProductRemoteError
    from services.knowledge_fs_capability import KnowledgeFSCapabilityConfigurationError

    with pytest.raises(ValidationError) as raised_validation:
        KnowledgeFSQueryCreatePayload.model_validate({"query": ""})
    validation_error = raised_validation.value
    mappings = (
        (KnowledgeFSProductNotFoundError("hidden"), KnowledgeFSSpaceNotFoundHTTPError),
        (KnowledgeFSOperationUnavailableError("manifest mismatch"), KnowledgeFSOperationUnavailableHTTPError),
        (KnowledgeFSProductRemoteError("upstream unavailable"), KnowledgeFSUpstreamUnavailableHTTPError),
        (KnowledgeFSAppBindingManagementError("invalid binding"), KnowledgeFSInvalidRequestHTTPError),
        (KnowledgeFSCredentialPolicyError("invalid policy"), KnowledgeFSInvalidRequestHTTPError),
        (KnowledgeFSControlPlaneInvariantError("missing revision"), KnowledgeFSInvalidRequestHTTPError),
        (validation_error, KnowledgeFSInvalidRequestHTTPError),
        (PermissionError("forbidden"), KnowledgeFSAccessDeniedHTTPError),
        (KnowledgeFSCapabilityConfigurationError("missing issuer"), KnowledgeFSOperationUnavailableHTTPError),
    )

    for domain_error, http_error in mappings:
        fail = console_resources._knowledge_fs_errors(MagicMock(side_effect=domain_error))

        with pytest.raises(http_error):
            fail()


def test_service_error_adapter_maps_every_domain_boundary_to_the_stable_http_contract() -> None:
    from pydantic import ValidationError

    from services.knowledge_fs.credential_service import KnowledgeFSCredentialValidationError
    from services.knowledge_fs.product_remote import KnowledgeFSProductRemoteError

    with pytest.raises(ValidationError) as raised_validation:
        KnowledgeFSQueryCreatePayload.model_validate({"query": ""})
    validation_error = raised_validation.value
    mappings = (
        (KnowledgeFSCredentialValidationError("revoked"), KnowledgeFSInvalidCredentialHTTPError),
        (KnowledgeFSOperationUnavailableError("manifest mismatch"), KnowledgeFSServiceOperationUnavailableHTTPError),
        (KnowledgeFSProductRemoteError("upstream unavailable"), KnowledgeFSServiceUpstreamUnavailableHTTPError),
        (validation_error, KnowledgeFSServiceInvalidRequestHTTPError),
    )

    for domain_error, http_error in mappings:
        fail = service_resources._service_api_errors(MagicMock(side_effect=domain_error))

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
        {},
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
            console_resources,
            "KnowledgeFSSpaceAppBindingApi",
            "delete",
            "space-1",
            "unknown-caller",
            "app-1",
        )

    revoke.assert_not_called()


def test_service_profile_hides_unknown_operations_before_credential_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    credentials = SimpleNamespace(validate_service_credential=MagicMock())
    runtime = SimpleNamespace(credentials=credentials)
    monkeypatch.setattr(service_resources, "product_operation_action", MagicMock(side_effect=KeyError("unknown")))

    with pytest.raises(KnowledgeFSOperationUnavailableError, match="unknownOperation"):
        service_resources._profile(
            runtime,
            operation_id="unknownOperation",
            control_space_id="space-1",
        )

    credentials.validate_service_credential.assert_not_called()


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
