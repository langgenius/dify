"""Workspace IM Contact Sync controller contracts."""

from __future__ import annotations

import inspect
from dataclasses import replace
from datetime import datetime
from importlib import import_module
from inspect import unwrap
from types import SimpleNamespace
from typing import Never

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.console.workspace.human_input import (
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
    IMBindingId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from repositories.human_input_v2.contact import Contact, ContactQuery, ContactType, IMBinding, Page
from services.human_input_v2.contact_service import ContactWithIMBindings
from services.human_input_v2.im_contact_sync.errors import IMWriteUnavailableError
from services.human_input_v2.im_contact_sync.service import (
    IMChannelNotConfiguredError,
    IMSyncDispatchUnavailableError,
    IMSyncRevisionChangedError,
    IMSyncRunNotFoundError,
)

_CONTROLLER_MODULE = import_module("controllers.console.workspace.human_input")
_NOW = datetime(2026, 8, 11, 8)
_CONTACT_CREATED_AT = datetime(2025, 7, 10, 6)
_RUN = IMSyncRun.create(
    sync_run_id=IMSyncRunId("run-1"),
    channel_revision=IMChannelRevision("integration-1", 3),
    provider=IMProvider.FEISHU,
    started_by_account_id=AccountId("account-1"),
    now=_NOW,
)
_RESULT = SyncResultFact(
    id=IMSyncResultId("result-1"),
    integration_id=IntegrationId("integration-1"),
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
    def create_organization_binding(self, **kwargs: object) -> ContactIMBindingView:
        assert kwargs == {
            "organization_scope": WorkspaceScope(id=TenantId("workspace-1")),
            "tenant_id": TenantId("workspace-1"),
            "contact_id": ContactId("00000000-0000-0000-0000-000000000001"),
            "identity_id": IMIdentityId("identity-1"),
            "bound_by_account_id": AccountId("account-1"),
        }
        return _contact_view(IMBindingScope.ORGANIZATION)

    def delete_organization_binding(self, **kwargs: object) -> None:
        assert kwargs["binding_id"] == IMBindingId("binding-organization")

    def set_workspace_override(self, **_kwargs: object) -> ContactIMBindingView:
        return _contact_view(IMBindingScope.WORKSPACE)

    def reset_workspace_override(self, **_kwargs: object) -> ContactIMBindingView:
        return _contact_view(IMBindingScope.ORGANIZATION)


@pytest.fixture
def application(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    application = SimpleNamespace(sync_service=_SyncService(), binding_service=_BindingService())
    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_im_contact_sync_application",
        lambda: application,
        raising=False,
    )
    return application


def test_sync_command_and_queries_map_transport_neutral_results(
    app: Flask,
    application: SimpleNamespace,
) -> None:
    assert application.sync_service is not None
    account = SimpleNamespace(id="account-1")
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
                "integration_id": "integration-1",
                "integration_config_version": 3,
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
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    error = IMSyncDispatchUnavailableError("IM synchronization dispatch is temporarily unavailable")

    class SyncService:
        def create_or_get_active_run(self, _scope: object, _account_id: object) -> Never:
            raise error

    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_im_contact_sync_application",
        lambda: SimpleNamespace(sync_service=SyncService()),
    )

    with app.test_request_context(method="POST"):
        response, status = unwrap(WorkspaceIMSyncRunsApi.post)(
            WorkspaceIMSyncRunsApi(),
            "workspace-1",
            SimpleNamespace(id="account-1"),
        )

    assert status == 503
    assert response == {
        "code": "im_sync_dispatch_unavailable",
        "message": str(error),
        "status": 503,
    }


@pytest.mark.parametrize("command", ["sync_create", "organization_binding", "workspace_override"])
def test_write_unavailable_has_stable_retryable_http_mapping(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    command: str,
) -> None:
    error = IMWriteUnavailableError("IM write is temporarily unavailable")

    class SyncService:
        def create_or_get_active_run(self, _scope: object, _account_id: object) -> Never:
            raise error

    class BindingService:
        def create_organization_binding(self, **_kwargs: object) -> Never:
            raise error

        def set_workspace_override(self, **_kwargs: object) -> Never:
            raise error

    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_im_contact_sync_application",
        lambda: SimpleNamespace(sync_service=SyncService(), binding_service=BindingService()),
    )
    account = SimpleNamespace(id="account-1")
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

    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_im_contact_sync_application",
        lambda: SimpleNamespace(sync_service=SyncService()),
    )
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
        assert result_payload["contact"]["created_at"] == int(_CONTACT_CREATED_AT.timestamp())
    if sync_result.result_type is IMSyncResultType.REMOVED:
        assert result_payload["reason"] == "not_present_in_directory"
        assert result_payload["last_known_identity"]["identity_id"] == "identity-1"
    if sync_result.result_type is IMSyncResultType.FAILED:
        assert result_payload["reason"] == "Directory read failed"


def test_binding_and_override_handlers_return_current_contact_projection(
    app: Flask,
    application: SimpleNamespace,
) -> None:
    assert application.binding_service is not None
    account = SimpleNamespace(id="account-1")
    contact_id = "00000000-0000-0000-0000-000000000001"
    with app.test_request_context(method="PUT", json={"identity_id": "identity-1"}):
        organization = unwrap(WorkspaceContactIMBindingsApi.put)(
            WorkspaceContactIMBindingsApi(), "workspace-1", account, contact_id
        )
    with app.test_request_context(method="PUT", json={"identity_id": "identity-1"}):
        override = unwrap(WorkspaceContactIMOverrideApi.put)(
            WorkspaceContactIMOverrideApi(), "workspace-1", account, contact_id
        )
    with app.test_request_context(method="DELETE"):
        reset = unwrap(WorkspaceContactIMOverrideApi.delete)(WorkspaceContactIMOverrideApi(), "workspace-1", contact_id)
    with app.test_request_context(
        method="DELETE",
        query_string={"binding_id": "binding-organization"},
    ):
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
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected_status: int,
    expected_code: str,
) -> None:
    if isinstance(error, IMBindingCommandError):

        class BindingService:
            def create_organization_binding(self, **_kwargs: object) -> Never:
                raise error

        application = SimpleNamespace(binding_service=BindingService())
        handler = unwrap(WorkspaceContactIMBindingsApi.put)
        request_context = app.test_request_context(method="PUT", json={"identity_id": "identity-1"})
        handler_args = (
            WorkspaceContactIMBindingsApi(),
            "workspace-1",
            SimpleNamespace(id="account-1"),
            "00000000-0000-0000-0000-000000000001",
        )
    elif isinstance(error, IMSyncRevisionChangedError):

        class SyncService:
            def create_or_get_active_run(self, _scope: object, _account_id: object) -> Never:
                raise error

        application = SimpleNamespace(sync_service=SyncService())
        handler = unwrap(WorkspaceIMSyncRunsApi.post)
        request_context = app.test_request_context(method="POST")
        handler_args = (WorkspaceIMSyncRunsApi(), "workspace-1", SimpleNamespace(id="account-1"))
    else:

        class SyncService:
            def get_latest_run(self, _scope: object) -> Never:
                raise error

        application = SimpleNamespace(sync_service=SyncService())
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
            SimpleNamespace(id="account-1"),
            "00000000-0000-0000-0000-000000000001",
        )


def test_handlers_preserve_authorization_and_do_not_reach_persistence_or_stub() -> None:
    command_classes = (WorkspaceIMSyncRunsApi, WorkspaceContactIMBindingsApi, WorkspaceContactIMOverrideApi)
    query_classes = (WorkspaceLatestIMSyncRunApi, WorkspaceLatestIMSyncRunResultsApi, WorkspaceIMIdentitiesApi)

    for controller_class in (*command_classes, *query_classes):
        source = inspect.getsource(controller_class)
        for decorator_name in (
            "setup_required",
            "login_required",
            "account_initialization_required",
            "is_admin_or_owner_required",
            "with_current_tenant_id",
        ):
            assert f"@{decorator_name}" in source
        assert "_raise_stub_not_implemented" not in source
        assert "repositories." not in source
        assert "sqlalchemy" not in source.lower()
    for controller_class in command_classes:
        assert "@with_current_user" in inspect.getsource(controller_class)


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
    assert options["data"][0]["id"] == contact_id
    assert batch["data"][0]["id"] == contact_id
    assert batch_options["data"][0]["id"] == contact_id
    assert "im_bindings" not in options["data"][0]
    assert "email" not in batch["data"][0]


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
