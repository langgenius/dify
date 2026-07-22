from __future__ import annotations

import ast
import inspect
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from flask import Flask
from werkzeug.exceptions import RequestEntityTooLarge

from controllers.console import console_ns
from controllers.console.knowledge_fs import resources as console_resources
from controllers.console.knowledge_fs.error import KnowledgeFSQuotaExceededHTTPError, KnowledgeFSRateLimitHTTPError
from controllers.service_api import service_api_ns
from controllers.service_api.knowledge_fs import resources as service_resources
from controllers.service_api.knowledge_fs.error import (
    KnowledgeFSServiceQuotaExceededHTTPError,
    KnowledgeFSServiceRateLimitHTTPError,
)
from services.knowledge_fs.credential_service import KnowledgeFSServiceCredentialProfile
from services.knowledge_fs.operation_admission import (
    KnowledgeFSOperationQuotaExceededError,
    KnowledgeFSOperationRateLimitExceededError,
)
from services.knowledge_fs.product_dto import KnowledgeFSSmallFileUploadResponse, KnowledgeFSSpaceCreatePayload
from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError

_API_ROOT = Path(__file__).resolve().parents[3]


def test_console_and_service_api_routes_are_registered() -> None:
    console_urls = {url for route in console_ns.resources for url in route.urls if url.startswith("/knowledge-fs/")}
    service_urls = {url for route in service_api_ns.resources for url in route.urls if url.startswith("/knowledge-fs/")}

    assert {
        "/knowledge-fs/spaces",
        "/knowledge-fs/spaces/<string:control_space_id>",
        "/knowledge-fs/spaces/<string:control_space_id>/permissions",
        "/knowledge-fs/spaces/<string:control_space_id>/members",
        "/knowledge-fs/spaces/<string:control_space_id>/app-bindings",
        ("/knowledge-fs/spaces/<string:control_space_id>/app-bindings/<string:caller_kind>/<string:app_id>"),
        "/knowledge-fs/spaces/<string:control_space_id>/external-access",
        "/knowledge-fs/spaces/<string:control_space_id>/credentials",
        "/knowledge-fs/spaces/<string:control_space_id>/settings",
        "/knowledge-fs/spaces/<string:control_space_id>/documents",
        "/knowledge-fs/spaces/<string:control_space_id>/sources",
        "/knowledge-fs/spaces/<string:control_space_id>/queries",
        "/knowledge-fs/spaces/<string:control_space_id>/research-tasks",
        "/knowledge-fs/spaces/<string:control_space_id>/traces",
        "/knowledge-fs/spaces/<string:control_space_id>/upload-capabilities",
        ("/knowledge-fs/spaces/<string:control_space_id>/upload-sessions/<string:upload_session_id>/small-file"),
        "/knowledge-fs/spaces/<string:control_space_id>/query-stream-capability",
        "/knowledge-fs/tasks/<string:task_id>/stream-capability",
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
        "KnowledgeFSDocumentCreatePayload",
        "KnowledgeFSSourceCreatePayload",
        "KnowledgeFSQueryCreatePayload",
        "KnowledgeFSQueryStreamCapabilityResponse",
        "KnowledgeFSResearchTaskCreatePayload",
        "KnowledgeFSStreamCapabilityPayload",
        "KnowledgeFSUploadCapabilityPayload",
        "KnowledgeFSSpaceListResponse",
        "KnowledgeFSSpaceDetailResponse",
        "KnowledgeFSCredentialCreateResponse",
        "KnowledgeFSStreamCapabilityResponse",
        "KnowledgeFSJWKSResponse",
        "KnowledgeFSSmallFileUploadResponse",
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
    upload_capability_schema = console_ns.models["KnowledgeFSCapabilityResponse"].__schema__
    assert set(upload_capability_schema["required"]) == {
        "direct_origin",
        "expires_at",
        "operation_id",
        "token",
    }
    assert upload_capability_schema["properties"]["operation_id"]["enum"] == [
        "createUploadSession",
        "presignUploadSessionPart",
        "completeUploadSession",
        "abortUploadSession",
    ]
    query_capability_schema = console_ns.models["KnowledgeFSQueryStreamCapabilityResponse"].__schema__
    assert set(query_capability_schema["required"]) == {"expires_at", "operation_id", "token", "url"}
    assert query_capability_schema["properties"]["operation_id"]["const"] == "createQuery"


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


def test_console_maps_weighted_rate_and_billing_exhaustion_to_stable_errors() -> None:
    @console_resources._knowledge_fs_errors
    def rate_limited():
        raise KnowledgeFSOperationRateLimitExceededError()

    @console_resources._knowledge_fs_errors
    def quota_exhausted():
        raise KnowledgeFSOperationQuotaExceededError()

    with pytest.raises(KnowledgeFSRateLimitHTTPError):
        rate_limited()
    with pytest.raises(KnowledgeFSQuotaExceededHTTPError):
        quota_exhausted()

    @service_resources._service_api_errors
    def service_rate_limited():
        raise KnowledgeFSOperationRateLimitExceededError()

    @service_resources._service_api_errors
    def service_quota_exhausted():
        raise KnowledgeFSOperationQuotaExceededError()

    with pytest.raises(KnowledgeFSServiceRateLimitHTTPError) as service_rate:
        service_rate_limited()
    with pytest.raises(KnowledgeFSServiceQuotaExceededHTTPError) as service_quota:
        service_quota_exhausted()

    assert service_rate.value.code == 429
    assert service_quota.value.code == 403


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


def test_research_task_stream_url_binds_task_and_parent_space_without_token() -> None:
    url = console_resources._research_task_events_url(
        direct_origin="https://knowledge-fs.test",
        task_id="task/one",
        knowledge_space_id="space one",
    )

    assert url == "https://knowledge-fs.test/research-tasks/task%2Fone/events?knowledgeSpaceId=space+one"
    assert "token" not in url.lower()


def test_query_stream_capability_issues_exact_space_grant_without_token_in_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class DirectAdmission:
        def issue_interactive(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                token="query-capability",
                expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            )

    monkeypatch.setattr(console_resources.dify_config, "KNOWLEDGE_FS_DIRECT_ORIGIN", "https://kfs.test/")
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(
        console_resources,
        "_console_services",
        lambda: SimpleNamespace(direct_operation_admission=DirectAdmission()),
    )
    app = Flask(__name__)

    with app.test_request_context():
        post = inspect.unwrap(console_resources.KnowledgeFSSpaceQueryStreamCapabilityApi.post)
        response = post(console_resources.KnowledgeFSSpaceQueryStreamCapabilityApi(), "control-1")

    assert response == {
        "expires_at": "2030-01-01T00:00:00Z",
        "operation_id": "createQuery",
        "token": "query-capability",
        "url": "https://kfs.test/queries",
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

    class DirectAdmission:
        def issue_interactive(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                token="query-capability",
                expires_at=datetime(2030, 1, 1, tzinfo=UTC),
                knowledge_space_id="space-1",
            )

    monkeypatch.setattr(console_resources.dify_config, "KNOWLEDGE_FS_DIRECT_ORIGIN", "https://kfs.test/")
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(
        console_resources,
        "_console_services",
        lambda: SimpleNamespace(direct_operation_admission=DirectAdmission()),
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
        "sessionId": None,
    }
    assert response["url"] == "https://kfs.test/queries"
    assert calls == [
        {
            "account_id": "account-1",
            "control_space_id": "control-1",
            "operation_id": "createQuery",
            "tenant_id": "tenant-1",
        }
    ]


def test_upload_and_task_stream_capabilities_use_direct_operation_admission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class DirectAdmission:
        def issue_interactive(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                token="direct-capability",
                expires_at=datetime(2030, 1, 1, tzinfo=UTC),
                knowledge_space_id="space-1",
            )

    runtime = SimpleNamespace(direct_operation_admission=DirectAdmission())
    monkeypatch.setattr(console_resources.dify_config, "KNOWLEDGE_FS_DIRECT_ORIGIN", "https://kfs.test")
    monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
    app = Flask(__name__)

    with app.test_request_context(json={"operation_id": "completeUploadSession", "upload_session_id": "session-1"}):
        upload_post = inspect.unwrap(console_resources.KnowledgeFSSpaceUploadCapabilitiesApi.post)
        upload_response = upload_post(console_resources.KnowledgeFSSpaceUploadCapabilitiesApi(), "control-1")

    with app.test_request_context(json={"control_space_id": "control-1"}):
        stream_post = inspect.unwrap(console_resources.KnowledgeFSTaskStreamCapabilityApi.post)
        stream_response = stream_post(console_resources.KnowledgeFSTaskStreamCapabilityApi(), "task-1")

    assert upload_response["operation_id"] == "completeUploadSession"
    assert stream_response["operation_id"] == "streamResearchTask"
    assert calls == [
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "operation_id": "completeUploadSession",
            "resource_id": "session-1",
        },
        {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "control-1",
            "operation_id": "streamResearchTask",
            "resource_id": "task-1",
        },
    ]


def test_service_query_admission_uses_direct_operation_admission(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []
    profile = SimpleNamespace(tenant_id="tenant-1", control_space_id="control-1")

    class Credentials:
        def validate_service_credential(self, **kwargs):
            _ = kwargs
            return profile

    class DirectAdmission:
        def issue_service(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                token="service-capability",
                expires_at=datetime(2030, 1, 1, tzinfo=UTC),
                knowledge_space_id="space-1",
            )

    runtime = SimpleNamespace(
        credentials=Credentials(),
        direct_operation_admission=DirectAdmission(),
    )
    monkeypatch.setattr(service_resources.dify_config, "KNOWLEDGE_FS_DIRECT_ORIGIN", "https://kfs.test")
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
    assert calls == [{"profile": profile, "operation_id": "createQuery"}]
