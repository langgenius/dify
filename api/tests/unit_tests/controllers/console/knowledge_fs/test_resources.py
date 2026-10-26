from __future__ import annotations

import ast
import inspect
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from hashlib import sha256
from http import HTTPStatus
from inspect import unwrap
from io import BytesIO
from pathlib import Path
from types import FunctionType
from typing import Literal, Never, cast

import pytest
from flask import Flask
from flask_restx import Resource
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden, NotFound, ServiceUnavailable

from controllers.common import wraps as common_wraps
from controllers.console import console_ns, flask_admission, wraps
from controllers.console import wraps as console_wraps
from controllers.console.knowledge_fs import resources
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
    KnowledgeFSTimeoutHTTPError,
    KnowledgeFSUpstreamUnavailableHTTPError,
)
from controllers.console.wraps import RBACPermission as _knowledge_fs_product_controllers_RBACPermission
from controllers.service_api import service_api_ns
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
from core.rbac.entities import RBACPermission as _knowledge_fs_creation_RBACPermission
from enums import DeploymentEdition
from libs import login
from libs.exception import BaseHTTPException
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models import Account
from models.account import TenantAccountRole
from models.enums import ApiTokenType
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType, KnowledgeFSControlSpaceState
from models.model import ApiToken
from services.enterprise.rbac_service import RBACService
from services.knowledge_fs import source_edit_service
from services.knowledge_fs.capability_broker import KnowledgeFSIssuedProductCapability
from services.knowledge_fs.control_space_commands import KnowledgeFSControlSpaceIntentConflictError
from services.knowledge_fs.download_service import KnowledgeFSDownloadUnavailableError
from services.knowledge_fs.object_storage import KnowledgeFSObjectMetadata
from services.knowledge_fs.product_dto import (
    KnowledgeFSAdmittedQueryRequest,
    KnowledgeFSAtomicSourceUpdatePayload,
    KnowledgeFSDocumentDownloadDescriptor,
    KnowledgeFSDocumentMultimodalManifest,
    KnowledgeFSDocumentStagedUploadAcceptedResponse,
    KnowledgeFSDocumentStagedUploadPayload,
    KnowledgeFSDocumentUploadAcceptedResponse,
    KnowledgeFSDurableDeletionAcceptedResponse,
    KnowledgeFSLogicalDocumentDeletePayload,
    KnowledgeFSNamespacePreviewJobResponse,
    KnowledgeFSNamespacePreviewPageResponse,
    KnowledgeFSOverviewBaseStatsResponse,
    KnowledgeFSOverviewQueryOutcomesResponse,
    KnowledgeFSPublicFailureResponse,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSSmallFileUploadResponse,
    KnowledgeFSSourceImportConfigurationPayload,
    KnowledgeFSSourceResponse,
    KnowledgeFSSourceSyncPolicyResponse,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSourceWorkflowResponse,
    KnowledgeFSSpaceCreatePayload,
    KnowledgeFSSpaceCreateResponse,
    KnowledgeFSStagedUploadResponse,
    KnowledgeFSStreamCapabilityPayload,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
    KnowledgeFSRemoteMultipartFile,
    KnowledgeFSRemoteSSEResponse,
)
from services.knowledge_fs.runtime import KnowledgeFSRuntime
from services.knowledge_fs.service_api_authorization import (
    KnowledgeFSServiceApiAuthorizationError,
    KnowledgeFSServiceApiProfile,
    KnowledgeFSServiceApiScopeError,
)
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.controllers.knowledge_fs_controller_fakes import (
    FakeComponent,
    FakeRuntime,
    Recorder,
    invocation,
    narrowed,
    raising,
)
from tests.helpers.unit.model_factories import make_account

"""KnowledgeFS creation must preserve legacy roles and Enterprise RBAC admission."""


class TestKnowledgeFsCreationCases:
    @staticmethod
    @pytest.mark.parametrize(
        ("role", "rbac_enabled", "rbac_allowed", "allowed"),
        [
            (TenantAccountRole.NORMAL, False, True, False),
            (None, False, True, False),
            (TenantAccountRole.OWNER, False, True, True),
            (TenantAccountRole.ADMIN, False, True, True),
            (TenantAccountRole.EDITOR, False, True, True),
            (TenantAccountRole.DATASET_OPERATOR, False, True, True),
            (TenantAccountRole.NORMAL, True, True, True),
            (TenantAccountRole.ADMIN, True, False, False),
        ],
    )
    def test_create_space_enforces_admission_before_provisioning(
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        role: TenantAccountRole | None,
        rbac_enabled: bool,
        rbac_allowed: bool,
        allowed: bool,
    ) -> None:
        config_overrides(
            DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
            KNOWLEDGE_FS_ENABLED=True,
            RBAC_ENABLED=rbac_enabled,
            LOGIN_DISABLED=False,
        )
        account = make_account(role=role)
        identity = AccountWithTenant(account, "workspace")
        monkeypatch.setattr(login, "_resolve_current_user", lambda: account)
        monkeypatch.setattr(login, "check_csrf_token", lambda _request, _user_id: None)
        monkeypatch.setattr(wraps, "current_account_with_tenant", lambda: identity)
        monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: identity)
        monkeypatch.setattr(resources, "current_account_with_tenant", lambda: identity)
        monkeypatch.setattr(wraps, "check_knowledge_rate_limit", lambda: None)
        check_access = Recorder(rbac_allowed)
        monkeypatch.setattr(RBACService.CheckAccess, "check", check_access)
        create_space = Recorder(
            KnowledgeFSSpaceCreateResponse(
                control_space_id="space",
                state=KnowledgeFSControlSpaceState.PROVISIONING,
                operation_id="operation",
                model_setup_required=True,
            )
        )
        runtime = FakeRuntime(application=FakeComponent(create_space=create_space))
        monkeypatch.setattr(resources, "_console_services", lambda: runtime)

        with app.test_request_context("/knowledge-fs/spaces", method="POST", json={"name": "Test", "slug": "test"}):
            if allowed:
                result, status = resources.KnowledgeFSSpacesApi().post()
                assert status == HTTPStatus.ACCEPTED
                assert result["control_space_id"] == "space"
            else:
                with pytest.raises(Forbidden):
                    resources.KnowledgeFSSpacesApi().post()

        if allowed:
            assert create_space.only_call.kwargs["tenant_id"] == "workspace"
            assert create_space.only_call.kwargs["account_id"] == account.id
        else:
            assert not create_space.calls
        if rbac_enabled:
            assert check_access.only_call == invocation(
                "workspace",
                account.id,
                scene=_knowledge_fs_creation_RBACPermission.DATASET_CREATE_AND_MANAGEMENT.value,
                resource_type=None,
                resource_id=None,
            )
        else:
            assert not check_access.calls


_API_ROOT = Path(__file__).resolve().parents[5]


@dataclass(frozen=True)
class _FacadeRuntime[T]:
    facade: T


@dataclass(frozen=True)
class _BrokerRuntime[T]:
    broker: T


def _knowledge_fs_product_controllers_account(account_id: str = "account-1") -> Account:
    account = Account(name="Test User", email="user@example.com")
    account.id = account_id
    return account


def _dataset_api_token(tenant_id: str | None = "tenant-1") -> ApiToken:
    api_token = ApiToken()
    api_token.id = "token-1"
    api_token.tenant_id = tenant_id
    api_token.type = ApiTokenType.DATASET
    api_token.token = "dataset-test-key"
    return api_token


def _issued_capability(
    *, token: str, operation_id: str, knowledge_space_id: str = "space-1"
) -> KnowledgeFSIssuedProductCapability:
    return KnowledgeFSIssuedProductCapability(
        token=token,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        operation_id=operation_id,
        knowledge_space_id=knowledge_space_id,
        knowledge_space_revision=1,
        trace_id="trace-1",
    )


def _service_profile(control_space_id: str) -> KnowledgeFSServiceApiProfile:
    return KnowledgeFSServiceApiProfile(
        tenant_id="tenant-1",
        control_space_id=control_space_id,
        api_token_id="token-1",
        principal_id="token-1",
        knowledge_space_id="space-1",
        knowledge_space_revision=1,
        membership_epoch=0,
        space_acl_epoch=0,
        external_access_epoch=0,
        content_policy_revision=0,
    )


def _rbac_wrapper(view: FunctionType) -> FunctionType:
    current = inspect.unwrap(
        view,
        stop=lambda candidate: (
            isinstance(candidate, FunctionType) and "rbac_permission_required" in candidate.__code__.co_qualname
        ),
    )
    assert isinstance(current, FunctionType)
    assert "rbac_permission_required" in current.__code__.co_qualname, "RBAC permission wrapper is missing"
    return current


def _document_multimodal_manifest(*, object_key: str | None = None) -> KnowledgeFSDocumentMultimodalManifest:
    asset_ref = (
        {
            "contentType": "image/png",
            "objectKey": object_key,
            "sha256": "a" * 64,
            "variants": {
                "thumbnail": {
                    "contentType": "image/webp",
                    "objectKey": object_key.replace("full.png", "thumbnail.webp"),
                    "sha256": "b" * 64,
                }
            },
        }
        if object_key is not None
        else None
    )
    return KnowledgeFSDocumentMultimodalManifest.model_validate(
        {
            "artifactHash": "c" * 64,
            "createdAt": "2026-08-14T12:00:00.000Z",
            "documentAssetId": "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
            "id": "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
            "items": [
                {
                    "assetRef": asset_ref,
                    "caption": "Architecture",
                    "endOffset": 42,
                    "id": "figure:1",
                    "modality": "image",
                    "ocrText": "Service A to Service B",
                    "pageNumber": 2,
                    "parseElementId": "parse-element-1",
                    "sectionPath": ["Architecture"],
                    "startOffset": 42,
                    "title": "System diagram",
                }
            ],
            "knowledgeSpaceId": "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
            "manifestVersion": "document-multimodal@1",
            "updatedAt": "2026-08-14T12:01:00.000Z",
            "version": 3,
        }
    )


class TestKnowledgeFsProductControllersCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _enabled_knowledge_fs(config_overrides: Callable[..., None]) -> None:
        config_overrides(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            KNOWLEDGE_FS_ENABLED=True,
            KNOWLEDGE_FS_COMMUNITY_DEV_ENABLED=True,
        )

    @staticmethod
    def test_disabled_knowledge_fs_rejects_console_work_before_preview_upload_or_query_admission(
        config_overrides: Callable[..., None],
    ) -> None:
        config_overrides(KNOWLEDGE_FS_ENABLED=False)
        routes = (
            (
                console_resources.KnowledgeFSInitialSourcePreviewApi,
                console_resources.KnowledgeFSInitialSourcePreviewApi.post,
                (),
            ),
            (
                console_resources.KnowledgeFSInitialSourcePreviewJobsApi,
                console_resources.KnowledgeFSInitialSourcePreviewJobsApi.post,
                (),
            ),
            (console_resources.KnowledgeFSStagedUploadsApi, console_resources.KnowledgeFSStagedUploadsApi.post, ()),
            (
                console_resources.KnowledgeFSSpaceQueryAdmissionApi,
                console_resources.KnowledgeFSSpaceQueryAdmissionApi.post,
                ("space-1",),
            ),
        )
        for resource_type, view, args in routes:
            handler = inspect.unwrap(
                view,
                stop=lambda view: "_knowledge_fs_errors.<locals>.decorated" in view.__code__.co_qualname,
            )
            with pytest.raises(NotFound):
                handler(resource_type(), *args)

    @staticmethod
    def test_disabled_knowledge_fs_hides_jwks_even_when_capability_v2_is_configured(
        config_overrides: Callable[..., None],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        config_overrides(KNOWLEDGE_FS_ENABLED=False, KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=True)
        monkeypatch.setattr(
            console_resources.session_factory,
            "get_session_maker",
            lambda: pytest.fail("disabled JWKS must not access the database"),
        )
        with pytest.raises(NotFound):
            console_resources.KnowledgeFSJWKSApi().get()

    @staticmethod
    def test_disabled_knowledge_fs_rejects_service_api_before_token_validation(
        config_overrides: Callable[..., None],
    ) -> None:
        config_overrides(KNOWLEDGE_FS_ENABLED=False)
        handler = inspect.unwrap(
            service_resources.KnowledgeFSServiceSourceProvidersApi.get,
            stop=lambda view: "_service_api_errors.<locals>.decorated" in view.__code__.co_qualname,
        )
        with pytest.raises(NotFound):
            handler(service_resources.KnowledgeFSServiceSourceProvidersApi(), "space-1")

    @staticmethod
    def test_console_and_service_api_routes_are_registered() -> None:
        console_urls = {url for route in console_ns.resources for url in route.urls if url.startswith("/knowledge-fs/")}
        service_urls = {
            url for route in service_api_ns.resources for url in route.urls if url.startswith("/knowledge-fs/")
        }

        assert {
            "/knowledge-fs/spaces",
            "/knowledge-fs/uploads",
            "/knowledge-fs/uploads/<string:upload_id>",
            "/knowledge-fs/spaces/<string:control_space_id>",
            "/knowledge-fs/spaces/<string:control_space_id>/tags",
            "/knowledge-fs/spaces/<string:control_space_id>/permissions",
            "/knowledge-fs/spaces/<string:control_space_id>/members",
            "/knowledge-fs/spaces/<string:control_space_id>/app-bindings",
            ("/knowledge-fs/spaces/<string:control_space_id>/app-bindings/<string:caller_kind>/<string:app_id>"),
            "/knowledge-fs/spaces/<string:control_space_id>/external-access",
            "/knowledge-fs/spaces/<string:control_space_id>/settings",
            "/knowledge-fs/spaces/<string:control_space_id>/documents",
            "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/multimodal",
            (
                "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/multimodal/"
                "<path:item_id>/asset"
            ),
            "/knowledge-fs/spaces/<string:control_space_id>/logical-documents",
            "/knowledge-fs/spaces/<string:control_space_id>/logical-documents/download-zip",
            "/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>",
            "/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>/download",
            "/knowledge-fs/spaces/<string:control_space_id>/sources",
            "/knowledge-fs/spaces/<string:control_space_id>/source-connections",
            "/knowledge-fs/spaces/<string:control_space_id>/source-providers",
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
            "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/async-import",
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
            "/knowledge-fs/spaces/<string:control_space_id>/logical-documents",
            "/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>",
            "/knowledge-fs/spaces/<string:control_space_id>/document-references/resolve",
            "/knowledge-fs/spaces/<string:control_space_id>/deletion-jobs/<string:job_id>",
            "/knowledge-fs/spaces/<string:control_space_id>/deletion-jobs/<string:job_id>/retry",
            "/knowledge-fs/spaces/<string:control_space_id>/deletion-batches/<string:batch_id>",
            "/knowledge-fs/spaces/<string:control_space_id>/research-tasks/<string:task_id>/resume",
            "/knowledge-fs/spaces/<string:control_space_id>/background-tasks",
            "/knowledge-fs/spaces/<string:control_space_id>/settings/migrations/<string:migration_id>",
            "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/sync",
            "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/crawl-preview",
            "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/crawl-import",
            "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/workflow-imports",
            "/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/sync-policy",
            "/knowledge-fs/spaces/<string:control_space_id>/source-connections",
            "/knowledge-fs/spaces/<string:control_space_id>/source-providers",
            "/knowledge-fs/spaces/<string:control_space_id>/query-images",
            "/knowledge-fs/spaces/<string:control_space_id>/source-connections/<string:connection_id>/refresh",
            "/knowledge-fs/spaces/<string:control_space_id>/source-workflows",
            "/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>",
            "/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/cancel",
            "/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/retry",
            "/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/pages",
            "/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/selection",
            "/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>/processing-tasks",
            "/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>/processing-tasks/<string:task_id>",
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

    @staticmethod
    def test_initial_website_preview_job_routes_delegate_to_namespace_capabilities(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        account = _knowledge_fs_product_controllers_account()
        preview_service = FakeComponent(require_visible_credential=Recorder())
        facade = FakeComponent(
            create_namespace_source_preview=Recorder(
                KnowledgeFSNamespacePreviewJobResponse(
                    job_id="job-1",
                    status="queued",
                    configuration_fingerprint="f" * 64,
                    expires_at="2030-01-01T00:00:00Z",
                )
            ),
            get_namespace_source_preview=Recorder(
                KnowledgeFSNamespacePreviewJobResponse(
                    job_id="job-1",
                    status="completed",
                    configuration_fingerprint="f" * 64,
                    expires_at="2030-01-01T00:00:00Z",
                    pages=[
                        KnowledgeFSNamespacePreviewPageResponse(
                            page_id="page-1",
                            source_url="https://example.com/page",
                            title="Page",
                        )
                    ],
                )
            ),
            cancel_namespace_source_preview=Recorder(
                KnowledgeFSNamespacePreviewJobResponse(
                    job_id="job-1",
                    status="consumed",
                    configuration_fingerprint="f" * 64,
                    expires_at="2030-01-01T00:00:00Z",
                )
            ),
        )
        monkeypatch.setattr(console_resources, "current_account_with_tenant", lambda: (account, "tenant-1"))
        monkeypatch.setattr(console_resources, "KnowledgeFSInitialSourcePreviewService", lambda _: preview_service)
        monkeypatch.setattr(console_resources, "_console_services", lambda: FakeRuntime(facade=facade))
        app = Flask(__name__)

        with app.test_request_context(
            method="POST",
            json={
                "kind": "website_crawl",
                "credentialId": "credential-1",
                "datasource": "website",
                "pluginId": "plugin-1",
                "provider": "firecrawl",
                "parameters": {"url": "https://example.com"},
            },
        ):
            response, status = inspect.unwrap(console_resources.KnowledgeFSInitialSourcePreviewJobsApi.post)(
                console_resources.KnowledgeFSInitialSourcePreviewJobsApi()
            )
        assert status == 202
        assert response == {"job_id": "job-1", "status": "pending"}
        assert len(preview_service.require_visible_credential.calls) == 1
        assert len(facade.create_namespace_source_preview.calls) == 1

        with app.test_request_context():
            response = inspect.unwrap(console_resources.KnowledgeFSInitialSourcePreviewJobApi.get)(
                console_resources.KnowledgeFSInitialSourcePreviewJobApi(), "job-1"
            )
        assert response["status"] == "completed"
        assert response["result"]["pages"] == [
            {
                "description": None,
                "page_id": "page-1",
                "source_url": "https://example.com/page",
                "title": "Page",
            }
        ]

        facade.get_namespace_source_preview.return_value = KnowledgeFSNamespacePreviewJobResponse(
            job_id="job-1",
            status="queued",
            configuration_fingerprint="f" * 64,
            expires_at="2030-01-01T00:00:00Z",
        )
        with app.test_request_context():
            response = inspect.unwrap(console_resources.KnowledgeFSInitialSourcePreviewJobApi.get)(
                console_resources.KnowledgeFSInitialSourcePreviewJobApi(), "job-1"
            )
        assert response["status"] == "pending"
        assert response["result"] is None

        with app.test_request_context(method="DELETE"):
            response = inspect.unwrap(console_resources.KnowledgeFSInitialSourcePreviewJobApi.delete)(
                console_resources.KnowledgeFSInitialSourcePreviewJobApi(), "job-1"
            )
        assert response == {"job_id": "job-1", "result": None, "status": "completed"}

    @staticmethod
    @pytest.mark.parametrize(
        ("api_class", "method_name", "path_args"),
        [
            (
                console_resources.KnowledgeFSSpaceLogicalDocumentDownloadApi,
                console_resources.KnowledgeFSSpaceLogicalDocumentDownloadApi.get,
                {"control_space_id": "control-1", "document_id": "document-1"},
            ),
            (
                console_resources.KnowledgeFSSpaceLogicalDocumentsDownloadApi,
                console_resources.KnowledgeFSSpaceLogicalDocumentsDownloadApi.post,
                {"control_space_id": "control-1"},
            ),
        ],
    )
    def test_document_download_routes_deny_callers_without_dataset_download_permission(
        monkeypatch: pytest.MonkeyPatch,
        api_class: type,
        method_name: FunctionType,
        path_args: dict[str, str],
    ) -> None:
        permission_gate = Recorder(raises=Forbidden())
        apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
        monkeypatch.setattr(
            common_wraps,
            "current_account_with_tenant",
            lambda: (_knowledge_fs_product_controllers_account(), "tenant-1"),
        )
        monkeypatch.setattr("controllers.common.rbac.checks.RBACService.CheckAccess.check", permission_gate)
        # The download routes carry the knowledge rate limit too; it needs a logged-in account.
        monkeypatch.setattr(console_wraps, "check_knowledge_rate_limit", lambda: None)
        monkeypatch.setattr(
            console_resources,
            "_console_services",
            lambda: pytest.fail("permission denial must happen before KnowledgeFS access"),
        )

        permission_wrapper = _rbac_wrapper(method_name)
        with pytest.raises(Forbidden):
            permission_wrapper(api_class(), **path_args)

        assert permission_gate.calls == [
            invocation(
                "tenant-1",
                "account-1",
                scene=_knowledge_fs_product_controllers_RBACPermission.DATASET_DOCUMENT_DOWNLOAD,
                resource_type=None,
                resource_id=None,
            )
        ]

    @staticmethod
    def test_single_document_download_allows_dataset_download_permission_and_keeps_tenant_scope(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        descriptor = KnowledgeFSDocumentDownloadDescriptor(
            document_id="document-1",
            filename="guide.md",
            mime_type="text/markdown",
            object_key="namespaces/tenant-1/spaces/space-1/documents/guide.md",
            sha256="a" * 64,
            size_bytes=4,
        )
        facade = FakeComponent(prepare_logical_document_download=Recorder(descriptor))
        download_service = FakeComponent(load_stream=Recorder(iter((b"body",))))
        permission_gate = Recorder(True)
        apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
        monkeypatch.setattr(
            common_wraps,
            "current_account_with_tenant",
            lambda: (_knowledge_fs_product_controllers_account(), "tenant-1"),
        )
        monkeypatch.setattr("controllers.common.rbac.checks.RBACService.CheckAccess.check", permission_gate)
        # The download routes carry the knowledge rate limit too; it needs a logged-in account.
        monkeypatch.setattr(console_wraps, "check_knowledge_rate_limit", lambda: None)
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: FakeRuntime(facade=facade))
        monkeypatch.setattr(console_resources, "KnowledgeFSDownloadService", lambda: download_service)
        permission_wrapper = _rbac_wrapper(console_resources.KnowledgeFSSpaceLogicalDocumentDownloadApi.get)
        app = Flask(__name__)

        with app.test_request_context():
            response = permission_wrapper(
                console_resources.KnowledgeFSSpaceLogicalDocumentDownloadApi(),
                control_space_id="control-1",
                document_id="document-1",
            )

        assert response.get_data() == b"body"
        assert response.headers["Content-Disposition"] == "attachment; filename*=UTF-8''guide.md"
        assert permission_gate.calls == [
            invocation(
                "tenant-1",
                "account-1",
                scene=_knowledge_fs_product_controllers_RBACPermission.DATASET_DOCUMENT_DOWNLOAD,
                resource_type=None,
                resource_id=None,
            )
        ]
        assert facade.prepare_logical_document_download.calls == [
            invocation(
                tenant_id="tenant-1",
                account_id="account-1",
                control_space_id="control-1",
                document_id="document-1",
            )
        ]

    @staticmethod
    def test_single_document_download_preserves_resource_not_found_after_permission_allows(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        facade = FakeComponent(
            prepare_logical_document_download=Recorder(
                raises=KnowledgeFSProductResourceNotFoundError("document not found")
            )
        )
        permission_gate = Recorder(True)
        download_service_factory = Recorder()
        apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
        monkeypatch.setattr(
            common_wraps,
            "current_account_with_tenant",
            lambda: (_knowledge_fs_product_controllers_account(), "tenant-1"),
        )
        monkeypatch.setattr("controllers.common.rbac.checks.RBACService.CheckAccess.check", permission_gate)
        # The download routes carry the knowledge rate limit too; it needs a logged-in account.
        monkeypatch.setattr(console_wraps, "check_knowledge_rate_limit", lambda: None)
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: FakeRuntime(facade=facade))
        monkeypatch.setattr(console_resources, "KnowledgeFSDownloadService", download_service_factory)
        permission_wrapper = _rbac_wrapper(console_resources.KnowledgeFSSpaceLogicalDocumentDownloadApi.get)
        app = Flask(__name__)

        with app.test_request_context(), pytest.raises(KnowledgeFSResourceNotFoundHTTPError):
            permission_wrapper(
                console_resources.KnowledgeFSSpaceLogicalDocumentDownloadApi(),
                control_space_id="foreign-control",
                document_id="document-1",
            )

        assert len(permission_gate.calls) == 1
        assert facade.prepare_logical_document_download.calls == [
            invocation(
                tenant_id="tenant-1",
                account_id="account-1",
                control_space_id="foreign-control",
                document_id="document-1",
            )
        ]
        assert download_service_factory.calls == []

    @staticmethod
    def test_single_document_download_maps_storage_unavailable_after_permission_allows(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        descriptor = KnowledgeFSDocumentDownloadDescriptor(
            document_id="document-1",
            filename="guide.md",
            mime_type="text/markdown",
            object_key="namespaces/tenant-1/spaces/space-1/documents/guide.md",
            sha256="a" * 64,
            size_bytes=4,
        )
        facade = FakeComponent(prepare_logical_document_download=Recorder(descriptor))
        download_service = FakeComponent(
            load_stream=Recorder(raises=KnowledgeFSDownloadUnavailableError("storage unavailable"))
        )
        permission_gate = Recorder(True)
        apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
        monkeypatch.setattr(
            common_wraps,
            "current_account_with_tenant",
            lambda: (_knowledge_fs_product_controllers_account(), "tenant-1"),
        )
        monkeypatch.setattr("controllers.common.rbac.checks.RBACService.CheckAccess.check", permission_gate)
        # The download routes carry the knowledge rate limit too; it needs a logged-in account.
        monkeypatch.setattr(console_wraps, "check_knowledge_rate_limit", lambda: None)
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: FakeRuntime(facade=facade))
        monkeypatch.setattr(console_resources, "KnowledgeFSDownloadService", lambda: download_service)
        permission_wrapper = _rbac_wrapper(console_resources.KnowledgeFSSpaceLogicalDocumentDownloadApi.get)
        app = Flask(__name__)

        with app.test_request_context(), pytest.raises(ServiceUnavailable):
            permission_wrapper(
                console_resources.KnowledgeFSSpaceLogicalDocumentDownloadApi(),
                control_space_id="control-1",
                document_id="document-1",
            )

        assert len(permission_gate.calls) == 1
        assert download_service.load_stream.calls == [invocation(descriptor)]

    @staticmethod
    def test_batch_document_download_maps_storage_unavailable_after_permission_allows(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        descriptor = KnowledgeFSDocumentDownloadDescriptor(
            document_id="document-1",
            filename="guide.md",
            mime_type="text/markdown",
            object_key="namespaces/tenant-1/spaces/space-1/documents/guide.md",
            sha256="a" * 64,
            size_bytes=4,
        )
        facade = FakeComponent(prepare_logical_document_download=Recorder(descriptor))

        @contextmanager
        def unavailable_zip() -> Generator[Never]:
            raise KnowledgeFSDownloadUnavailableError("storage unavailable")
            yield

        download_service = FakeComponent(build_zip_tempfile=Recorder(unavailable_zip()))
        permission_gate = Recorder(True)
        apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
        monkeypatch.setattr(
            common_wraps,
            "current_account_with_tenant",
            lambda: (_knowledge_fs_product_controllers_account(), "tenant-1"),
        )
        monkeypatch.setattr("controllers.common.rbac.checks.RBACService.CheckAccess.check", permission_gate)
        # The download routes carry the knowledge rate limit too; it needs a logged-in account.
        monkeypatch.setattr(console_wraps, "check_knowledge_rate_limit", lambda: None)
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: FakeRuntime(facade=facade))
        monkeypatch.setattr(console_resources, "KnowledgeFSDownloadService", lambda: download_service)
        permission_wrapper = _rbac_wrapper(console_resources.KnowledgeFSSpaceLogicalDocumentsDownloadApi.post)
        app = Flask(__name__)

        with (
            app.test_request_context(json={"document_ids": ["document-1"]}),
            pytest.raises(ServiceUnavailable),
        ):
            permission_wrapper(
                console_resources.KnowledgeFSSpaceLogicalDocumentsDownloadApi(),
                control_space_id="control-1",
            )

        assert len(permission_gate.calls) == 1
        assert download_service.build_zip_tempfile.calls == [invocation([descriptor])]

    @staticmethod
    def test_knowledge_fs_request_and_response_schemas_are_registered() -> None:
        assert {
            "KnowledgeFSSpaceCreatePayload",
            "KnowledgeFSAppBindingPayload",
            "KnowledgeFSAppBindingListResponse",
            "KnowledgeFSSpaceUpdatePayload",
            "KnowledgeFSMembersReplacePayload",
            "KnowledgeFSExternalAccessPayload",
            "KnowledgeFSSettingsPayload",
            "KnowledgeFSSourceCreatePayload",
            "KnowledgeFSQueryCreatePayload",
            "KnowledgeFSQueryStreamCapabilityResponse",
            "KnowledgeFSResearchTaskCreatePayload",
            "KnowledgeFSStreamCapabilityPayload",
            "KnowledgeFSSpaceListResponse",
            "KnowledgeFSSpaceDetailResponse",
            "KnowledgeFSDocumentStagedUploadPayload",
            "KnowledgeFSDocumentStagedUploadAcceptedResponse",
            "KnowledgeFSDocumentMultimodalAssetQuery",
            "KnowledgeFSDocumentMultimodalManifestResponse",
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
            "KnowledgeFSQueryCreatePayload",
            "KnowledgeFSDocumentListResponse",
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

    @staticmethod
    def test_document_multimodal_manifest_console_bff_exposes_only_authorized_asset_urls(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        document_id = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44"
        manifest = _document_multimodal_manifest(
            object_key=(
                f"tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/documents/{document_id}/assets/figure-1-full.png"
            )
        )
        facade = FakeComponent(get_document_multimodal_manifest=Recorder(manifest))
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: FakeRuntime(facade=facade))
        apply_config_overrides(monkeypatch, CONSOLE_API_URL="")
        app = Flask(__name__)

        with app.test_request_context():
            get = inspect.unwrap(console_resources.KnowledgeFSSpaceDocumentMultimodalManifestApi.get)
            response = get(
                console_resources.KnowledgeFSSpaceDocumentMultimodalManifestApi(),
                control_space_id="control-1",
                document_id=document_id,
            )

        item = response["items"][0]
        assert item["asset_url"] == (
            f"/console/api/knowledge-fs/spaces/control-1/documents/{document_id}/multimodal/figure%3A1/asset"
        )
        assert item["thumbnail_url"] == f"{item['asset_url']}?variant=thumbnail"
        assert item["parse_element_id"] == "parse-element-1"
        assert "objectKey" not in str(response)
        assert "sha256" not in str(response)
        assert facade.get_document_multimodal_manifest.calls == [
            invocation(
                tenant_id="tenant-1",
                account_id="account-1",
                control_space_id="control-1",
                document_id=document_id,
            )
        ]

    @staticmethod
    def test_document_multimodal_asset_console_bff_reauthorizes_and_streams_scoped_images(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        document_id = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44"
        object_key = (
            f"tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/documents/{document_id}/assets/figure-1-full.png"
        )
        manifest = _document_multimodal_manifest(object_key=object_key)
        facade = FakeComponent(get_document_multimodal_manifest=Recorder(manifest))
        object_storage = FakeComponent(
            head_object=Recorder(
                KnowledgeFSObjectMetadata(
                    checksum_sha256_base64="checksum",
                    content_type="image/png",
                    key=object_key,
                    metadata={},
                    size_bytes=4,
                )
            )
        )
        download_service = FakeComponent(load_stream=Recorder(iter((b"im", b"age"))))
        download_service_factory = Recorder(download_service)
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: FakeRuntime(facade=facade))
        monkeypatch.setattr(console_resources, "KnowledgeFSObjectStorageService", lambda: object_storage)
        monkeypatch.setattr(console_resources, "KnowledgeFSDownloadService", download_service_factory)
        app = Flask(__name__)

        with app.test_request_context():
            get = inspect.unwrap(console_resources.KnowledgeFSSpaceDocumentMultimodalAssetApi.get)
            response = get(
                console_resources.KnowledgeFSSpaceDocumentMultimodalAssetApi(),
                control_space_id="control-1",
                document_id=document_id,
                item_id="figure:1",
            )

        assert b"".join(response.response) == b"image"
        assert response.content_type == "image/png"
        assert response.headers["Content-Disposition"] == "inline"
        assert response.headers["Content-Security-Policy"] == "default-src 'none'; sandbox"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert object_storage.head_object.calls == [invocation(key=object_key)]
        assert download_service_factory.calls == [invocation(object_storage=object_storage)]
        assert len(download_service.load_stream.calls) == 1

    @staticmethod
    def test_document_multimodal_asset_console_bff_rejects_cross_document_object_keys(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        document_id = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44"
        manifest = _document_multimodal_manifest(
            object_key=(
                "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43/"
                "documents/018f0d60-7a49-7cc2-9c1b-5b36f18f2cff/assets/foreign.png"
            )
        )
        facade = FakeComponent(get_document_multimodal_manifest=Recorder(manifest))
        object_storage_factory = Recorder()
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: FakeRuntime(facade=facade))
        monkeypatch.setattr(console_resources, "KnowledgeFSObjectStorageService", object_storage_factory)
        app = Flask(__name__)
        get = inspect.unwrap(console_resources.KnowledgeFSSpaceDocumentMultimodalAssetApi.get)

        with app.test_request_context(), pytest.raises(NotFound):
            get(
                console_resources.KnowledgeFSSpaceDocumentMultimodalAssetApi(),
                control_space_id="control-1",
                document_id=document_id,
                item_id="figure:1",
            )

        assert object_storage_factory.calls == []

    @staticmethod
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

    @staticmethod
    def test_small_file_console_bff_reads_only_through_facade_and_returns_no_capability_material(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[dict[str, object]] = []

        class Facade:
            def upload_small_file(self, **kwargs: object) -> KnowledgeFSSmallFileUploadResponse:
                calls.append({name: value for name, value in kwargs.items() if name != "body_reader"})
                body_reader = kwargs["body_reader"]
                assert callable(body_reader)
                assert body_reader(8 * 1024 * 1024) == b"tiny"
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
        monkeypatch.setattr(console_resources, "_console_services", lambda: _FacadeRuntime(facade=Facade()))
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

    @staticmethod
    def test_document_upload_console_bff_reads_only_through_facade_and_returns_accepted_response(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[dict[str, object]] = []

        class Facade:
            def create_document(self, **kwargs: object) -> KnowledgeFSDocumentUploadAcceptedResponse:
                calls.append({name: value for name, value in kwargs.items() if name != "body_reader"})
                body_reader = kwargs["body_reader"]
                assert callable(body_reader)
                assert body_reader(15 * 1024 * 1024) == KnowledgeFSRemoteMultipartFile(
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
        monkeypatch.setattr(console_resources, "_console_services", lambda: _FacadeRuntime(facade=Facade()))
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

    @staticmethod
    def test_staged_document_claim_passes_only_upload_id_to_the_admission_service(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        staged_uploads = FakeComponent(
            claim=Recorder(
                KnowledgeFSDocumentStagedUploadAcceptedResponse(
                    upload_id="staged-1",
                    document_asset_id="asset-1",
                    compilation_job_id="job-1",
                )
            )
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
        assert len(staged_uploads.claim.calls) == 1
        claimed = narrowed(staged_uploads.claim.last_call.kwargs["payload"], KnowledgeFSDocumentStagedUploadPayload)
        assert claimed.upload_id == "staged-1"

    @staticmethod
    @pytest.mark.parametrize("file_size_limit_mb", [15, 50])
    def test_workspace_staging_upload_persists_before_space_creation(
        monkeypatch: pytest.MonkeyPatch,
        file_size_limit_mb: int,
    ) -> None:
        admission_events: list[str] = []

        class RecordingAdmission:
            active = False

            @contextmanager
            def admit(self, *, reserved_bytes: int) -> Generator[None]:
                admission_events.append(f"admit:{reserved_bytes}")
                self.active = True
                try:
                    yield
                finally:
                    self.active = False
                    admission_events.append("release")

        admission = RecordingAdmission()
        staged = KnowledgeFSStagedUploadResponse(
            id="staged-1",
            file_name="notes.md",
            content_type="text/markdown",
            size_bytes=7,
            status="uploaded",
            expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        )

        def stage(**_: object) -> KnowledgeFSStagedUploadResponse:
            assert admission.active
            admission_events.append("stage")
            return staged

        staged_uploads = FakeComponent(stage=Recorder(effect=stage))
        account = _knowledge_fs_product_controllers_account()
        monkeypatch.setattr(console_resources, "current_account_with_tenant", lambda: (account, "tenant-1"))
        monkeypatch.setattr(console_resources, "_staged_uploads", lambda: staged_uploads)
        monkeypatch.setattr(console_resources, "DEFAULT_KNOWLEDGE_FS_BUFFERED_UPLOAD_ADMISSION", admission)
        monkeypatch.setattr(
            console_resources.FeatureService,
            "get_knowledge_file_size_limit",
            lambda _tenant_id: file_size_limit_mb,
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
        assert admission_events == [f"admit:{file_size_limit_mb * 1024 * 1024}", "stage", "release"]
        assert staged_uploads.stage.calls == [
            invocation(
                tenant_id="tenant-1",
                account=account,
                file_name="notes.md",
                content_type="text/markdown",
                body=b"# Notes",
                file_size_limit_mb=file_size_limit_mb,
            )
        ]

    @staticmethod
    def test_workspace_staging_zero_byte_plan_limit_returns_request_too_large_before_admission(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class FailingAdmission:
            def admit(self, *, reserved_bytes: int) -> Never:
                _ = reserved_bytes
                raise AssertionError("a disabled upload limit must fail before admission")

        staged_uploads = FakeComponent(stage=Recorder())
        account = _knowledge_fs_product_controllers_account()
        monkeypatch.setattr(console_resources, "current_account_with_tenant", lambda: (account, "tenant-1"))
        monkeypatch.setattr(console_resources, "_staged_uploads", lambda: staged_uploads)
        monkeypatch.setattr(console_resources, "DEFAULT_KNOWLEDGE_FS_BUFFERED_UPLOAD_ADMISSION", FailingAdmission())
        monkeypatch.setattr(
            console_resources.FeatureService,
            "get_knowledge_file_size_limit",
            lambda _tenant_id: 0,
        )
        app = Flask(__name__)

        with app.test_request_context(
            method="POST",
            data={"file": (BytesIO(b"# Notes"), "notes.md", "text/markdown")},
            content_type="multipart/form-data",
        ):
            post = inspect.unwrap(console_resources.KnowledgeFSStagedUploadsApi.post)
            with pytest.raises(KnowledgeFSProductRequestRejectedError) as rejected:
                post(console_resources.KnowledgeFSStagedUploadsApi())

        assert rejected.value.status_code == 413
        assert staged_uploads.stage.calls == []

    @staticmethod
    def test_logical_document_delete_accepts_initial_row_version(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[dict[str, object]] = []

        class Facade:
            def delete_logical_document(self, **kwargs: object) -> KnowledgeFSDurableDeletionAcceptedResponse:
                calls.append(kwargs)
                payload = kwargs["payload"]
                assert isinstance(payload, KnowledgeFSLogicalDocumentDeletePayload)
                assert payload.expected_revision == 0
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
        monkeypatch.setattr(console_resources, "_console_services", lambda: _FacadeRuntime(facade=Facade()))
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

    @staticmethod
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
        def reject() -> Never:
            raise KnowledgeFSProductRequestRejectedError(status_code=413)

        with pytest.raises(KnowledgeFSRequestTooLargeHTTPError):
            reject()

    @staticmethod
    def test_console_knowledge_rate_limit_covers_every_write_download_and_retrieval_entrypoint() -> None:
        """Mirror the legacy dataset console: every mutating, download, or retrieval route is rate limited.

        Pure reads stay unlimited. The exemptions are workspace-level source previews (like legacy
        data source browsing), a staged-upload discard, the deprecated buffered query route that
        fails closed anyway, and the internal capability-token stream transport.
        """
        space = "/knowledge-fs/spaces/<string:control_space_id>"
        exempt_writes = {
            ("post", "/knowledge-fs/source-provider-preview"),
            ("post", "/knowledge-fs/source-provider-preview/jobs"),
            ("delete", "/knowledge-fs/source-provider-preview/jobs/<string:job_id>"),
            ("delete", "/knowledge-fs/uploads/<string:upload_id>"),
            ("post", f"{space}/queries"),
            ("post", "_QUERY_STREAM_PROXY_PATH"),
        }
        rate_limited_reads = {("get", f"{space}/logical-documents/<string:document_id>/download")}
        tree = ast.parse(
            Path(console_resources.__file__).read_text(encoding="utf-8"),
            filename=console_resources.__file__,
        )
        seen: set[tuple[str, str]] = set()

        for class_node in (node for node in tree.body if isinstance(node, ast.ClassDef)):
            routes = [
                ast.unparse(decorator.args[0]).strip("'\"")
                for decorator in class_node.decorator_list
                if isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and decorator.func.attr == "route"
            ]
            if not routes:
                continue
            for method_node in (
                node
                for node in class_node.body
                if isinstance(node, ast.FunctionDef) and node.name in {"delete", "get", "patch", "post", "put"}
            ):
                key = (method_node.name, routes[0])
                seen.add(key)
                rate_limited = any(
                    isinstance(decorator, ast.Call)
                    and isinstance(decorator.func, ast.Name)
                    and decorator.func.id == "cloud_edition_billing_rate_limit_check"
                    and len(decorator.args) == 1
                    and isinstance(decorator.args[0], ast.Constant)
                    and decorator.args[0].value == "knowledge"
                    for decorator in method_node.decorator_list
                )
                expected = key in rate_limited_reads if method_node.name == "get" else key not in exempt_writes
                assert rate_limited == expected, f"{key} rate limited={rate_limited}, expected {expected}"

        assert exempt_writes <= seen
        assert rate_limited_reads <= seen

    @staticmethod
    def test_space_update_and_delete_publish_their_actual_http_status_contracts() -> None:
        patch_responses = console_resources.KnowledgeFSSpaceApi.patch.__apidoc__["responses"]
        delete_responses = console_resources.KnowledgeFSSpaceApi.delete.__apidoc__["responses"]

        assert set(patch_responses) == {"200"}
        assert set(delete_responses) == {"204"}

    @staticmethod
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

        assert payload.embedding is not None
        assert payload.embedding is not None
        assert payload.embedding.model_dump(mode="json", by_alias=True) == {
            "pluginId": "langgenius/openai",
            "provider": "openai",
            "model": "text-embedding-3-small",
        }
        assert payload.retrieval is not None
        assert payload.retrieval is not None
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

        with pytest.raises(ValueError, match="retrieval.defaultMode"):
            KnowledgeFSSpaceCreatePayload.model_validate(
                {
                    "name": "Invalid preset",
                    "slug": "invalid-preset",
                    "embedding": {"pluginId": "plugin", "provider": "provider", "model": "embedding"},
                    "retrieval": {
                        "defaultMode": "auto",
                        "reasoningModel": {"pluginId": "plugin", "provider": "provider", "model": "reasoning"},
                        "rerank": {
                            "enabled": True,
                            "model": {"pluginId": "plugin", "provider": "provider", "model": "rerank"},
                        },
                        "scoreThreshold": {"enabled": False, "stage": "mode-final"},
                        "topK": 10,
                    },
                }
            )

    @staticmethod
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
                        "rerank": {
                            "enabled": True,
                            "model": {"pluginId": "plugin", "provider": "provider", "model": "rerank"},
                        },
                        "scoreThreshold": {"enabled": False, "stage": "mode-final"},
                        "topK": 10,
                    },
                }
            )

    @staticmethod
    def test_jwks_http_resource_returns_only_public_keys(monkeypatch: pytest.MonkeyPatch) -> None:
        public_jwks = {
            "keys": [
                {"alg": "RS256", "e": "AQAB", "kid": "current", "kty": "RSA", "n": "modulus-1", "use": "sig"},
                {"alg": "RS256", "e": "AQAB", "kid": "previous", "kty": "RSA", "n": "modulus-2", "use": "sig"},
            ]
        }
        issuer = FakeComponent(public_jwks=Recorder(public_jwks))
        apply_config_overrides(
            monkeypatch,
            KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=True,
            KNOWLEDGE_FS_JWKS_CACHE_MAX_AGE_SECONDS=123,
        )
        monkeypatch.setattr(console_resources.session_factory, "get_session_maker", lambda: object())
        monkeypatch.setattr(console_resources, "create_configured_knowledge_fs_capability_issuer", lambda **_: issuer)
        app = Flask(__name__)

        with app.app_context():
            response = console_resources.KnowledgeFSJWKSApi().get()

        payload = response.get_json()
        assert payload == public_jwks
        assert response.headers["Cache-Control"] == "public, max-age=123, must-revalidate"
        assert not {"d", "p", "q", "dp", "dq", "qi"} & set().union(*(key.keys() for key in payload["keys"]))

    @staticmethod
    def test_service_profile_authorizes_the_dataset_key_for_the_route_space(monkeypatch: pytest.MonkeyPatch) -> None:
        profile = KnowledgeFSServiceApiProfile(
            tenant_id="tenant-1",
            control_space_id="control-2",
            api_token_id="token-1",
            principal_id="token-1",
            knowledge_space_id="space-1",
            knowledge_space_revision=1,
            membership_epoch=0,
            space_acl_epoch=0,
            external_access_epoch=0,
            content_policy_revision=0,
        )
        authorization = FakeComponent(authorize=Recorder(profile))
        runtime = FakeRuntime(service_api_authorization=authorization)
        monkeypatch.setattr(service_resources, "validate_and_get_api_token", Recorder(_dataset_api_token()))
        app = Flask(__name__)
        with app.test_request_context(headers={"Authorization": "Bearer dataset-test-key"}):
            result = service_resources._profile(
                runtime,  # type: ignore[arg-type]
                operation_id="listDocuments",
                control_space_id="control-2",
            )

        assert result is profile
        assert authorization.authorize.calls == [
            invocation(
                api_token_id="token-1",
                tenant_id="tenant-1",
                control_space_id="control-2",
            )
        ]

    @staticmethod
    def test_service_profile_applies_the_knowledge_rate_limit_before_authorizing(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Every KnowledgeFS service route shares the legacy dataset service API rate limit."""
        authorization = FakeComponent(authorize=Recorder())
        runtime = FakeRuntime(service_api_authorization=authorization)
        api_token = _dataset_api_token()
        monkeypatch.setattr(service_resources, "validate_and_get_api_token", Recorder(api_token))
        rate_limit = Recorder(raises=Forbidden("rate limited"))
        monkeypatch.setattr(service_resources, "check_knowledge_rate_limit", rate_limit)

        with pytest.raises(Forbidden, match="rate limited"):
            service_resources._profile(
                runtime,  # type: ignore[arg-type]
                operation_id="listDocuments",
                control_space_id="control-2",
            )

        assert rate_limit.calls == [invocation(api_token)]
        assert authorization.authorize.calls == []

    @staticmethod
    def test_service_profile_rejects_a_dataset_key_without_a_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
        authorization = FakeComponent(authorize=Recorder())
        runtime = FakeRuntime(service_api_authorization=authorization)
        monkeypatch.setattr(
            service_resources, "validate_and_get_api_token", Recorder(_dataset_api_token(tenant_id=None))
        )

        with pytest.raises(KnowledgeFSServiceApiAuthorizationError, match="not workspace-scoped"):
            service_resources._profile(
                runtime,  # type: ignore[arg-type]
                operation_id="listDocuments",
                control_space_id="control-2",
            )

        assert authorization.authorize.calls == []

    @staticmethod
    def test_product_modules_do_not_import_dify_dataset_or_document_services() -> None:
        paths = [
            *(path for path in _API_ROOT.glob("services/knowledge_fs/*.py") if not path.name.startswith("upgrade_")),
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
            imported_modules = set()
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom) or node.module is None:
                    continue
                # Native vector credentials share the legacy models.dataset module.
                # This bridge may read the tenant binding, never Dataset/Document data.
                if (
                    path == _API_ROOT / "services/knowledge_fs/vector_store.py"
                    and node.module == "models.dataset"
                    and {alias.name for alias in node.names} == {"TidbAuthBinding"}
                ):
                    continue
                imported_modules.add(node.module)
            assert not any(
                module == forbidden or module.startswith(f"{forbidden}.")
                for module in imported_modules
                for forbidden in forbidden_modules
            ), path

    @staticmethod
    def test_research_task_stream_url_binds_task_and_parent_space_without_token(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        apply_config_overrides(monkeypatch, CONSOLE_API_URL="https://dify.test")
        url = console_resources._research_task_events_url(
            task_id="task/one",
            knowledge_space_id="space one",
        )

        assert (
            url
            == "https://dify.test/console/api/knowledge-fs/research-tasks/task%2Fone/events?knowledgeSpaceId=space+one"
        )
        assert "token" not in url.lower()

    @staticmethod
    def test_query_stream_capability_issues_exact_space_grant_without_token_in_url(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[dict[str, object]] = []

        class Broker:
            def issue_interactive(self, **kwargs: object) -> KnowledgeFSIssuedProductCapability:
                calls.append(kwargs)
                return _issued_capability(token="query-capability", operation_id="createQuery")

        apply_config_overrides(monkeypatch, CONSOLE_API_URL="https://dify.test")
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(
            console_resources,
            "_console_services",
            lambda: _BrokerRuntime(broker=Broker()),
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

    @staticmethod
    def test_query_admission_binds_validated_mode_to_resolved_kfs_space(monkeypatch: pytest.MonkeyPatch) -> None:
        calls: list[dict[str, object]] = []

        class Broker:
            def issue_interactive(self, **kwargs: object) -> KnowledgeFSIssuedProductCapability:
                calls.append(kwargs)
                return _issued_capability(token="query-capability", operation_id="createQuery")

        apply_config_overrides(monkeypatch, CONSOLE_API_URL="https://dify.test")
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(
            console_resources,
            "_console_services",
            lambda: _BrokerRuntime(broker=Broker()),
        )
        app = Flask(__name__)

        with app.test_request_context(json={"query": "What changed?", "mode": "auto"}):
            post = inspect.unwrap(console_resources.KnowledgeFSSpaceQueryAdmissionApi.post)
            response = post(console_resources.KnowledgeFSSpaceQueryAdmissionApi(), "control-1")

        assert response["operation_id"] == "createQuery"
        assert response["trace_id"] == "trace-1"
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

    @staticmethod
    def test_console_query_stream_proxy_forwards_only_the_admitted_capability(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        closed: list[str] = []

        def close() -> None:
            closed.append("closed")

        facade = FakeComponent(
            stream_query=Recorder(
                KnowledgeFSRemoteSSEResponse(
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
        monkeypatch.setattr(console_resources, "_console_services", lambda: FakeRuntime(facade=facade))
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
        assert closed == ["closed"]
        call = facade.stream_query.last_call.kwargs
        assert call["capability_token"] == "capability-token"
        assert call["trace_id"] == "trace-1"
        assert narrowed(call["payload"], KnowledgeFSAdmittedQueryRequest).knowledge_space_id == "space-1"
        assert set(call) == {"capability_token", "trace_id", "payload"}

    @staticmethod
    def test_service_query_stream_proxy_forwards_only_the_admitted_capability(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        closed: list[str] = []

        def close() -> None:
            closed.append("closed")

        facade = FakeComponent(
            stream_query=Recorder(
                KnowledgeFSRemoteSSEResponse(
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
        monkeypatch.setattr(service_resources, "_runtime", lambda: FakeRuntime(facade=facade))
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
        assert closed == ["closed"]
        call = facade.stream_query.last_call.kwargs
        assert call["capability_token"] == "capability-token"
        assert call["trace_id"] == "trace-1"
        assert narrowed(call["payload"], KnowledgeFSAdmittedQueryRequest).knowledge_space_id == "space-1"
        assert set(call) == {"capability_token", "trace_id", "payload"}

    @staticmethod
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

    @staticmethod
    def test_task_stream_capability_uses_broker(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        calls: list[dict[str, object]] = []

        class Broker:
            def issue_interactive(self, **kwargs: object) -> KnowledgeFSIssuedProductCapability:
                calls.append(kwargs)
                return _issued_capability(token="direct-capability", operation_id="streamResearchTask")

        runtime = _BrokerRuntime(broker=Broker())
        apply_config_overrides(monkeypatch, CONSOLE_API_URL="https://dify.test")
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

    @staticmethod
    def test_service_query_admission_uses_broker(monkeypatch: pytest.MonkeyPatch) -> None:
        calls: list[dict[str, object]] = []
        profile = _service_profile("control-1")
        authorization = FakeComponent(authorize=Recorder(profile))

        class Broker:
            def issue_service(self, **kwargs: object) -> KnowledgeFSIssuedProductCapability:
                calls.append(kwargs)
                return _issued_capability(token="service-capability", operation_id="createQuery")

        @dataclass(frozen=True)
        class ServiceRuntime:
            service_api_authorization: FakeComponent
            broker: Broker

        runtime = ServiceRuntime(service_api_authorization=authorization, broker=Broker())
        monkeypatch.setattr(service_resources, "validate_and_get_api_token", Recorder(_dataset_api_token()))
        apply_config_overrides(monkeypatch, SERVICE_API_URL="https://api.dify.test")
        monkeypatch.setattr(service_resources, "_runtime", lambda: runtime)
        app = Flask(__name__)

        with app.test_request_context(
            json={"query": "What changed?", "mode": "fast"},
            headers={"Authorization": "Bearer dataset-test-key"},
        ):
            post = inspect.unwrap(service_resources.KnowledgeFSServiceQueryAdmissionApi.post)
            response = post(service_resources.KnowledgeFSServiceQueryAdmissionApi(), "control-1")

        assert response["operation_id"] == "createQuery"
        assert response["trace_id"] == "trace-1"
        assert response["request"]["knowledgeSpaceId"] == "space-1"
        assert response["url"] == "https://api.dify.test/v1/knowledge-fs/query-stream"
        assert authorization.authorize.calls == [
            invocation(
                api_token_id="token-1",
                tenant_id="tenant-1",
                control_space_id="control-1",
            )
        ]
        assert calls == [{"profile": profile, "operation_id": "createQuery"}]

    @staticmethod
    @pytest.mark.parametrize(
        ("raised", "expected"),
        [
            # An unknown or wrong-kind key is an invalid credential (401).
            (
                KnowledgeFSServiceApiAuthorizationError("bad key"),
                service_resources.KnowledgeFSInvalidCredentialHTTPError,
            ),
            # A real key bound to other knowledge bases is out of scope for this space (403).
            (
                KnowledgeFSServiceApiScopeError("out of scope"),
                service_resources.KnowledgeFSServiceAccessDeniedHTTPError,
            ),
        ],
    )
    def test_service_api_errors_distinguish_unknown_key_from_out_of_scope_key(
        raised: Exception,
        expected: type[Exception],
    ) -> None:
        @service_resources._service_api_errors
        def view() -> None:
            raise raised

        with pytest.raises(expected):
            view()

    @staticmethod
    def test_space_create_member_schema_requires_viewer_role() -> None:
        payload_schema = console_ns.models["KnowledgeFSSpaceCreatePayload"].__schema__
        member_schema = console_ns.models["KnowledgeFSSpaceCreateMemberPayload"].__schema__

        assert payload_schema["properties"]["members"]["maxItems"] == 1_000
        assert member_schema["properties"]["role"]["const"] == "viewer"
        assert set(member_schema["required"]) == {"account_id", "role"}
        assert member_schema["additionalProperties"] is False

    @staticmethod
    def test_space_create_initial_access_idempotency_conflict_returns_409() -> None:
        @console_resources._knowledge_fs_errors
        def conflicting_creation() -> None:
            raise KnowledgeFSControlSpaceIntentConflictError("different initial access")

        with pytest.raises(KnowledgeFSConflictHTTPError) as exc:
            conflicting_creation()

        assert exc.value.code == 409


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


def sync_policy_response(revision: int) -> KnowledgeFSSourceSyncPolicyResponse:
    return KnowledgeFSSourceSyncPolicyResponse.model_validate(
        {
            "created_at": datetime(2026, 1, 1, tzinfo=UTC),
            "enabled": True,
            "expected_source_version": 1,
            "id": "policy-1",
            "knowledge_space_id": "space-1",
            "mode": "interval",
            "revision": revision,
            "source_id": "source-1",
            "updated_at": datetime(2026, 1, 1, tzinfo=UTC),
        }
    )


def issued_capability() -> KnowledgeFSIssuedProductCapability:
    return KnowledgeFSIssuedProductCapability(
        token="capability-token",
        expires_at=datetime(2026, 7, 21, tzinfo=UTC),
        operation_id="createQuery",
        knowledge_space_id="knowledge-space-1",
        knowledge_space_revision=1,
        trace_id="trace-1",
    )


def _knowledge_fs_resource_delegation_account(account_id: str) -> Account:
    account = Account(name="Test User", email="user@example.com")
    account.id = account_id
    return account


@dataclass(frozen=True)
class _SettingsUpdateResult:
    """The only field the settings route reads before dumping the facade result."""

    migration: None = None


@dataclass(frozen=True)
class _MembersPayload:
    members: tuple[str, ...]
    query_images: list[str] = field(default_factory=list)


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
        (
            RequestContext(
                request_id="request-1", trace_id=None, account_id="account-1", active_workspace_id="tenant-1"
            ),
        ),
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
        "previewSourceCrawl",
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
        "importSourceWorkflow",
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
        "importSourceWorkflow",
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


class TestKnowledgeFsResourceDelegationCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def _enabled_knowledge_fs(config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, KNOWLEDGE_FS_ENABLED=True)

    @staticmethod
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
            else _MembersPayload(members=("member-1",))
        )
        delegate = Recorder(_RAW_RESULT)
        components = {name: FakeComponent() for name in ("application", "control_plane", "app_bindings", "facade")}
        components[component_name] = FakeComponent(**{delegate_name: delegate})
        runtime = FakeRuntime(
            application=components["application"],
            control_plane=components["control_plane"],
            app_bindings=components["app_bindings"],
            facade=components["facade"],
        )
        dump_response = Recorder(effect=lambda schema, raw: (schema.__name__, raw))
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
        monkeypatch.setattr(console_resources, "_payload", lambda _: payload)
        monkeypatch.setattr(console_resources, "_idempotency_key", lambda: "idempotency-1")
        monkeypatch.setattr(console_resources, "_query_pairs", lambda _: (("normalized", "true"),))
        monkeypatch.setattr(console_resources, "dump_response", dump_response)
        app = Flask(__name__)

        with app.test_request_context("/", method="POST"):
            result = _invoke(class_name, method_name, *route_args)

        assert len(delegate.calls) == 1
        call_fields = delegate.last_call.kwargs
        assert call_fields["tenant_id"] == "tenant-1"
        assert call_fields.get("account_id", call_fields.get("actor_account_id")) == "account-1"
        for field_name, expected in expected_fields.items():
            assert call_fields[field_name] == expected
        if "payload" in call_fields:
            if class_name.__name__ == "KnowledgeFSSpaceSourceApi" and method_name.__name__ == "patch":
                forwarded = narrowed(call_fields["payload"], BaseModel)
                source_update = narrowed(payload, KnowledgeFSSourceUpdatePayload)
                assert forwarded.model_dump(exclude_none=True) == source_update.model_dump(exclude_none=True)
            else:
                assert call_fields["payload"] is payload
        if "members" in call_fields:
            assert call_fields["members"] == ("member-1",)
        if "idempotency_key" in call_fields:
            assert call_fields["idempotency_key"] == "idempotency-1"
        if dump_response.calls:
            assert dump_response.last_call.args[1] is _RAW_RESULT
        else:
            assert result == ("", HTTPStatus.NO_CONTENT)

    @staticmethod
    def test_console_document_reference_delegates_exact_asset_identity(monkeypatch: pytest.MonkeyPatch) -> None:
        facade = FakeComponent(resolve_document_reference=Recorder(_RAW_RESULT))
        runtime = FakeRuntime(facade=facade)
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
        assert facade.resolve_document_reference.calls == [
            invocation(
                tenant_id="tenant-1",
                account_id="account-1",
                control_space_id="space-1",
                document_asset_id="asset-1",
                document_asset_version=7,
            )
        ]

    @staticmethod
    def test_console_space_list_preserves_repeated_creator_filters(monkeypatch: pytest.MonkeyPatch) -> None:
        application = FakeComponent(list_spaces=Recorder(_RAW_RESULT))
        runtime = FakeRuntime(application=application)
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
        monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
        app = Flask(__name__)

        with app.test_request_context(
            "/?page=2&limit=10&creator_ids=creator-1&creator_ids=creator-2&tag_ids=tag-1&tag_ids=tag-2&query=%20Support%20"
        ):
            result = _invoke(console_resources.KnowledgeFSSpacesApi, console_resources.KnowledgeFSSpacesApi.get)

        assert application.list_spaces.calls == [
            invocation(
                tenant_id="tenant-1",
                account_id="account-1",
                page=2,
                limit=10,
                creator_ids=["creator-1", "creator-2"],
                tag_ids=["tag-1", "tag-2"],
                query="Support",
            )
        ]
        assert result is _RAW_RESULT

    @staticmethod
    def test_console_source_update_does_not_start_sync_before_resource_selection(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        facade = FakeComponent(update_source=Recorder(_RAW_RESULT))
        runtime = FakeRuntime(facade=facade)
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

        forwarded = narrowed(facade.update_source.last_call.kwargs["payload"], KnowledgeFSAtomicSourceUpdatePayload)
        assert forwarded is not payload
        assert forwarded.status == "disabled"
        assert forwarded.sync_after_update is None
        assert result is _RAW_RESULT

    @staticmethod
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
        selection_kind = selection["kind"]
        assert isinstance(selection_kind, str)
        provider_kind = {"online_document": "online-document", "online_drive": "online-drive"}.get(selection_kind)
        original = source_response(
            metadata={"providerKind": provider_kind} if provider_kind is not None else {},
            type="web" if selection_kind == "website_crawl" else "connector",
            uri="https://old.example.com",
        )
        updated = source_response(sync_workflow=None)
        facade = FakeComponent(
            get_source=Recorder(results=[original, updated]),
            update_source=Recorder(source_response(version=4)),
        )
        workflow = KnowledgeFSSourceWorkflowResponse.model_validate(
            {
                "checkpoint": "queued",
                "created_at": datetime(2026, 1, 1, tzinfo=UTC),
                "execution_attempts": 0,
                "id": "workflow-1",
                "knowledge_space_id": "space-1",
                "kind": "source-import",
                "max_execution_attempts": 3,
                "progress_completed": 0,
                "progress_failed": 0,
                "progress_skipped": 0,
                "state": "queued",
                "updated_at": datetime(2026, 1, 1, tzinfo=UTC),
            }
        )
        runtime = FakeRuntime(facade=facade)
        payload = KnowledgeFSSourceUpdatePayload.model_validate(
            {
                "expectedVersion": 3,
                "name": "Edited source",
                "selection": selection,
                "syncPolicy": {"enabled": True, "mode": "interval"},
            }
        )
        commit = Recorder(workflow)
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
        monkeypatch.setattr(console_resources, "_payload", lambda _: payload)
        monkeypatch.setattr(source_edit_service, "commit_source_import", commit)
        monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
        app = Flask(__name__)

        with app.test_request_context("/", method="PATCH"):
            result = _invoke(
                console_resources.KnowledgeFSSpaceSourceApi,
                console_resources.KnowledgeFSSpaceSourceApi.patch,
                "space-1",
                "source-1",
            )

        assert facade.update_source.calls == []
        source_payload = narrowed(commit.last_call.kwargs["source_update"], KnowledgeFSSourceImportConfigurationPayload)
        assert source_payload.status == "disabled"
        import_payload = narrowed(commit.last_call.kwargs["payload"], BaseModel)
        assert import_payload.model_dump()["kind"] == expected_import_kind
        assert commit.last_call.kwargs["idempotency_key"] == "source-edit:source-1:3"
        assert updated.sync_workflow is workflow
        assert result is updated

    @staticmethod
    def test_console_source_update_does_not_import_an_unchanged_complete_selection(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        source = source_response(
            metadata={"crawled": {"https://example.com/a": {}}},
            sync_policy=None,
            type="web",
            uri="https://example.com",
            version=3,
        )
        facade = FakeComponent(
            get_source=Recorder(source),
            get_source_sync_policy=Recorder(sync_policy_response(revision=2)),
            update_source=Recorder(source),
            update_source_sync_policy=Recorder(),
        )
        runtime = FakeRuntime(facade=facade)
        payload = KnowledgeFSSourceUpdatePayload.model_validate(
            {
                "selection": {"kind": "website_crawl", "sourceUrls": ["https://example.com/a"]},
                "syncPolicy": {"enabled": True, "mode": "interval"},
            }
        )
        commit = Recorder()
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
        monkeypatch.setattr(console_resources, "_payload", lambda _: payload)
        monkeypatch.setattr(source_edit_service, "commit_source_import", commit)
        monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
        app = Flask(__name__)

        with app.test_request_context("/", method="PATCH"):
            result = _invoke(
                console_resources.KnowledgeFSSpaceSourceApi,
                console_resources.KnowledgeFSSpaceSourceApi.patch,
                "space-1",
                "source-1",
            )

        assert len(facade.update_source.calls) == 1
        assert commit.calls == []
        assert facade.update_source_sync_policy.calls == []
        command = narrowed(facade.update_source.last_call.kwargs["payload"], KnowledgeFSAtomicSourceUpdatePayload)
        assert command.expected_version == 3
        assert command.expected_policy_revision == 2
        assert command.sync_policy is not None
        assert command.sync_policy.mode == "interval"
        assert result is source

    @staticmethod
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

        assert source_edit_service.source_edit_requires_import(source, payload) is True

    @staticmethod
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

        assert source_edit_service.source_edit_requires_import(source, payload) is False

    @staticmethod
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

        assert source_edit_service.source_edit_requires_import(source, unchanged) is False
        assert source_edit_service.source_edit_requires_import(source, changed) is True

    @staticmethod
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

        assert source_edit_service.source_edit_requires_import(source, payload) is True

    @staticmethod
    def test_console_source_update_applies_policy_without_creating_import_work(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        source = source_response(version=5, sync_policy=None)
        policy = sync_policy_response(revision=3)
        source.sync_policy = policy
        facade = FakeComponent(
            get_source=Recorder(source),
            get_source_sync_policy=Recorder(sync_policy_response(revision=2)),
            update_source=Recorder(source),
            update_source_sync_policy=Recorder(),
        )
        runtime = FakeRuntime(facade=facade)
        payload = KnowledgeFSSourceUpdatePayload.model_validate(
            {"syncPolicy": {"customIntervalSeconds": 7200, "enabled": True, "mode": "custom"}}
        )
        commit = Recorder()
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(console_resources, "_console_services", lambda: runtime)
        monkeypatch.setattr(console_resources, "_payload", lambda _: payload)
        monkeypatch.setattr(source_edit_service, "commit_source_import", commit)
        monkeypatch.setattr(console_resources, "dump_response", lambda _schema, raw: raw)
        app = Flask(__name__)

        with app.test_request_context("/", method="PATCH"):
            result = _invoke(
                console_resources.KnowledgeFSSpaceSourceApi,
                console_resources.KnowledgeFSSpaceSourceApi.patch,
                "space-1",
                "source-1",
            )

        assert len(facade.update_source.calls) == 1
        assert commit.calls == []
        assert facade.update_source_sync_policy.calls == []
        policy_payload = narrowed(
            facade.update_source.last_call.kwargs["payload"], KnowledgeFSAtomicSourceUpdatePayload
        )
        assert policy_payload.expected_policy_revision == 2
        assert policy_payload.expected_version == 5
        assert policy_payload.sync_policy is not None
        assert policy_payload.sync_policy.custom_interval_seconds == 7200
        assert source.sync_policy is policy
        assert result is source

    @staticmethod
    def test_console_metadata_delete_forwards_row_version_cas(monkeypatch: pytest.MonkeyPatch) -> None:
        facade = FakeComponent(delete_metadata_field=Recorder(_RAW_RESULT))
        runtime = FakeRuntime(facade=facade)
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

        assert facade.delete_metadata_field.calls == [
            invocation(
                tenant_id="tenant-1",
                account_id="account-1",
                control_space_id="space-1",
                field_id="field-1",
                expected_row_version=7,
            )
        ]
        assert result is _RAW_RESULT

    @staticmethod
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
        runtime = FakeRuntime(
            facade=FakeComponent(
                get_overview_query_outcomes=Recorder(outcomes),
                get_overview_stats=Recorder(stats),
            ),
            app_bindings=FakeComponent(count_active=Recorder(7)),
        )
        dump_response = Recorder(effect=lambda _schema, raw: raw)
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

        assert runtime.facade.get_overview_stats.calls == [
            invocation(
                tenant_id="tenant-1",
                account_id="account-1",
                control_space_id="control-space-1",
            )
        ]
        assert runtime.facade.get_overview_query_outcomes.calls == [
            invocation(
                tenant_id="tenant-1",
                account_id="account-1",
                control_space_id="control-space-1",
                window="7d",
            )
        ]
        assert runtime.app_bindings.count_active.calls == [
            invocation(
                tenant_id="tenant-1",
                actor_account_id="account-1",
                control_space_id="control-space-1",
            )
        ]
        assert result.documents == 13
        assert result.linked_apps == 7
        assert result.queries.value == 120
        assert result.queries.previous_value == 100
        assert result.queries.change_rate == pytest.approx(0.2)
        assert result.answer_rate.value == pytest.approx(0.8)
        assert result.answer_rate.change_percentage_points == pytest.approx(-5)
        assert result.freshness_seconds == 3600
        assert result.generated_at == outcomes.generated_at
        assert dump_response.last_call.args[1] is result

    @staticmethod
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
        execute = Recorder(_RAW_RESULT)
        dump_response = Recorder(effect=lambda schema, raw: (schema.__name__, raw))
        monkeypatch.setattr(service_resources, "_execute_service_operation", execute)
        monkeypatch.setattr(service_resources, "_payload", lambda _: payload)
        monkeypatch.setattr(service_resources, "_idempotency_key", lambda: "idempotency-1")
        monkeypatch.setattr(service_resources, "_query_pairs", lambda _: (("normalized", "true"),))
        monkeypatch.setattr(service_resources, "dump_response", dump_response)
        monkeypatch.setattr(service_resources, "durable_page_import", lambda value: value)
        monkeypatch.setattr(service_resources, "durable_file_import", lambda value: value)
        monkeypatch.setattr(
            service_resources,
            "_deletion_accepted",
            lambda _space, raw: dump_response(service_resources.KnowledgeFSDurableDeletionAcceptedResponse, raw),
        )
        monkeypatch.setattr(
            service_resources,
            "_bulk_deletion_accepted",
            lambda _space, raw: dump_response(service_resources.KnowledgeFSDurableDeletionAcceptedResponse, raw),
        )
        app = Flask(__name__)

        with app.test_request_context("/", method="POST", headers={"Idempotency-Key": "idempotency-1"}):
            _invoke(class_name, method_name, *route_args)

        assert len(execute.calls) == 1
        call_fields = execute.last_call.kwargs
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
        assert dump_response.last_call.args[1] is _RAW_RESULT

    @staticmethod
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
        facade = FakeComponent(
            execute_service=Recorder(_RAW_RESULT),
            update_service_settings=Recorder(_SettingsUpdateResult()),
        )
        runtime = FakeRuntime(facade=facade)
        profile = object()
        validate_profile = Recorder(profile)
        monkeypatch.setattr(service_resources, "_runtime", lambda: runtime)
        monkeypatch.setattr(service_resources, "_profile", validate_profile)
        monkeypatch.setattr(service_resources, "_payload", lambda _: object())
        monkeypatch.setattr(service_resources, "dump_response", lambda schema, raw: (schema.__name__, raw))
        app = Flask(__name__)
        query_string = {"cursor": cursor} if cursor is not None else None

        with app.test_request_context("/", method="POST", query_string=query_string):
            _invoke(class_name, method_name, "space-1")

        assert validate_profile.calls == [invocation(runtime, operation_id=operation_id, control_space_id="space-1")]
        if operation_id == "updateSettings":
            assert facade.update_service_settings.last_call.kwargs["profile"] is profile
            assert facade.execute_service.calls == []
            return
        assert facade.execute_service.last_call.kwargs["profile"] is profile
        assert facade.execute_service.last_call.kwargs["operation_id"] == operation_id
        if "query" in facade.execute_service.last_call.kwargs:
            expected_query = (("limit", "50"),) + ((("cursor", cursor),) if cursor else ())
            assert facade.execute_service.last_call.kwargs["query"] == expected_query

    @staticmethod
    @pytest.mark.parametrize(
        "class_name",
        [
            console_resources.KnowledgeFSSpaceQueriesApi,
        ],
    )
    def test_deprecated_buffered_routes_fail_closed(
        class_name: type[console_resources.KnowledgeFSSpaceQueriesApi],
    ) -> None:
        with pytest.raises(KnowledgeFSOperationUnavailableError, match="deprecated"):
            _invoke(class_name, class_name.post, "space-1")

    @staticmethod
    def test_console_stream_capabilities_bind_the_authorized_resource(monkeypatch: pytest.MonkeyPatch) -> None:
        broker = FakeComponent(issue_interactive=Recorder(issued_capability()))
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
            lambda: FakeRuntime(broker=broker),
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
        assert broker.issue_interactive.calls[0].kwargs["operation_id"] == "createQuery"
        assert broker.issue_interactive.calls[1].kwargs == {
            "tenant_id": "tenant-1",
            "account_id": "account-1",
            "control_space_id": "space-2",
            "operation_id": "streamResearchTask",
            "resource_id": "task/1",
        }
        assert broker.issue_interactive.calls[2].kwargs["operation_id"] == "createQuery"

    @staticmethod
    def test_service_query_admission_binds_profile_space_and_payload(monkeypatch: pytest.MonkeyPatch) -> None:
        broker = FakeComponent(issue_service=Recorder(issued_capability()))
        runtime = FakeRuntime(broker=broker)
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

        assert broker.issue_service.calls == [invocation(profile=profile, operation_id="createQuery")]
        assert response.request.knowledge_space_id == "knowledge-space-1"
        assert response.request.query == "question"
        assert response.url == "https://api.dify.example/v1/knowledge-fs/query-stream"

    @staticmethod
    def test_console_resource_helpers_validate_feature_payload_headers_and_query_pairs(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        runtime = FakeRuntime()
        session_maker = object()
        get_runtime = Recorder(runtime)
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, KNOWLEDGE_FS_ENABLED=True)
        monkeypatch.setattr(console_resources.session_factory, "get_session_maker", lambda: session_maker)
        monkeypatch.setattr(console_resources, "get_knowledge_fs_runtime", get_runtime)
        monkeypatch.setattr(
            console_resources,
            "current_account_with_tenant",
            lambda: (_knowledge_fs_resource_delegation_account("account-1"), "tenant-1"),
        )
        app = Flask(__name__)

        assert console_resources._console_services() is runtime
        assert get_runtime.calls == [invocation(session_maker)]
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

        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        with pytest.raises(NotFound):
            console_resources._console_services()

        apply_config_overrides(monkeypatch, KNOWLEDGE_FS_COMMUNITY_DEV_ENABLED=True)
        assert console_resources._console_services() is runtime

        apply_config_overrides(monkeypatch, KNOWLEDGE_FS_ENABLED=False)
        with pytest.raises(NotFound):
            console_resources._console_services()

    @staticmethod
    def test_service_resource_helpers_validate_feature_bearer_headers_and_boolean_queries(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        runtime = FakeRuntime()
        session_maker = object()
        get_runtime = Recorder(runtime)
        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, KNOWLEDGE_FS_ENABLED=True)
        monkeypatch.setattr(service_resources.session_factory, "get_session_maker", lambda: session_maker)
        monkeypatch.setattr(service_resources, "get_knowledge_fs_runtime", get_runtime)
        app = Flask(__name__)

        assert service_resources._runtime() is runtime
        assert get_runtime.calls == [invocation(session_maker)]

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

        apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        with pytest.raises(NotFound):
            service_resources._runtime()

        apply_config_overrides(monkeypatch, KNOWLEDGE_FS_COMMUNITY_DEV_ENABLED=True)
        assert service_resources._runtime() is runtime

        apply_config_overrides(monkeypatch, KNOWLEDGE_FS_ENABLED=False)
        with pytest.raises(NotFound):
            service_resources._runtime()

    @staticmethod
    def test_console_request_rejections_preserve_http_status_contracts() -> None:
        from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError

        expected: dict[Literal[400, 403, 409, 413, 422, 429, 503, 504], type[BaseHTTPException]] = {
            400: KnowledgeFSInvalidRequestHTTPError,
            403: KnowledgeFSAccessDeniedHTTPError,
            409: KnowledgeFSConflictHTTPError,
            413: KnowledgeFSRequestTooLargeHTTPError,
            422: KnowledgeFSRequestRejectedHTTPError,
            429: KnowledgeFSRateLimitHTTPError,
            503: KnowledgeFSOperationUnavailableHTTPError,
            504: KnowledgeFSTimeoutHTTPError,
        }
        for status, http_error in expected.items():
            guarded = console_resources._knowledge_fs_errors(
                raising(KnowledgeFSProductRequestRejectedError(status_code=status))
            )

            with pytest.raises(http_error) as raised:
                guarded()

            assert raised.value.code == status
            assert raised.value.data == {
                "code": http_error.error_code,
                "message": http_error.description,
                "status": status,
            }

    @staticmethod
    @pytest.mark.parametrize(
        ("status", "failure_code", "category", "safe_message"),
        [
            (
                503,
                "DOCUMENT_COUNT_QUOTA_UNAVAILABLE",
                "dependency",
                "The workspace document quota could not be verified. Try again later.",
            ),
            (
                503,
                "VECTOR_SPACE_QUOTA_UNAVAILABLE",
                "dependency",
                "The workspace vector storage quota could not be verified. Try again later.",
            ),
            (504, "KNOWLEDGE_FS_TIMEOUT", "timeout", "The Agent Knowledge Base operation timed out. Try again later."),
        ],
    )
    def test_console_unavailable_and_timeout_rejections_preserve_safe_failure_metadata(
        status: Literal[503, 504], failure_code: str, category: str, safe_message: str
    ) -> None:
        from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError

        expected_failure = {
            "action": "retry",
            "category": category,
            "code": failure_code,
            "message": safe_message,
            "retryPolicy": "manual",
            "traceId": "trace-quota",
            "parameters": {"retryAfterSeconds": 30},
        }
        failure = KnowledgeFSPublicFailureResponse.model_validate(
            {**expected_failure, "message": "Private upstream diagnostic that must not reach the client"}
        )
        guarded = console_resources._knowledge_fs_errors(
            raising(KnowledgeFSProductRequestRejectedError(status_code=status, failure=failure))
        )
        http_error = KnowledgeFSOperationUnavailableHTTPError if status == 503 else KnowledgeFSTimeoutHTTPError

        with pytest.raises(http_error) as raised:
            guarded()

        assert raised.value.code == status
        assert raised.value.data == {
            "code": http_error.error_code,
            "message": safe_message,
            "status": status,
            "failure": expected_failure,
        }

    @staticmethod
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
        guarded = console_resources._knowledge_fs_errors(
            raising(KnowledgeFSProductRequestRejectedError(status_code=422, failure=failure))
        )

        with pytest.raises(KnowledgeFSRequestRejectedHTTPError) as raised:
            guarded()

        assert raised.value.data == {
            "code": "knowledge_fs_request_rejected",
            "message": "The Agent Knowledge Base operation requires a configuration change before it can continue.",
            "status": 422,
            "failure": {
                "action": "configure_model",
                "category": "configuration",
                "code": "MODEL_SELECTION_NOT_FOUND",
                "message": "The Agent Knowledge Base operation requires a configuration change before it can continue.",
                "retryPolicy": "after_configuration",
                "traceId": "trace-model",
            },
        }

    @staticmethod
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

    @staticmethod
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
            guarded = console_resources._knowledge_fs_errors(raising(domain_error))

            with pytest.raises(http_error):
                guarded()

        assert KnowledgeFSUpstreamUnavailableHTTPError.code == HTTPStatus.SERVICE_UNAVAILABLE

    @staticmethod
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
            (
                KnowledgeFSOperationUnavailableError("manifest mismatch"),
                KnowledgeFSServiceOperationUnavailableHTTPError,
            ),
            (
                KnowledgeFSProductResourceNotFoundError("missing child"),
                KnowledgeFSServiceResourceNotFoundHTTPError,
            ),
            (KnowledgeFSProductRemoteError("upstream unavailable"), KnowledgeFSServiceUpstreamUnavailableHTTPError),
            (validation_error, KnowledgeFSServiceInvalidRequestHTTPError),
        )

        for domain_error, http_error in mappings:
            guarded = service_resources._service_api_errors(raising(domain_error))

            with pytest.raises(http_error):
                guarded()

        rejected_mappings = (
            (400, KnowledgeFSServiceInvalidRequestHTTPError),
            (403, KnowledgeFSServiceAccessDeniedHTTPError),
            (409, KnowledgeFSServiceConflictHTTPError),
            (413, KnowledgeFSServiceRequestTooLargeHTTPError),
            (422, KnowledgeFSServiceRequestRejectedHTTPError),
            (429, KnowledgeFSServiceRateLimitHTTPError),
        )
        for status, http_error in rejected_mappings:
            guarded = service_resources._service_api_errors(
                raising(KnowledgeFSProductRequestRejectedError(status_code=status))
            )
            with pytest.raises(http_error):
                guarded()

    @staticmethod
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

    @staticmethod
    def test_console_app_binding_route_rejects_unknown_caller_kind_before_revoke(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from services.knowledge_fs.app_binding_management import KnowledgeFSAppBindingManagementError

        revoke = Recorder()
        monkeypatch.setattr(console_resources, "_actor", lambda: ("account-1", "tenant-1"))
        monkeypatch.setattr(
            console_resources,
            "_console_services",
            lambda: FakeRuntime(app_bindings=FakeComponent(revoke=revoke)),
        )

        with pytest.raises(KnowledgeFSAppBindingManagementError, match="caller kind"):
            _invoke(
                console_resources.KnowledgeFSSpaceAppBindingApi,
                console_resources.KnowledgeFSSpaceAppBindingApi.delete,
                "space-1",
                "unknown-caller",
                "app-1",
            )

        assert revoke.calls == []

    @staticmethod
    def test_service_profile_hides_unknown_operations_before_dataset_key_authorization(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        authorization = FakeComponent(authorize=Recorder())
        # The profile check must fail before it touches any runtime component but authorization.
        runtime = cast(KnowledgeFSRuntime, FakeRuntime(service_api_authorization=authorization))
        monkeypatch.setattr(service_resources, "product_operation_action", raising(KeyError("unknown")))

        with pytest.raises(KnowledgeFSOperationUnavailableError, match="unknownOperation"):
            service_resources._profile(
                runtime,
                operation_id="unknownOperation",
                control_space_id="space-1",
            )

        assert authorization.authorize.calls == []

    @staticmethod
    def test_service_operation_helper_forwards_the_complete_validated_request(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        profile = object()
        payload = KnowledgeFSQueryCreatePayload(query="question")
        facade = FakeComponent(execute_service=Recorder({"id": "result-1"}))
        runtime = FakeRuntime(facade=facade)
        monkeypatch.setattr(service_resources, "_runtime", lambda: runtime)
        monkeypatch.setattr(service_resources, "_profile", Recorder(profile))

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
        assert facade.execute_service.calls == [
            invocation(
                profile=profile,
                operation_id="createResearchTask",
                payload=payload,
                query=(("cursor", "next"),),
                bind_space_in_body=True,
                resource_id="task-1",
                path_parameters=(("taskId", "task-1"),),
                headers=(("Idempotency-Key", "request-key"),),
            )
        ]
