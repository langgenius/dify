"""Workspace IM Contact Sync controller contracts."""

from __future__ import annotations

import inspect
from dataclasses import replace
from datetime import datetime
from importlib import import_module
from inspect import unwrap
from types import SimpleNamespace

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import sessionmaker

from controllers.console.workspace.human_input import (
    WorkspaceContactIMBindingsApi,
    WorkspaceContactIMOverrideApi,
    WorkspaceIMIdentitiesApi,
    WorkspaceIMSyncRunsApi,
    WorkspaceLatestIMSyncRunApi,
    WorkspaceLatestIMSyncRunResultsApi,
)
from core.human_input_v2.contact_directory import Contact
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
    EncryptedCredentials,
    IMBinding,
    IMBindingCommandError,
    IMBindingCommandErrorCode,
    IMIdentity,
    IMIntegration,
    IMSyncRun,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
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
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
)
from repositories.human_input_v2.contact_directory.mappers import contact_to_record
from repositories.human_input_v2.im_integration.mappers import identity_to_record, integration_to_record
from repositories.human_input_v2.im_integration.unit_of_work import SQLAlchemyOrganizationIMWriteUnitOfWork
from services.human_input_v2.im_contact_sync.binding_service import ContactIMBindingService
from services.human_input_v2.im_contact_sync.errors import IMWriteUnavailableError
from services.human_input_v2.im_contact_sync.service import (
    IMIntegrationNotConfiguredError,
    IMSyncDispatchUnavailableError,
)

_CONTROLLER_MODULE = import_module("controllers.console.workspace.human_input")
_NOW = datetime(2026, 8, 11, 8)
_CONTACT_CREATED_AT = datetime(2025, 7, 10, 6)
_RUN = IMSyncRun.create(
    sync_run_id=IMSyncRunId("run-1"),
    integration_revision=IntegrationRevisionToken(IntegrationId("integration-1"), 3),
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
    def create_or_get_active_run(self, organization_scope, started_by_account_id):
        assert organization_scope == WorkspaceScope(id=TenantId("workspace-1"))
        assert started_by_account_id == AccountId("account-1")
        return _RUN

    def get_latest_run(self, organization_scope):
        assert organization_scope == WorkspaceScope(id=TenantId("workspace-1"))
        return _RUN

    def list_latest_results(self, organization_scope, result_type, *, page, limit):
        assert organization_scope == WorkspaceScope(id=TenantId("workspace-1"))
        assert result_type is IMSyncResultType.NOT_MATCHED
        assert (page, limit) == (1, 20)
        return SyncResultPage((_RESULT,), page=page, limit=limit, total=1)

    def search_identities(self, organization_scope, *, keyword, page, limit):
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
    binding = IMBinding.create(
        binding_id=IMBindingId(f"binding-{scope.value}"),
        integration_id=IntegrationId("integration-1"),
        scope=scope,
        scope_id="workspace-1" if scope is IMBindingScope.WORKSPACE else "integration-1",
        contact_id=ContactId("00000000-0000-0000-0000-000000000001"),
        identity_id=IMIdentityId("identity-1"),
        provider=IMProvider.FEISHU,
        bound_by_account_id=AccountId("account-1"),
        now=_NOW,
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
    def create_organization_binding(self, **kwargs):
        assert kwargs == {
            "organization_scope": WorkspaceScope(id=TenantId("workspace-1")),
            "tenant_id": TenantId("workspace-1"),
            "contact_id": ContactId("00000000-0000-0000-0000-000000000001"),
            "identity_id": IMIdentityId("identity-1"),
            "bound_by_account_id": AccountId("account-1"),
        }
        return _contact_view(IMBindingScope.ORGANIZATION)

    def delete_organization_binding(self, **kwargs):
        assert kwargs["binding_id"] == IMBindingId("binding-organization")

    def set_workspace_override(self, **_kwargs):
        return _contact_view(IMBindingScope.WORKSPACE)

    def reset_workspace_override(self, **_kwargs):
        return _contact_view(IMBindingScope.ORGANIZATION)


class _OwnedWriteLock:
    def __init__(self) -> None:
        self.held = False

    def __enter__(self):
        self.held = True
        return self

    def __exit__(self, *_unused: object) -> None:
        self.held = False

    def ensure_owned(self) -> None:
        if not self.held:
            raise RuntimeError("lock is not held")

    def extend(self) -> None:
        self.ensure_owned()


@pytest.fixture
def application(monkeypatch: pytest.MonkeyPatch):
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
    application,
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
        def create_or_get_active_run(self, _scope, _account_id):
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
def test_write_lock_unavailable_has_stable_retryable_http_mapping(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    command: str,
) -> None:
    error = IMWriteUnavailableError("IM write is temporarily unavailable")

    class SyncService:
        def create_or_get_active_run(self, _scope, _account_id):
            raise error

    class BindingService:
        def create_organization_binding(self, **_kwargs):
            raise error

        def set_workspace_override(self, **_kwargs):
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
        def list_latest_results(self, _scope, result_type, *, page, limit):
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
    application,
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


def test_organization_binding_controller_uses_sqlite_backed_guarded_service(
    app: Flask,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tables = [
        HumanInputContact.__table__,
        HumanInputIMIntegration.__table__,
        HumanInputIMIdentity.__table__,
        HumanInputIMBinding.__table__,
    ]
    HumanInputIMIntegration.metadata.create_all(sqlite_engine, tables=tables)
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    tenant_id = TenantId("workspace-1")
    contact_id = ContactId("00000000-0000-0000-0000-000000000001")
    integration = IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=tenant_id,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app-1", "encrypted_app_secret": "ciphertext"}
        ),
        configured_by_account_id=AccountId("account-1"),
        callback_url=None,
        now=_NOW,
    )
    contact = Contact.workspace_member(
        contact_id=contact_id,
        tenant_id=tenant_id,
        account_id=AccountId("account-1"),
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )
    identity = IMIdentity.create(
        identity_id=IMIdentityId("identity-1"),
        integration_id=integration.id,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email="reviewer@example.com",
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    with sessions.begin() as session:
        session.add_all(
            [
                integration_to_record(integration),
                contact_to_record(contact),
                identity_to_record(identity),
            ]
        )
    lock = _OwnedWriteLock()
    binding_service = ContactIMBindingService(
        lambda _scope: SQLAlchemyOrganizationIMWriteUnitOfWork(sessions, lock),
        binding_id_factory=lambda: IMBindingId("binding-organization"),
        clock=lambda: _NOW,
    )
    monkeypatch.setattr(
        _CONTROLLER_MODULE,
        "build_im_contact_sync_application",
        lambda: SimpleNamespace(binding_service=binding_service),
    )

    with app.test_request_context(method="PUT", json={"identity_id": "identity-1"}):
        response = unwrap(WorkspaceContactIMBindingsApi.put)(
            WorkspaceContactIMBindingsApi(),
            "workspace-1",
            SimpleNamespace(id="account-1"),
            str(contact_id),
        )

    assert response["contact"]["type"] == "workspace"
    assert response["contact"]["im_bindings"] == [
        {"id": "binding-organization", "provider": "feishu", "scope": "organization"}
    ]
    with sessions() as session:
        assert session.scalar(select(func.count(HumanInputIMBinding.id))) == 1


@pytest.mark.parametrize(
    ("error", "expected_status", "expected_code"),
    [
        (IMIntegrationNotConfiguredError("missing"), 404, "im_integration_not_configured"),
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
            def create_organization_binding(self, **_kwargs):
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
    else:

        class SyncService:
            def get_latest_run(self, _scope):
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
