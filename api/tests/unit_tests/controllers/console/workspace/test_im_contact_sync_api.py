"""Workspace IM Contact Sync controller contracts."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from importlib import import_module
from inspect import unwrap
from typing import Never, override

import pytest
from flask import Flask
from flask_restx import Resource
from pydantic import JsonValue, ValidationError
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound

from controllers.console.human_input_v2.contact import (
    BatchGetContactOptionsAPI,
    BatchGetContactsAPI,
    WorkspaceContactApi,
    WorkspaceContactIMBindingsApi,
    WorkspaceContactIMOverrideApi,
    WorkspaceContactOptionsApi,
    WorkspaceContactsApi,
    WorkspaceIMIdentitiesApi,
    WorkspaceIMSyncRunsApi,
    WorkspaceLatestIMSyncRunApi,
    WorkspaceLatestIMSyncRunResultsApi,
)
from core.human_input_v2.entities import (
    HumanInputContactType,
    IMBindingScope,
    IMIdentityBindingStatus,
    IMProvider,
    IMSyncRemovalReason,
    IMSyncResultType,
)
from core.human_input_v2.im_integration import (
    ContactIMBindingView,
    IMBindingCommandError,
    IMBindingCommandErrorCode,
    IMChannelRevision,
    IMSyncRun,
    SyncContactSnapshot,
    SynchronizedIMIdentity,
    SynchronizedIMIdentityPage,
    SyncIdentitySnapshot,
    SyncResultFact,
    SyncResultPage,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    IMBindingId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    TenantId,
    WorkspaceScope,
)
from enums import DeploymentEdition
from libs.external_api import ExternalApi
from repositories.human_input_v2.contact import Contact, ContactQuery, ContactType, IMBinding, Page
from repositories.human_input_v2.im_channel_repository import IMChannelId
from repositories.human_input_v2.im_identity_repository import IMIdentity
from services.human_input_v2.contact_service import ContactDetails, ContactWithIMBindings, IMBindingDetail
from services.human_input_v2.im_contact_sync.composition import (
    IMContactSyncApplication,
    build_im_contact_sync_application,
)
from services.human_input_v2.im_contact_sync.errors import IMWriteUnavailableError
from services.human_input_v2.im_contact_sync.service import (
    IMChannelNotConfiguredError,
    IMSyncDispatchUnavailableError,
    IMSyncRevisionChangedError,
    IMSyncRunNotFoundError,
)
from tests.helpers.unit.model_factories import make_account

_CONTROLLER_MODULE = import_module("controllers.console.human_input_v2.contact")
_NOW = datetime(2026, 8, 11, 8)
_CONTACT_CREATED_AT = datetime(2025, 7, 10, 6)
_RUN = IMSyncRun.create(
    sync_run_id=IMSyncRunId("run-1"),
    channel_revision=IMChannelRevision("channel-1", 3),
    provider=IMProvider.FEISHU,
    started_by_account_id=AccountId("account-1"),
    now=_NOW,
)
_RESULT = SyncResultFact(
    id=IMSyncResultId("result-1"),
    channel_id=IMChannelId("channel-1"),
    sync_run_id=IMSyncRunId("run-1"),
    operation_key="result:not-matched:provider-user-1",
    result_type=IMSyncResultType.NOT_MATCHED,
    provider_user_id="provider-user-1",
    display_name="Reviewer",
    email="reviewer@example.com",
    normalized_email=None,
    contact_id=None,
    identity_id=IMIdentityId("identity-1"),
    binding_id=None,
    removal_reason=None,
    reason_code="contact_not_found",
    reason_message=None,
    directory_entry_payload=None,
    contact_snapshot=None,
    identity_snapshot=None,
    created_at=_NOW,
    updated_at=_NOW,
)


class _SyncService:
    def create_or_get_active_run(
        self,
        organization_scope: WorkspaceScope,
        started_by_account_id: AccountId,
    ) -> IMSyncRun:
        assert organization_scope == WorkspaceScope(id=TenantId("workspace-1"))
        assert started_by_account_id == AccountId("account-1")
        return _RUN

    def get_latest_run(self, organization_scope: WorkspaceScope) -> IMSyncRun:
        assert organization_scope == WorkspaceScope(id=TenantId("workspace-1"))
        return _RUN

    def list_latest_results(
        self,
        organization_scope: WorkspaceScope,
        result_type: IMSyncResultType,
        *,
        page: int,
        limit: int,
    ) -> SyncResultPage:
        assert organization_scope == WorkspaceScope(id=TenantId("workspace-1"))
        assert result_type is IMSyncResultType.NOT_MATCHED
        assert (page, limit) == (1, 20)
        return SyncResultPage((_RESULT,), page=page, limit=limit, total=1)

    def search_identities(
        self,
        organization_scope: WorkspaceScope,
        *,
        keyword: str | None,
        page: int,
        limit: int,
    ) -> SynchronizedIMIdentityPage:
        assert organization_scope == WorkspaceScope(id=TenantId("workspace-1"))
        assert (keyword, page, limit) == ("provider-user", 1, 20)
        return SynchronizedIMIdentityPage(
            (
                SynchronizedIMIdentity(
                    id=IMIdentityId("identity-1"),
                    provider=IMProvider.FEISHU,
                    provider_user_id="provider-user-1",
                    display_name="Reviewer",
                    email="reviewer@example.com",
                    binding_status=IMIdentityBindingStatus.UNBOUND,
                ),
            ),
            page=page,
            limit=limit,
            total=1,
        )


def _contact_view(scope: IMBindingScope) -> ContactIMBindingView:
    binding = IMBinding(
        id=IMBindingId(f"binding-{scope.value}"),
        scope=scope,
        contact_id=ContactId("00000000-0000-0000-0000-000000000001"),
        identity_id=IMIdentityId("identity-1"),
        provider=IMProvider.FEISHU,
    )
    return ContactIMBindingView(
        id=binding.contact_id,
        type=HumanInputContactType.WORKSPACE,
        name="Reviewer",
        email="reviewer@example.com",
        avatar_file_id=None,
        im_bindings=(binding,),
        created_at=_NOW,
    )


class _BindingService:
    def set_organization_binding(self, **kwargs: object) -> ContactIMBindingView:
        assert kwargs == {
            "organization_scope": WorkspaceScope(id=TenantId("workspace-1")),
            "tenant_id": TenantId("workspace-1"),
            "contact_id": ContactId("00000000-0000-0000-0000-000000000001"),
            "identity_id": IMIdentityId("identity-1"),
            "bound_by_account_id": AccountId("account-1"),
        }
        return _contact_view(IMBindingScope.ORGANIZATION)

    def delete_organization_binding(self, **kwargs: object) -> None:
        assert kwargs == {
            "organization_scope": WorkspaceScope(id=TenantId("workspace-1")),
            "contact_id": ContactId("00000000-0000-0000-0000-000000000001"),
        }

    def set_workspace_override(self, **_kwargs: object) -> ContactIMBindingView:
        return _contact_view(IMBindingScope.WORKSPACE)

    def reset_workspace_override(self, **_kwargs: object) -> ContactIMBindingView:
        return _contact_view(IMBindingScope.ORGANIZATION)


@pytest.fixture
def application(monkeypatch: pytest.MonkeyPatch) -> IMContactSyncApplication:
    application = build_im_contact_sync_application(session_maker=sessionmaker())
    sync = _SyncService()
    binding = _BindingService()
    monkeypatch.setattr(application.sync_service, "create_or_get_active_run", sync.create_or_get_active_run)
    monkeypatch.setattr(application.sync_service, "get_latest_run", sync.get_latest_run)
    monkeypatch.setattr(application.sync_service, "list_latest_results", sync.list_latest_results)
    monkeypatch.setattr(application.sync_service, "search_identities", sync.search_identities)
    monkeypatch.setattr(application.binding_service, "set_organization_binding", binding.set_organization_binding)
    monkeypatch.setattr(application.binding_service, "delete_organization_binding", binding.delete_organization_binding)
    monkeypatch.setattr(application.binding_service, "set_workspace_override", binding.set_workspace_override)
    monkeypatch.setattr(application.binding_service, "reset_workspace_override", binding.reset_workspace_override)
    monkeypatch.setattr(_CONTROLLER_MODULE, "build_im_contact_sync_application", lambda: application)
    return application


def test_sync_command_and_queries_map_transport_neutral_results(
    app: Flask,
    application: IMContactSyncApplication,
) -> None:
    assert application.sync_service is not None
    account = make_account(account_id="account-1", name="Editor", email="editor@example.com")
    with app.test_request_context(method="POST"):
        created = unwrap(WorkspaceIMSyncRunsApi.post)(WorkspaceIMSyncRunsApi(), "workspace-1", account)
    with app.test_request_context(method="GET"):
        latest = unwrap(WorkspaceLatestIMSyncRunApi.get)(WorkspaceLatestIMSyncRunApi(), "workspace-1")
    with app.test_request_context(
        method="GET",
        query_string={"result": "not_matched", "page": "1", "limit": "20"},
    ):
        result_page = unwrap(WorkspaceLatestIMSyncRunResultsApi.get)(
            WorkspaceLatestIMSyncRunResultsApi(), "workspace-1"
        )
    with app.test_request_context(
        method="GET",
        query_string={"keyword": "provider-user", "page": "1", "limit": "20"},
    ):
        identity_page = unwrap(WorkspaceIMIdentitiesApi.get)(WorkspaceIMIdentitiesApi(), "workspace-1")

    assert (
        created
        == latest
        == {
            "run": {
                "id": "run-1",
                "status": "queued",
                "started_at": None,
                "finished_at": None,
                "error_message": None,
                "result_counts": {"added": 0, "not_matched": 0, "failed": 0, "removed": 0, "skipped": 0},
                "provider": "feishu",
                "channel_id": "channel-1",
                "channel_config_version": 3,
            }
        }
    )
    assert result_page == {
        "data": [
            {
                "id": "result-1",
                "result": {
                    "type": "not_matched",
                    "entry": {
                        "provider_user_id": "provider-user-1",
                        "display_name": "Reviewer",
                        "email": "reviewer@example.com",
                    },
                },
            }
        ],
        "page": 1,
        "limit": 20,
        "total": 1,
    }
    assert identity_page == {
        "data": [
            {
                "id": "identity-1",
                "provider": "feishu",
                "provider_user_id": "provider-user-1",
                "display_name": "Reviewer",
                "email": "reviewer@example.com",
                "binding_status": "unbound",
            }
        ],
        "page": 1,
        "limit": 20,
        "total": 1,
    }


def test_sync_dispatch_unavailable_has_stable_retryable_http_mapping(
    application: IMContactSyncApplication,
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    error = IMSyncDispatchUnavailableError("IM synchronization dispatch is temporarily unavailable")

    class SyncService:
        def create_or_get_active_run(self, _scope: object, _account_id: object) -> Never:
            raise error

    monkeypatch.setattr(application.sync_service, "create_or_get_active_run", SyncService().create_or_get_active_run)

    with app.test_request_context(method="POST"):
        response, status = unwrap(WorkspaceIMSyncRunsApi.post)(
            WorkspaceIMSyncRunsApi(),
            "workspace-1",
            make_account(account_id="account-1", name="Editor", email="editor@example.com"),
        )

    assert status == 503
    assert response == {
        "code": "im_sync_dispatch_unavailable",
        "message": str(error),
        "status": 503,
    }


@pytest.mark.parametrize("command", ["sync_create", "organization_binding", "workspace_override"])
def test_write_unavailable_has_stable_retryable_http_mapping(
    application: IMContactSyncApplication,
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    command: str,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=(
            DeploymentEdition.ENTERPRISE if command == "workspace_override" else DeploymentEdition.COMMUNITY
        )
    )
    error = IMWriteUnavailableError("IM write is temporarily unavailable")

    class SyncService:
        def create_or_get_active_run(self, _scope: object, _account_id: object) -> Never:
            raise error

    class BindingService:
        def set_organization_binding(self, **_kwargs: object) -> Never:
            raise error

        def set_workspace_override(self, **_kwargs: object) -> Never:
            raise error

    monkeypatch.setattr(application.sync_service, "create_or_get_active_run", SyncService().create_or_get_active_run)
    monkeypatch.setattr(
        application.binding_service, "set_organization_binding", BindingService().set_organization_binding
    )
    monkeypatch.setattr(application.binding_service, "set_workspace_override", BindingService().set_workspace_override)
    account = make_account(account_id="account-1", name="Editor", email="editor@example.com")
    contact_id = "00000000-0000-0000-0000-000000000001"
    if command == "sync_create":
        handler = unwrap(WorkspaceIMSyncRunsApi.post)
        request_context = app.test_request_context(method="POST")
        handler_args = (WorkspaceIMSyncRunsApi(), "workspace-1", account)
    elif command == "organization_binding":
        handler = unwrap(WorkspaceContactIMBindingsApi.put)
        request_context = app.test_request_context(method="PUT", json={"identity_id": "identity-1"})
        handler_args = (WorkspaceContactIMBindingsApi(), "workspace-1", account, contact_id)
    else:
        handler = unwrap(WorkspaceContactIMOverrideApi.put)
        request_context = app.test_request_context(method="PUT", json={"identity_id": "identity-1"})
        handler_args = (WorkspaceContactIMOverrideApi(), "workspace-1", account, contact_id)

    with request_context:
        response, status = handler(*handler_args)

    assert status == 503
    assert response == {
        "code": "im_write_unavailable",
        "message": str(error),
        "status": 503,
    }


@pytest.mark.parametrize(
    "sync_result",
    [
        replace(
            _RESULT,
            result_type=IMSyncResultType.ADDED,
            contact_id=ContactId("contact-1"),
            binding_id=IMBindingId("binding-1"),
            contact_snapshot=SyncContactSnapshot(
                ContactId("contact-1"),
                "Reviewer",
                None,
                None,
                _CONTACT_CREATED_AT,
            ),
        ),
        replace(
            _RESULT,
            result_type=IMSyncResultType.REMOVED,
            contact_id=ContactId("contact-1"),
            binding_id=IMBindingId("binding-1"),
            removal_reason=IMSyncRemovalReason.NOT_PRESENT_IN_DIRECTORY,
            contact_snapshot=SyncContactSnapshot(ContactId("contact-1"), "Reviewer", None, None),
            identity_snapshot=SyncIdentitySnapshot(
                IMIdentityId("identity-1"),
                IMProvider.FEISHU,
                "provider-user-1",
                "Reviewer",
                "reviewer@example.com",
            ),
        ),
        replace(_RESULT, result_type=IMSyncResultType.FAILED, reason_message="Directory read failed"),
        replace(
            _RESULT,
            result_type=IMSyncResultType.SKIPPED,
            contact_id=ContactId("contact-1"),
            contact_snapshot=SyncContactSnapshot(ContactId("contact-1"), "Reviewer", None, None),
        ),
        _RESULT,
    ],
)
def test_latest_results_map_every_discriminated_bucket(
    application: IMContactSyncApplication,
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sync_result: SyncResultFact,
) -> None:
    class SyncService:
        def list_latest_results(
            self,
            _scope: object,
            result_type: IMSyncResultType,
            *,
            page: int,
            limit: int,
        ) -> SyncResultPage:
            assert result_type is sync_result.result_type
            return SyncResultPage((sync_result,), page=page, limit=limit, total=1)

    monkeypatch.setattr(application.sync_service, "list_latest_results", SyncService().list_latest_results)
    with app.test_request_context(
        method="GET",
        query_string={"result": sync_result.result_type.value, "page": "1", "limit": "20"},
    ):
        response = unwrap(WorkspaceLatestIMSyncRunResultsApi.get)(
            WorkspaceLatestIMSyncRunResultsApi(),
            "workspace-1",
        )

    result_payload = response["data"][0]["result"]
    assert result_payload["type"] == sync_result.result_type.value
    if sync_result.result_type in (IMSyncResultType.ADDED, IMSyncResultType.SKIPPED, IMSyncResultType.REMOVED):
        assert "type" not in result_payload["contact"]
    if sync_result.result_type is IMSyncResultType.ADDED:
        assert result_payload["contact"]["created_at"] == 1752127200
    if sync_result.result_type is IMSyncResultType.REMOVED:
        assert result_payload["reason"] == "not_present_in_directory"
        assert result_payload["last_known_identity"]["identity_id"] == "identity-1"
    if sync_result.result_type is IMSyncResultType.FAILED:
        assert result_payload["reason"] == "Directory read failed"


def test_binding_and_override_handlers_return_current_contact_projection(
    app: Flask,
    application: IMContactSyncApplication,
    config_overrides: Callable[..., None],
) -> None:
    assert application.binding_service is not None
    account = make_account(account_id="account-1", name="Editor", email="editor@example.com")
    contact_id = "00000000-0000-0000-0000-000000000001"
    with app.test_request_context(method="PUT", json={"identity_id": "identity-1"}):
        organization = unwrap(WorkspaceContactIMBindingsApi.put)(
            WorkspaceContactIMBindingsApi(), "workspace-1", account, contact_id
        )
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    with app.test_request_context(method="PUT", json={"identity_id": "identity-1"}):
        override = unwrap(WorkspaceContactIMOverrideApi.put)(
            WorkspaceContactIMOverrideApi(), "workspace-1", account, contact_id
        )
    with app.test_request_context(method="DELETE"):
        reset = unwrap(WorkspaceContactIMOverrideApi.delete)(WorkspaceContactIMOverrideApi(), "workspace-1", contact_id)
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    with app.test_request_context(method="DELETE"):
        deleted = unwrap(WorkspaceContactIMBindingsApi.delete)(
            WorkspaceContactIMBindingsApi(), "workspace-1", contact_id
        )

    assert organization["contact"]["im_bindings"] == [
        {"id": "binding-organization", "provider": "feishu", "scope": "organization"}
    ]
    assert override["contact"]["im_bindings"] == [
        {"id": "binding-workspace", "provider": "feishu", "scope": "workspace"}
    ]
    assert reset["contact"]["im_bindings"][0]["scope"] == "organization"
    assert deleted == {}


@pytest.mark.parametrize(
    ("edition", "override", "allowed"),
    [
        (DeploymentEdition.COMMUNITY, False, True),
        (DeploymentEdition.COMMUNITY, True, False),
        (DeploymentEdition.CLOUD, False, True),
        (DeploymentEdition.CLOUD, True, False),
        (DeploymentEdition.ENTERPRISE, False, False),
        (DeploymentEdition.ENTERPRISE, True, True),
    ],
)
@pytest.mark.parametrize("method", ["PUT", "DELETE"])
@pytest.mark.usefixtures("application")
def test_binding_writes_follow_the_deployment_management_mode(
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    override: bool,
    allowed: bool,
    method: str,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    resource = WorkspaceContactIMOverrideApi() if override else WorkspaceContactIMBindingsApi()
    contact_id = "00000000-0000-0000-0000-000000000001"

    class BindingResource(Resource):
        def put(self) -> dict[str, JsonValue]:
            return unwrap(resource.put)(
                resource,
                "workspace-1",
                make_account(account_id="account-1", name="Editor", email="editor@example.com"),
                contact_id,
            )

        def delete(self) -> dict[str, JsonValue]:
            return unwrap(resource.delete)(resource, "workspace-1", contact_id)

    transport = Flask(__name__)
    api = ExternalApi(transport)
    api.add_resource(BindingResource, "/binding")
    response = transport.test_client().open(
        "/binding",
        method=method,
        json={"identity_id": "identity-1"},
    )
    if allowed:
        assert response.status_code == 200
    else:
        assert response.status_code == 403
        expected_code = "workspace_im_override_not_allowed" if override else "im_binding_read_only"
        expected_message = (
            "Workspace IM overrides require centrally managed bindings."
            if override
            else "Centrally managed IM bindings cannot be edited from a workspace."
        )
        assert response.get_json() == {"code": expected_code, "message": expected_message, "status": 403}


def test_enterprise_override_and_identity_search_use_the_deployment_directory(
    monkeypatch: pytest.MonkeyPatch,
    app: Flask,
    application: IMContactSyncApplication,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    scopes = []

    class BindingService(_BindingService):
        @override
        def set_workspace_override(self, **kwargs: object) -> ContactIMBindingView:
            scopes.append(kwargs["organization_scope"])
            return super().set_workspace_override(**kwargs)

        @override
        def reset_workspace_override(self, **kwargs: object) -> ContactIMBindingView:
            scopes.append(kwargs["organization_scope"])
            return super().reset_workspace_override(**kwargs)

    class SyncService(_SyncService):
        @override
        def search_identities(
            self, organization_scope: WorkspaceScope, **_kwargs: object
        ) -> SynchronizedIMIdentityPage:
            scopes.append(organization_scope)
            return SynchronizedIMIdentityPage((), page=1, limit=20, total=0)

    monkeypatch.setattr(application.binding_service, "set_workspace_override", BindingService().set_workspace_override)
    monkeypatch.setattr(
        application.binding_service, "reset_workspace_override", BindingService().reset_workspace_override
    )
    monkeypatch.setattr(application.sync_service, "search_identities", SyncService().search_identities)
    contact_id = "00000000-0000-0000-0000-000000000001"
    with app.test_request_context(method="PUT", json={"identity_id": "identity-1"}):
        unwrap(WorkspaceContactIMOverrideApi.put)(
            WorkspaceContactIMOverrideApi(),
            "workspace-1",
            make_account(account_id="account-1", name="Editor", email="editor@example.com"),
            contact_id,
        )
    with app.test_request_context(method="DELETE"):
        unwrap(WorkspaceContactIMOverrideApi.delete)(WorkspaceContactIMOverrideApi(), "workspace-1", contact_id)
    with app.test_request_context(method="GET"):
        unwrap(WorkspaceIMIdentitiesApi.get)(WorkspaceIMIdentitiesApi(), "workspace-1")

    assert scopes == [DeploymentScope(), DeploymentScope(), DeploymentScope()]


@pytest.mark.parametrize(
    ("error", "expected_status", "expected_code"),
    [
        (IMChannelNotConfiguredError("missing"), 404, "im_integration_not_configured"),
        (IMSyncRunNotFoundError("missing run"), 404, "im_sync_run_not_found"),
        (IMSyncRevisionChangedError("stale revision"), 409, "im_sync_revision_changed"),
        (
            IMBindingCommandError(IMBindingCommandErrorCode.BINDING_CONFLICT, "conflict"),
            409,
            "im_binding_conflict",
        ),
        (
            IMBindingCommandError(IMBindingCommandErrorCode.INVALID_SCOPE, "invalid"),
            422,
            "invalid_im_binding_scope",
        ),
    ],
)
def test_expected_application_errors_have_stable_http_mapping(
    application: IMContactSyncApplication,
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected_status: int,
    expected_code: str,
) -> None:
    if isinstance(error, IMBindingCommandError):

        class BindingService:
            def set_organization_binding(self, **_kwargs: object) -> Never:
                raise error

        monkeypatch.setattr(
            application.binding_service, "set_organization_binding", BindingService().set_organization_binding
        )
        handler = unwrap(WorkspaceContactIMBindingsApi.put)
        request_context = app.test_request_context(method="PUT", json={"identity_id": "identity-1"})
        handler_args = (
            WorkspaceContactIMBindingsApi(),
            "workspace-1",
            make_account(account_id="account-1", name="Editor", email="editor@example.com"),
            "00000000-0000-0000-0000-000000000001",
        )
    elif isinstance(error, IMSyncRevisionChangedError):

        class SyncService:
            def create_or_get_active_run(self, _scope: object, _account_id: object) -> Never:
                raise error

        monkeypatch.setattr(
            application.sync_service, "create_or_get_active_run", SyncService().create_or_get_active_run
        )
        handler = unwrap(WorkspaceIMSyncRunsApi.post)
        request_context = app.test_request_context(method="POST")
        handler_args = (
            WorkspaceIMSyncRunsApi(),
            "workspace-1",
            make_account(account_id="account-1", name="Editor", email="editor@example.com"),
        )
    else:

        class SyncService:
            def get_latest_run(self, _scope: object) -> Never:
                raise error

        monkeypatch.setattr(application.sync_service, "get_latest_run", SyncService().get_latest_run)
        handler = unwrap(WorkspaceLatestIMSyncRunApi.get)
        request_context = app.test_request_context(method="GET")
        handler_args = (WorkspaceLatestIMSyncRunApi(), "workspace-1")

    monkeypatch.setattr(_CONTROLLER_MODULE, "build_im_contact_sync_application", lambda: application)
    with request_context:
        response, status = handler(*handler_args)

    assert status == expected_status
    assert response == {"code": expected_code, "message": str(error), "status": expected_status}


def test_in_scope_handlers_validate_before_service_construction(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_im_contact_sync_application",
        lambda: (_ for _ in ()).throw(AssertionError("service must not be built")),
        raising=False,
    )
    with app.test_request_context(method="GET"), pytest.raises(ValidationError):
        unwrap(WorkspaceLatestIMSyncRunResultsApi.get)(WorkspaceLatestIMSyncRunResultsApi(), "workspace-1")
    with app.test_request_context(method="PUT", json={}), pytest.raises(ValidationError):
        unwrap(WorkspaceContactIMBindingsApi.put)(
            WorkspaceContactIMBindingsApi(),
            "workspace-1",
            make_account(account_id="account-1", name="Editor", email="editor@example.com"),
            "00000000-0000-0000-0000-000000000001",
        )


class _ContactService:
    def __init__(self) -> None:
        contact = Contact(
            id=ContactId("00000000-0000-0000-0000-000000000001"),
            type=ContactType.WORKSPACE,
            name="Reviewer",
            email="reviewer@example.com",
            avatar_file_id=None,
            created_at=_CONTACT_CREATED_AT,
        )
        self.view = ContactWithIMBindings(contact, _contact_view(IMBindingScope.ORGANIZATION).im_bindings)

    def list_contacts(
        self,
        tenant_id: TenantId,
        *,
        page: int,
        limit: int,
        query: ContactQuery,
    ) -> tuple[Page[Contact], tuple[ContactWithIMBindings, ...]]:
        assert tenant_id == TenantId("workspace-1")
        assert (page, limit, query) == (1, 20, ContactQuery())
        return Page((self.view.contact,), page, limit), (self.view,)

    def count_contacts(self, tenant_id: TenantId, query: ContactQuery) -> int:
        assert tenant_id == TenantId("workspace-1")
        assert query == ContactQuery()
        return 1

    def get_contact(self, tenant_id: TenantId, contact_id: ContactId) -> ContactWithIMBindings | None:
        assert tenant_id == TenantId("workspace-1")
        return self.view if contact_id == self.view.contact.id else None

    def get_contact_details(self, tenant_id: TenantId, contact_id: ContactId) -> ContactDetails | None:
        view = self.get_contact(tenant_id, contact_id)
        if view is None:
            return None
        identity = IMIdentity(
            id=IMIdentityId("identity-1"),
            provider_user_id="provider-user-1",
            display_name="Reviewer",
            email="reviewer@example.com",
            last_seen_sync_run_id=IMSyncRunId("run-1"),
            last_seen_at=_NOW,
            created_at=_NOW,
            updated_at=_NOW,
        )
        return ContactDetails(view, tuple(IMBindingDetail(binding, identity) for binding in view.im_bindings))

    def list_contact_options(
        self,
        tenant_id: TenantId,
        *,
        page: int,
        limit: int,
        keyword: str,
    ) -> Page[Contact]:
        assert tenant_id == TenantId("workspace-1")
        assert (page, limit, keyword) == (1, 20, "")
        return Page((self.view.contact,), page, limit)

    def get_contacts(self, tenant_id: TenantId, contact_ids: list[ContactId]) -> tuple[ContactWithIMBindings, ...]:
        assert tenant_id == TenantId("workspace-1")
        assert contact_ids == [self.view.contact.id]
        return (self.view,)

    def get_contact_options(self, tenant_id: TenantId, contact_ids: list[ContactId]) -> tuple[Contact, ...]:
        assert tenant_id == TenantId("workspace-1")
        assert contact_ids == [self.view.contact.id]
        return (self.view.contact,)


def test_contact_read_handlers_preserve_current_and_editor_safe_projections(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _ContactService()
    monkeypatch.setattr(_CONTROLLER_MODULE, "_contact_service", lambda _session, _tenant_id: service)
    contact_id = str(service.view.contact.id)

    with app.test_request_context(method="GET", query_string={"page": "1", "limit": "20"}):
        listed = unwrap(WorkspaceContactsApi.get)(WorkspaceContactsApi(), object(), "workspace-1")
        detail = unwrap(WorkspaceContactApi.get)(WorkspaceContactApi(), object(), "workspace-1", contact_id)
        options = unwrap(WorkspaceContactOptionsApi.get)(WorkspaceContactOptionsApi(), object(), "workspace-1")
    with app.test_request_context(method="GET", query_string=[("contact_ids", contact_id)]):
        batch = unwrap(BatchGetContactsAPI.get)(BatchGetContactsAPI(), object(), "workspace-1")
        batch_options = unwrap(BatchGetContactOptionsAPI.get)(BatchGetContactOptionsAPI(), object(), "workspace-1")

    assert listed["data"][0]["id"] == contact_id
    assert detail["contact"]["id"] == contact_id
    assert detail["im_binding_details"] == [
        {
            "id": "binding-organization",
            "provider": "feishu",
            "scope": "organization",
            "identity": {
                "id": "identity-1",
                "provider_user_id": "provider-user-1",
                "display_name": "Reviewer",
                "email": "reviewer@example.com",
            },
        }
    ]
    assert detail["contact"] == listed["data"][0]
    assert "im_binding_details" not in listed["data"][0]
    assert options["data"][0]["id"] == contact_id
    assert batch["data"][0]["id"] == contact_id
    assert batch_options["data"][0]["id"] == contact_id
    assert "im_bindings" not in options["data"][0]
    assert "email" not in batch["data"][0]


@pytest.mark.parametrize("scope", [IMBindingScope.WORKSPACE, None])
def test_contact_detail_returns_workspace_binding_or_empty_details(
    app: Flask, monkeypatch: pytest.MonkeyPatch, scope: IMBindingScope | None
) -> None:
    service = _ContactService()
    bindings = _contact_view(scope).im_bindings if scope is not None else ()
    service.view = ContactWithIMBindings(service.view.contact, bindings)
    monkeypatch.setattr(_CONTROLLER_MODULE, "_contact_service", lambda _session, _tenant_id: service)
    with app.test_request_context(method="GET"):
        response = unwrap(WorkspaceContactApi.get)(
            WorkspaceContactApi(), object(), "workspace-1", str(service.view.contact.id)
        )
    if scope is None:
        assert response["im_binding_details"] == []
    else:
        assert response["im_binding_details"][0]["scope"] == "workspace"
        assert response["im_binding_details"][0]["identity"]["id"] == "identity-1"


def test_contact_detail_preserves_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _ContactService()
    monkeypatch.setattr(_CONTROLLER_MODULE, "_contact_service", lambda _session, _tenant_id: service)
    with app.test_request_context(method="GET"), pytest.raises(NotFound):
        unwrap(WorkspaceContactApi.get)(
            WorkspaceContactApi(), object(), "workspace-1", "00000000-0000-0000-0000-000000000099"
        )


@pytest.mark.parametrize(
    "result",
    [
        replace(_RESULT, provider_user_id=None, result_type=IMSyncResultType.ADDED),
        replace(_RESULT, result_type=IMSyncResultType.SKIPPED),
        replace(_RESULT, result_type=IMSyncResultType.REMOVED),
    ],
)
def test_sync_result_projection_rejects_incomplete_persisted_snapshots(result: SyncResultFact) -> None:
    with pytest.raises(RuntimeError, match="missing"):
        _CONTROLLER_MODULE._sync_result_payload(result)
