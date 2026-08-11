from __future__ import annotations

import ast
import inspect
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from werkzeug.exceptions import RequestEntityTooLarge

from controllers.console import console_ns
from controllers.console.knowledge_fs import resources as console_resources
from controllers.service_api import service_api_ns
from controllers.service_api.knowledge_fs import resources as service_resources
from services.knowledge_fs.credential_service import KnowledgeFSServiceCredentialProfile
from services.knowledge_fs.product_dto import (
    KnowledgeFSDocumentStagedUploadAcceptedResponse,
    KnowledgeFSDocumentUploadAcceptedResponse,
    KnowledgeFSDurableDeletionAcceptedResponse,
    KnowledgeFSSmallFileUploadResponse,
    KnowledgeFSSpaceCreatePayload,
    KnowledgeFSStagedUploadResponse,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSRemoteMultipartFile,
    KnowledgeFSRemoteSSEResponse,
)

_API_ROOT = Path(__file__).resolve().parents[3]


def test_console_and_service_api_routes_are_registered() -> None:
    console_urls = {url for route in console_ns.resources for url in route.urls if url.startswith("/knowledge-fs/")}
    service_urls = {url for route in service_api_ns.resources for url in route.urls if url.startswith("/knowledge-fs/")}

    assert {
        "/knowledge-fs/spaces",
        "/knowledge-fs/uploads",
        "/knowledge-fs/uploads/<string:upload_id>",
        "/knowledge-fs/spaces/<string:control_space_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/permissions",
        "/knowledge-fs/spaces/<string:control_space_id>/members",
        "/knowledge-fs/spaces/<string:control_space_id>/app-bindings",
        ("/knowledge-fs/spaces/<string:control_space_id>/app-bindings/<string:caller_kind>/<string:app_id>"),
        "/knowledge-fs/spaces/<string:control_space_id>/external-access",
        "/knowledge-fs/spaces/<string:control_space_id>/credentials",
        "/knowledge-fs/spaces/<string:control_space_id>/settings",
        "/knowledge-fs/spaces/<string:control_space_id>/documents",
        "/knowledge-fs/spaces/<string:control_space_id>/logical-documents",
        "/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/sources",
        "/knowledge-fs/spaces/<string:control_space_id>/source-connections",
        ("/knowledge-fs/spaces/<string:control_space_id>/source-connections/<string:connection_id>/refresh"),
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/sync",
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/crawl-preview",
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/workflow-imports",
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/sync-policy",
        "/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/cancel",
        "/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/retry",
        "/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/pages",
        "/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/selection",
        "/knowledge-fs/spaces/<string:control_space_id>/source-providers",
        "/knowledge-fs/spaces/<string:control_space_id>/queries",
        "/knowledge-fs/spaces/<string:control_space_id>/research-tasks",
        "/knowledge-fs/spaces/<string:control_space_id>/traces",
        "/knowledge-fs/spaces/<string:control_space_id>/golden-questions/bulk-import",
        "/knowledge-fs/spaces/<string:control_space_id>/golden-questions/evidence-matches",
        "/knowledge-fs/spaces/<string:control_space_id>/upload-sessions",
        (
            "/knowledge-fs/spaces/<string:control_space_id>/upload-sessions/"
            "<string:upload_session_id>/parts/<int:part_number>/presign"
        ),
        ("/knowledge-fs/spaces/<string:control_space_id>/upload-sessions/<string:upload_session_id>/complete"),
        ("/knowledge-fs/spaces/<string:control_space_id>/upload-sessions/<string:upload_session_id>/abort"),
        ("/knowledge-fs/spaces/<string:control_space_id>/upload-sessions/<string:upload_session_id>/small-file"),
        "/knowledge-fs/spaces/<string:control_space_id>/query-stream-capability",
        "/knowledge-fs/tasks/<string:task_id>/stream-capability",
        "/knowledge-fs/query-stream",
        "/knowledge-fs/research-tasks/<string:task_id>/events",
        "/knowledge-fs/.well-known/jwks.json",
    }.issubset(console_urls)
    assert service_urls == {
        "/knowledge-fs/spaces/<string:control_space_id>/bulk-jobs/<string:job_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/documents",
        "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/outline",
        "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions",
        "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions/<int:revision>/chunks",
        "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions/<int:revision>/chunks/<string:chunk_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/documents/bulk",
        "/knowledge-fs/spaces/<string:control_space_id>/documents/reindex",
        "/knowledge-fs/spaces/<string:control_space_id>/jobs/<string:job_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/jobs/<string:job_id>/retry",
        "/knowledge-fs/spaces/<string:control_space_id>/queries",
        "/knowledge-fs/spaces/<string:control_space_id>/queries/admission",
        "/knowledge-fs/query-stream",
        "/knowledge-fs/spaces/<string:control_space_id>/research-tasks",
        "/knowledge-fs/spaces/<string:control_space_id>/research-tasks/<string:task_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/research-tasks/<string:task_id>/partials",
        "/knowledge-fs/spaces/<string:control_space_id>/research-tasks/plan",
        "/knowledge-fs/spaces/<string:control_space_id>/settings",
        "/knowledge-fs/spaces/<string:control_space_id>/sources",
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/crawl",
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/files",
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/import",
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/import-files",
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/pages",
        "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/test",
        "/knowledge-fs/spaces/<string:control_space_id>/traces",
        "/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>/conflicts",
        "/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>/evidence",
        "/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>/missing",
    }


def test_knowledge_fs_request_and_response_schemas_are_registered() -> None:
    assert {
        "KnowledgeFSSpaceCreatePayload",
        "KnowledgeFSAppBindingPayload",
        "KnowledgeFSAppBindingListResponse",
        "KnowledgeFSSpaceUpdatePayload",
        "KnowledgeFSMembersReplacePayload",
        "KnowledgeFSExternalAccessPayload",
        "KnowledgeFSCredentialCreatePayload",
        "KnowledgeFSSettingsPayload",
        "KnowledgeFSSourceCreatePayload",
        "KnowledgeFSQueryCreatePayload",
        "KnowledgeFSQueryStreamCapabilityResponse",
        "KnowledgeFSResearchTaskCreatePayload",
        "KnowledgeFSStreamCapabilityPayload",
        "KnowledgeFSSpaceListResponse",
        "KnowledgeFSSpaceDetailResponse",
        "KnowledgeFSCredentialCreateResponse",
        "KnowledgeFSDocumentStagedUploadPayload",
        "KnowledgeFSDocumentStagedUploadAcceptedResponse",
        "KnowledgeFSStreamCapabilityResponse",
        "KnowledgeFSJWKSResponse",
        "KnowledgeFSSmallFileUploadResponse",
        "KnowledgeFSCrawlPreviewPageListQuery",
        "KnowledgeFSCrawlPreviewPageListResponse",
        "KnowledgeFSCrawlPreviewSelectionPayload",
        "KnowledgeFSSourceConnectionCreatePayload",
        "KnowledgeFSSourceConnectionListQuery",
        "KnowledgeFSSourceConnectionListResponse",
        "KnowledgeFSSourceConnectionRefreshPayload",
        "KnowledgeFSSourceProviderListResponse",
        "KnowledgeFSSourceSyncPolicyPayload",
        "KnowledgeFSSourceSyncPolicyResponse",
        "KnowledgeFSSourceWorkflowImportPayload",
        "KnowledgeFSSourceWorkflowCancelPayload",
        "KnowledgeFSSourceWorkflowResponse",
        "KnowledgeFSUploadPartPresignPayload",
        "KnowledgeFSUploadSessionAbortPayload",
        "KnowledgeFSUploadSessionCompletePayload",
        "KnowledgeFSUploadSessionCreatePayload",
        "KnowledgeFSPresignedUploadResponse",
        "KnowledgeFSUploadSessionCreateResponse",
        "KnowledgeFSUploadSessionMutationResponse",
        "KnowledgeFSGoldenQuestionBulkImportPayload",
        "KnowledgeFSGoldenQuestionBulkImportResponse",
        "KnowledgeFSGoldenQuestionEvidenceMatchPayload",
        "KnowledgeFSGoldenQuestionEvidenceMatchResponse",
    }.issubset(console_ns.models)
    assert {
        "KnowledgeFSDocumentCreatePayload",
        "KnowledgeFSQueryCreatePayload",
        "KnowledgeFSDocumentListResponse",
        "KnowledgeFSQueryResponse",
        "KnowledgeFSResearchTaskListResponse",
        "KnowledgeFSSettingsPayload",
        "KnowledgeFSSettingsResponse",
        "KnowledgeFSSourceCreatePayload",
        "KnowledgeFSSourceListResponse",
        "KnowledgeFSSourceResponse",
        "KnowledgeFSTraceListResponse",
    }.issubset(service_api_ns.models)
    assert console_ns.models["KnowledgeFSSpaceCreatePayload"].__schema__["additionalProperties"] is False
    query_capability_schema = console_ns.models["KnowledgeFSQueryStreamCapabilityResponse"].__schema__
    assert set(query_capability_schema["required"]) == {"expires_at", "operation_id", "token", "url"}
    assert query_capability_schema["properties"]["operation_id"]["const"] == "createQuery"


def test_source_workflow_import_contract_is_discriminated_idempotent_and_accepted() -> None:
    import_schema = console_ns.models["KnowledgeFSSourceWorkflowImportPayload"].__schema__
    assert import_schema["discriminator"] == {
        "propertyName": "kind",
        "mapping": {
            "online-document-import": "#/components/schemas/KnowledgeFSOnlineDocumentWorkflowImportPayload",
            "online-drive-import": "#/components/schemas/KnowledgeFSOnlineDriveWorkflowImportPayload",
        },
    }
    assert import_schema["oneOf"] == [
        {"$ref": "#/components/schemas/KnowledgeFSOnlineDocumentWorkflowImportPayload"},
        {"$ref": "#/components/schemas/KnowledgeFSOnlineDriveWorkflowImportPayload"},
    ]

    api_doc = console_resources.KnowledgeFSSpaceSourceWorkflowImportApi.post.__apidoc__
    assert api_doc["params"]["Idempotency-Key"]["required"] is True
    assert api_doc["params"]["Idempotency-Key"]["minLength"] == 8
    assert api_doc["params"]["Idempotency-Key"]["maxLength"] == 255
    assert set(api_doc["responses"]) == {"202"}


def test_small_file_console_bff_reads_only_through_facade_and_returns_no_capability_material(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class Facade:
        def upload_small_file(self, **kwargs):
            calls.append({name: value for name, value in kwargs.items() if name != "body_reader"})
            assert kwargs["body_reader"](8 * 1024 * 1024) == b"tiny"
            return KnowledgeFSSmallFileUploadResponse.model_validate(
                {
                    "session": {
                        "compilationJobId": "compilation-1",
                        "completedAt": 2_000_000,
                        "documentAssetId": "asset-1",
                        "expectedSizeBytes": 4,
                        "expiresAt": 2_060_000,
                        "id": "session-1",
                        "mode": "small_fallback",
                        "status": "completed",
                    }
                }
            )

    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: SimpleNamespace(facade=Facade()))
    app = Flask(__name__)

    with app.test_request_context(
        method="POST",
        data={"file": (BytesIO(b"tiny"), "small.txt")},
        content_type="multipart/form-data",
    ):
        post = inspect.unwrap(console_resources.KnowledgeFSSpaceSmallFileUploadApi.post)
        response = post(console_resources.KnowledgeFSSpaceSmallFileUploadApi(), "control-1", "session-1")

    assert response["session"]["status"] == "completed"
    assert "token" not in str(response).lower()
    assert "url" not in str(response).lower()
    assert calls == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "upload_session_id": "session-1",
        }
    ]


def test_document_upload_console_bff_reads_only_through_facade_and_returns_accepted_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class Facade:
        def create_document(self, **kwargs):
            calls.append({name: value for name, value in kwargs.items() if name != "body_reader"})
            assert kwargs["body_reader"](15 * 1024 * 1024) == KnowledgeFSRemoteMultipartFile(
                filename="notes.md",
                content_type="text/markdown",
                body=b"# Notes",
            )
            return KnowledgeFSDocumentUploadAcceptedResponse.model_validate(
                {
                    "asset": {
                        "createdAt": "2030-01-01T00:00:00Z",
                        "filename": "notes.md",
                        "id": "asset-1",
                        "knowledgeSpaceId": "space-1",
                        "metadata": {},
                        "mimeType": "text/markdown",
                        "objectKey": "documents/asset-1/notes.md",
                        "parserStatus": "pending",
                        "sha256": "sha256",
                        "sizeBytes": 7,
                        "sourceId": None,
                        "updatedAt": None,
                        "version": 1,
                    },
                    "assetStatusUrl": "/knowledge-spaces/space-1/documents/asset-1",
                    "compilationJob": {"id": "job-1", "stage": "queued"},
                    "documentRevision": 1,
                    "logicalDocument": {"id": "document-1", "revision": 1},
                    "logicalDocumentId": "document-1",
                    "statusUrl": "/knowledge-spaces/space-1/logical-documents/document-1/tasks/job-1",
                }
            )

    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: SimpleNamespace(facade=Facade()))
    app = Flask(__name__)

    with app.test_request_context(
        method="POST",
        data={"file": (BytesIO(b"# Notes"), "notes.md", "text/markdown")},
        content_type="multipart/form-data",
    ):
        post = inspect.unwrap(console_resources.KnowledgeFSSpaceDocumentsApi.post)
        response, status = post(console_resources.KnowledgeFSSpaceDocumentsApi(), "control-1")

    assert status == 202
    assert response["logical_document_id"] == "document-1"
    assert calls == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
        }
    ]


def test_staged_document_claim_passes_only_upload_id_to_the_admission_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    staged_uploads = MagicMock()
    staged_uploads.claim.return_value = KnowledgeFSDocumentStagedUploadAcceptedResponse(
        upload_id="staged-1",
        document_asset_id="asset-1",
        compilation_job_id="job-1",
    )
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_staged_uploads", lambda: staged_uploads)
    app = Flask(__name__)

    with app.test_request_context(method="POST", json={"upload_id": "staged-1"}):
        post = inspect.unwrap(console_resources.KnowledgeFSSpaceDocumentsApi.post)
        response, status = post(console_resources.KnowledgeFSSpaceDocumentsApi(), "control-1")

    assert status == 202
    assert response == {
        "status": "accepted",
        "upload_id": "staged-1",
        "document_asset_id": "asset-1",
        "compilation_job_id": "job-1",
    }
    staged_uploads.claim.assert_called_once()
    assert staged_uploads.claim.call_args.kwargs["payload"].upload_id == "staged-1"


def test_workspace_staging_upload_persists_before_space_creation(monkeypatch: pytest.MonkeyPatch) -> None:
    staged_uploads = MagicMock()
    staged_uploads.stage.return_value = KnowledgeFSStagedUploadResponse(
        id="staged-1",
        file_name="notes.md",
        content_type="text/markdown",
        size_bytes=7,
        status="uploaded",
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
    )
    account = SimpleNamespace(id="account-1")
    monkeypatch.setattr(console_resources, "current_account_with_tenant", lambda: (account, "tenant-1"))
    monkeypatch.setattr(console_resources, "_staged_uploads", lambda: staged_uploads)
    monkeypatch.setattr(
        console_resources.FeatureService,
        "get_knowledge_file_size_limit",
        lambda _tenant_id: 15,
    )
    app = Flask(__name__)

    with app.test_request_context(
        method="POST",
        data={"file": (BytesIO(b"# Notes"), "notes.md", "text/markdown")},
        content_type="multipart/form-data",
    ):
        post = inspect.unwrap(console_resources.KnowledgeFSStagedUploadsApi.post)
        response, status = post(console_resources.KnowledgeFSStagedUploadsApi())

    assert status == 201
    assert response["id"] == "staged-1"
    staged_uploads.stage.assert_called_once_with(
        tenant_id="tenant-1",
        account=account,
        file_name="notes.md",
        content_type="text/markdown",
        body=b"# Notes",
        file_size_limit_mb=15,
    )


def test_logical_document_delete_accepts_initial_row_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class Facade:
        def delete_logical_document(self, **kwargs):
            calls.append(kwargs)
            assert kwargs["payload"].expected_revision == 0
            return KnowledgeFSDurableDeletionAcceptedResponse.model_validate(
                {
                    "job": {
                        "checkpoint": "requested",
                        "createdAt": "2030-01-01T00:00:00Z",
                        "id": "00000000-0000-4000-8000-000000000001",
                        "knowledgeSpaceId": "space-1",
                        "runState": "queued",
                        "targetId": "00000000-0000-4000-8000-000000000002",
                        "targetType": "logical_document",
                        "updatedAt": "2030-01-01T00:00:00Z",
                    },
                    "statusUrl": "/deletion-jobs/job-1",
                }
            )

    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: SimpleNamespace(facade=Facade()))
    app = Flask(__name__)

    with app.test_request_context(
        method="DELETE",
        json={"expectedRevision": 0},
        headers={"Idempotency-Key": "delete-logical-document-once"},
    ):
        delete = inspect.unwrap(console_resources.KnowledgeFSSpaceLogicalDocumentApi.delete)
        response, status = delete(
            console_resources.KnowledgeFSSpaceLogicalDocumentApi(),
            "control-1",
            "document-1",
        )

    assert status == 202
    assert response["job"]["target_type"] == "logical_document"
    assert len(calls) == 1
    assert {name: value for name, value in calls[0].items() if name != "payload"} == {
        "tenant_id": "tenant-1",
        "account_id": "account-1",
        "control_space_id": "control-1",
        "document_id": "document-1",
        "idempotency_key": "delete-logical-document-once",
    }


def test_small_file_console_bff_maps_oversize_to_413() -> None:
    app = Flask(__name__)
    with app.test_request_context(
        method="POST",
        data={"file": (BytesIO(b"large"), "large.bin")},
        content_type="multipart/form-data",
    ):
        with pytest.raises(KnowledgeFSProductRequestRejectedError) as oversized:
            console_resources._read_small_file_body(4)
    assert oversized.value.status_code == 413

    @console_resources._knowledge_fs_errors
    def reject():
        raise KnowledgeFSProductRequestRejectedError(status_code=413)

    with pytest.raises(RequestEntityTooLarge):
        reject()


def test_console_knowledge_rate_limit_is_scoped_to_upload_and_query_entrypoints() -> None:
    tree = ast.parse(
        Path(console_resources.__file__).read_text(encoding="utf-8"),
        filename=console_resources.__file__,
    )
    decorated_methods: set[tuple[str, str]] = set()

    for class_node in (node for node in tree.body if isinstance(node, ast.ClassDef)):
        for method_node in (
            node
            for node in class_node.body
            if isinstance(node, ast.FunctionDef) and node.name in {"delete", "get", "patch", "post", "put"}
        ):
            for decorator in method_node.decorator_list:
                if (
                    isinstance(decorator, ast.Call)
                    and isinstance(decorator.func, ast.Name)
                    and decorator.func.id == "cloud_edition_billing_rate_limit_check"
                    and len(decorator.args) == 1
                    and isinstance(decorator.args[0], ast.Constant)
                    and decorator.args[0].value == "knowledge"
                ):
                    decorated_methods.add((class_node.name, method_node.name))

    assert decorated_methods == {
        ("KnowledgeFSSpaceDocumentsApi", "post"),
        ("KnowledgeFSSpaceQueryAdmissionApi", "post"),
        ("KnowledgeFSSpaceQueryStreamCapabilityApi", "post"),
        ("KnowledgeFSSpaceSmallFileUploadApi", "post"),
        ("KnowledgeFSSpaceUploadSessionAbortApi", "post"),
        ("KnowledgeFSSpaceUploadSessionCompleteApi", "post"),
        ("KnowledgeFSSpaceUploadSessionPartPresignApi", "post"),
        ("KnowledgeFSSpaceUploadSessionsApi", "post"),
        ("KnowledgeFSStagedUploadsApi", "post"),
    }


def test_space_update_and_delete_publish_their_actual_http_status_contracts() -> None:
    patch_responses = console_resources.KnowledgeFSSpaceApi.patch.__apidoc__["responses"]
    delete_responses = console_resources.KnowledgeFSSpaceApi.delete.__apidoc__["responses"]

    assert set(patch_responses) == {"200"}
    assert set(delete_responses) == {"204"}


def test_space_create_profile_intent_matches_the_exact_kfs_pending_configuration_shape() -> None:
    payload = KnowledgeFSSpaceCreatePayload.model_validate(
        {
            "name": "Technical space",
            "slug": "technical-space",
            "embedding": {
                "pluginId": "langgenius/openai",
                "provider": "openai",
                "model": "text-embedding-3-small",
            },
            "retrieval": {
                "defaultMode": "deep",
                "reasoningModel": {
                    "pluginId": "langgenius/openai",
                    "provider": "openai",
                    "model": "gpt-4.1-mini",
                },
                "rerank": {
                    "enabled": True,
                    "model": {
                        "pluginId": "langgenius/cohere",
                        "provider": "cohere",
                        "model": "rerank-v3.5",
                    },
                },
                "scoreThreshold": {"enabled": True, "stage": "mode-final", "value": 0.6},
                "topK": 20,
            },
        }
    )

    assert payload.embedding.model_dump(mode="json", by_alias=True) == {
        "pluginId": "langgenius/openai",
        "provider": "openai",
        "model": "text-embedding-3-small",
    }
    assert payload.retrieval.model_dump(mode="json", by_alias=True) == {
        "defaultMode": "deep",
        "reasoningModel": {
            "pluginId": "langgenius/openai",
            "provider": "openai",
            "model": "gpt-4.1-mini",
        },
        "rerank": {
            "enabled": True,
            "model": {
                "pluginId": "langgenius/cohere",
                "provider": "cohere",
                "model": "rerank-v3.5",
            },
        },
        "scoreThreshold": {"enabled": True, "stage": "mode-final", "value": 0.6},
        "topK": 20,
    }

    with pytest.raises(ValueError):
        KnowledgeFSSpaceCreatePayload.model_validate(
            {
                "name": "Invalid preset",
                "slug": "invalid-preset",
                "embedding": {"pluginId": "plugin", "provider": "provider", "model": "embedding"},
                "retrieval": {
                    "defaultMode": "auto",
                    "reasoningModel": {"pluginId": "plugin", "provider": "provider", "model": "reasoning"},
                    "rerank": {"enabled": False},
                    "scoreThreshold": {"enabled": False, "stage": "mode-final"},
                    "topK": 10,
                },
            }
        )


def test_space_create_allows_deferred_model_setup_but_rejects_incomplete_fast_profile() -> None:
    payload = KnowledgeFSSpaceCreatePayload.model_validate(
        {
            "name": "Setup later",
            "slug": "setup-later",
        }
    )

    assert payload.embedding is None
    assert payload.retrieval is None

    with pytest.raises(ValueError, match="requires an embedding model"):
        KnowledgeFSSpaceCreatePayload.model_validate(
            {
                "name": "Incomplete fast profile",
                "slug": "incomplete-fast-profile",
                "retrieval": {
                    "defaultMode": "fast",
                    "reasoningModel": {
                        "pluginId": "plugin",
                        "provider": "provider",
                        "model": "reasoning",
                    },
                    "rerank": {"enabled": False},
                    "scoreThreshold": {"enabled": False, "stage": "mode-final"},
                    "topK": 10,
                },
            }
        )


def test_jwks_http_resource_returns_only_public_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    public_jwks = {
        "keys": [
            {"alg": "RS256", "e": "AQAB", "kid": "current", "kty": "RSA", "n": "modulus-1", "use": "sig"},
            {"alg": "RS256", "e": "AQAB", "kid": "previous", "kty": "RSA", "n": "modulus-2", "use": "sig"},
        ]
    }
    issuer = SimpleNamespace(public_jwks=lambda: public_jwks)
    monkeypatch.setattr(console_resources.dify_config, "KNOWLEDGE_FS_CAPABILITY_V2_ENABLED", True)
    monkeypatch.setattr(console_resources.dify_config, "KNOWLEDGE_FS_JWKS_CACHE_MAX_AGE_SECONDS", 123)
    monkeypatch.setattr(console_resources.session_factory, "get_session_maker", lambda: object())
    monkeypatch.setattr(console_resources, "create_configured_knowledge_fs_capability_issuer", lambda **_: issuer)
    app = Flask(__name__)

    with app.app_context():
        response = console_resources.KnowledgeFSJWKSApi().get()

    payload = response.get_json()
    assert payload == public_jwks
    assert response.headers["Cache-Control"] == "public, max-age=123, must-revalidate"
    assert not {"d", "p", "q", "dp", "dq", "qi"} & set().union(*(key.keys() for key in payload["keys"]))


def test_service_profile_rejects_cross_control_space_before_facade_io() -> None:
    class Credentials:
        def validate_service_credential(self, **kwargs):
            _ = kwargs
            return KnowledgeFSServiceCredentialProfile(
                tenant_id="tenant-1",
                control_space_id="control-1",
                credential_id="credential-1",
                principal_id="credential-1",
                allowed_actions=frozenset({"documents.list"}),
                knowledge_space_id="space-1",
                knowledge_space_revision=1,
                membership_epoch=0,
                space_acl_epoch=0,
                external_access_epoch=0,
                content_policy_revision=0,
                credential_revision=0,
                expires_at=None,
            )

    runtime = SimpleNamespace(credentials=Credentials())
    app = Flask(__name__)
    with app.test_request_context(headers={"Authorization": "Bearer kfs_test_credential_value_123456"}):
        with pytest.raises(Exception) as raised:
            service_resources._profile(
                runtime,  # type: ignore[arg-type]
                operation_id="listDocuments",
                control_space_id="control-2",
            )

    assert raised.value.__class__.__name__ == "KnowledgeFSCredentialValidationError"


def test_product_modules_do_not_import_dify_dataset_or_document_services() -> None:
    paths = [
        *_API_ROOT.glob("services/knowledge_fs/*.py"),
        *_API_ROOT.glob("controllers/console/knowledge_fs/*.py"),
        *_API_ROOT.glob("controllers/service_api/knowledge_fs/*.py"),
    ]
    forbidden_modules = {
        "models.dataset",
        "services.dataset_service",
        "services.document_service",
        "controllers.console.datasets",
        "controllers.service_api.dataset",
    }

    for path in paths:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        imported_modules = {
            node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module is not None
        }
        assert not any(
            module == forbidden or module.startswith(f"{forbidden}.")
            for module in imported_modules
            for forbidden in forbidden_modules
        ), path


def test_research_task_stream_url_binds_task_and_parent_space_without_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(console_resources.dify_config, "CONSOLE_API_URL", "https://dify.test")
    url = console_resources._research_task_events_url(
        task_id="task/one",
        knowledge_space_id="space one",
    )

    assert (
        url == "https://dify.test/console/api/knowledge-fs/research-tasks/task%2Fone/events?knowledgeSpaceId=space+one"
    )
    assert "token" not in url.lower()


def test_query_stream_capability_issues_exact_space_grant_without_token_in_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class Broker:
        def issue_interactive(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                token="query-capability",
                expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            )

    monkeypatch.setattr(console_resources.dify_config, "CONSOLE_API_URL", "https://dify.test")
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(
        console_resources,
        "_console_services",
        lambda: SimpleNamespace(broker=Broker()),
    )
    app = Flask(__name__)

    with app.test_request_context():
        post = inspect.unwrap(console_resources.KnowledgeFSSpaceQueryStreamCapabilityApi.post)
        response = post(console_resources.KnowledgeFSSpaceQueryStreamCapabilityApi(), "control-1")

    assert response == {
        "expires_at": "2030-01-01T00:00:00Z",
        "operation_id": "createQuery",
        "token": "query-capability",
        "url": "https://dify.test/console/api/knowledge-fs/query-stream",
    }
    assert calls == [
        {
            "account_id": "account-1",
            "control_space_id": "control-1",
            "operation_id": "createQuery",
            "tenant_id": "tenant-1",
        }
    ]
    assert "token" not in response["url"].lower()
    assert console_resources.KnowledgeFSSpaceQueryStreamCapabilityApi.post.__apidoc__["deprecated"] is True


def test_query_admission_binds_validated_mode_to_resolved_kfs_space(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []

    class Broker:
        def issue_interactive(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                token="query-capability",
                expires_at=datetime(2030, 1, 1, tzinfo=UTC),
                knowledge_space_id="space-1",
            )

    monkeypatch.setattr(console_resources.dify_config, "CONSOLE_API_URL", "https://dify.test")
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(
        console_resources,
        "_console_services",
        lambda: SimpleNamespace(broker=Broker()),
    )
    app = Flask(__name__)

    with app.test_request_context(json={"query": "What changed?", "mode": "auto"}):
        post = inspect.unwrap(console_resources.KnowledgeFSSpaceQueryAdmissionApi.post)
        response = post(console_resources.KnowledgeFSSpaceQueryAdmissionApi(), "control-1")

    assert response["operation_id"] == "createQuery"
    assert response["request"] == {
        "activeDocumentIds": [],
        "activeEntityIds": [],
        "knowledgeSpaceId": "space-1",
        "mode": "auto",
        "query": "What changed?",
    }
    assert response["url"] == "https://dify.test/console/api/knowledge-fs/query-stream"
    assert calls == [
        {
            "account_id": "account-1",
            "control_space_id": "control-1",
            "operation_id": "createQuery",
            "tenant_id": "tenant-1",
        }
    ]


def test_console_query_stream_proxy_forwards_only_the_admitted_capability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    close = MagicMock()
    facade = SimpleNamespace(
        stream_query=MagicMock(
            return_value=KnowledgeFSRemoteSSEResponse(
                status_code=200,
                headers=(
                    ("content-type", "text/event-stream"),
                    ("x-query-run-id", "query-1"),
                ),
                chunks=iter((b"event: answer\n", b'data: {"answer":"ok"}\n\n')),
                close=close,
            )
        )
    )
    monkeypatch.setattr(console_resources, "_console_services", lambda: SimpleNamespace(facade=facade))
    app = Flask(__name__)

    with app.test_request_context(
        json={
            "activeDocumentIds": [],
            "activeEntityIds": [],
            "knowledgeSpaceId": "space-1",
            "mode": "fast",
            "query": "hello",
        },
        headers={
            "Authorization": "Bearer capability-token",
            "Cookie": "session=must-not-forward",
            "X-Trace-ID": "trace-1",
        },
    ):
        post = inspect.unwrap(console_resources.KnowledgeFSQueryStreamProxyApi.post)
        response = post(console_resources.KnowledgeFSQueryStreamProxyApi())

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/event-stream"
    assert response.headers["X-Accel-Buffering"] == "no"
    assert b"".join(response.response) == b'event: answer\ndata: {"answer":"ok"}\n\n'
    close.assert_called_once_with()
    call = facade.stream_query.call_args.kwargs
    assert call["capability_token"] == "capability-token"
    assert call["trace_id"] == "trace-1"
    assert call["payload"].knowledge_space_id == "space-1"
    assert set(call) == {"capability_token", "trace_id", "payload"}


def test_service_query_stream_proxy_forwards_only_the_admitted_capability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    close = MagicMock()
    facade = SimpleNamespace(
        stream_query=MagicMock(
            return_value=KnowledgeFSRemoteSSEResponse(
                status_code=200,
                headers=(
                    ("content-type", "text/event-stream"),
                    ("x-query-run-id", "query-1"),
                ),
                chunks=iter((b"event: answer\n", b'data: {"answer":"ok"}\n\n')),
                close=close,
            )
        )
    )
    monkeypatch.setattr(service_resources, "_runtime", lambda: SimpleNamespace(facade=facade))
    app = Flask(__name__)

    with app.test_request_context(
        json={
            "activeDocumentIds": [],
            "activeEntityIds": [],
            "knowledgeSpaceId": "space-1",
            "mode": "fast",
            "query": "hello",
        },
        headers={
            "Authorization": "Bearer capability-token",
            "Cookie": "session=must-not-forward",
            "X-Trace-ID": "trace-1",
        },
    ):
        post = inspect.unwrap(service_resources.KnowledgeFSServiceQueryStreamProxyApi.post)
        response = post(service_resources.KnowledgeFSServiceQueryStreamProxyApi())

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/event-stream"
    assert response.headers["X-Accel-Buffering"] == "no"
    assert b"".join(response.response) == b'event: answer\ndata: {"answer":"ok"}\n\n'
    close.assert_called_once_with()
    call = facade.stream_query.call_args.kwargs
    assert call["capability_token"] == "capability-token"
    assert call["trace_id"] == "trace-1"
    assert call["payload"].knowledge_space_id == "space-1"
    assert set(call) == {"capability_token", "trace_id", "payload"}


@pytest.mark.parametrize(
    ("headers", "error_type"),
    [
        ({"X-Trace-ID": "trace-1"}, service_resources.KnowledgeFSInvalidCredentialHTTPError),
        (
            {"Authorization": "Bearer capability-token"},
            service_resources.KnowledgeFSServiceInvalidRequestHTTPError,
        ),
    ],
)
def test_service_query_stream_proxy_rejects_invalid_internal_transport_headers(
    headers: dict[str, str],
    error_type: type[Exception],
) -> None:
    app = Flask(__name__)

    with app.test_request_context(headers=headers), pytest.raises(error_type):
        service_resources._stream_capability()


def test_task_stream_capability_uses_broker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class Broker:
        def issue_interactive(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                token="direct-capability",
                expires_at=datetime(2030, 1, 1, tzinfo=UTC),
                knowledge_space_id="space-1",
            )

    runtime = SimpleNamespace(broker=Broker())
    monkeypatch.setattr(console_resources.dify_config, "CONSOLE_API_URL", "https://dify.test")
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    app = Flask(__name__)

    with app.test_request_context(json={"control_space_id": "control-1"}):
        stream_post = inspect.unwrap(console_resources.KnowledgeFSTaskStreamCapabilityApi.post)
        stream_response = stream_post(console_resources.KnowledgeFSTaskStreamCapabilityApi(), "task-1")

    assert stream_response["operation_id"] == "streamResearchTask"
    assert calls == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "operation_id": "streamResearchTask",
            "resource_id": "task-1",
        },
    ]


def test_service_query_admission_uses_broker(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []
    credential_calls: list[dict[str, object]] = []
    profile = SimpleNamespace(tenant_id="tenant-1", control_space_id="control-1")

    class Credentials:
        def validate_service_credential(self, **kwargs):
            credential_calls.append(kwargs)
            return profile

    class Broker:
        def issue_service(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                token="service-capability",
                expires_at=datetime(2030, 1, 1, tzinfo=UTC),
                knowledge_space_id="space-1",
            )

    runtime = SimpleNamespace(
        credentials=Credentials(),
        broker=Broker(),
    )
    monkeypatch.setattr(service_resources.dify_config, "SERVICE_API_URL", "https://api.dify.test")
    monkeypatch.setattr(service_resources, "_runtime", lambda: runtime)
    app = Flask(__name__)

    with app.test_request_context(
        json={"query": "What changed?", "mode": "fast"},
        headers={"Authorization": "Bearer kfs_test_credential_value_123456"},
    ):
        post = inspect.unwrap(service_resources.KnowledgeFSServiceQueryAdmissionApi.post)
        response = post(service_resources.KnowledgeFSServiceQueryAdmissionApi(), "control-1")

    assert response["operation_id"] == "createQuery"
    assert response["request"]["knowledgeSpaceId"] == "space-1"
    assert response["url"] == "https://api.dify.test/v1/knowledge-fs/query-stream"
    assert credential_calls == [
        {
            "raw_credential": "kfs_test_credential_value_123456",
            "required_action": "queries.create",
        }
    ]
    assert calls == [{"profile": profile, "operation_id": "createQuery"}]
