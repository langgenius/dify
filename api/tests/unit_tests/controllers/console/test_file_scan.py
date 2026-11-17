from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound

import controllers.console.file_scan as module
from controllers.console.file_scan import (
    DatasetFileScanPolicyApi,
    FileScanPolicyPayload,
    FileScanProviderApi,
    FileScanProviderCreatePayload,
    FileScanProvidersApi,
    FileScanProviderTestApi,
    FileScanProviderTypesApi,
    FileScanProviderUpdatePayload,
    KnowledgeFSFileScanPolicyApi,
)
from machinery.context import RequestContext
from models.file_scan import FileScanFallbackAction
from services.file_scan import (
    FileScanProviderInUseError,
    FileScanProviderNotFoundError,
    FileScanValidationError,
    ScanPolicy,
    ScanScope,
)
from services.file_scan.provider_service import FileScanProviderTypeView, FileScanProviderView
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission
from services.knowledge_fs.product_service import KnowledgeFSProductNotFoundError
from tests.helpers.unit.config_override import apply_config_overrides

TENANT_ID = "tenant-123"
ACCOUNT_ID = "account-123"
PROVIDER_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
DATASET_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
SPACE_ID = "33333333-3333-4333-8333-333333333333"


def unwrap(func: Callable[..., object]) -> Callable[..., object]:
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


_VIEW = FileScanProviderView(
    id=str(PROVIDER_ID),
    name="Company scanner",
    provider_type="scanii",
    config={"region": "eu1"},
    credentials_set={"api_key": True, "api_secret": True},
    status="active",
    last_error=None,
    last_tested_at=datetime(2026, 11, 11, 12, 0, tzinfo=UTC),
    created_at=datetime(2026, 11, 10, 12, 0, tzinfo=UTC),
    policy_count=2,
)


@dataclass(frozen=True, kw_only=True)
class _Features:
    enabled: bool


class _ControlPlane:
    """Records authorization requests and raises ``error`` when a test sets it."""

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.error: Exception | None = None

    def authorize_space(
        self, *, tenant_id: str, account_id: str, control_space_id: str, permission: KnowledgeFSProductPermission
    ) -> None:
        self.calls.append(
            {
                "tenant_id": tenant_id,
                "account_id": account_id,
                "control_space_id": control_space_id,
                "permission": permission,
            }
        )
        if self.error is not None:
            raise self.error


@dataclass
class _Runtime:
    control_plane: _ControlPlane = field(default_factory=_ControlPlane)


@pytest.fixture(autouse=True)
def _enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, FILE_SCAN_ENABLED=True)


@pytest.fixture
def request_context() -> RequestContext:
    return RequestContext(request_id="request-1", trace_id=None, account_id=ACCOUNT_ID, active_workspace_id=TENANT_ID)


@pytest.fixture
def providers() -> Iterator[MagicMock]:
    with patch.object(module, "FileScanProviderService") as service:
        yield service


@pytest.fixture
def policies() -> Iterator[MagicMock]:
    with patch.object(module, "FileScanPolicyService") as service:
        yield service.return_value


def test_every_route_is_hidden_while_the_deployment_switch_is_off(
    monkeypatch: pytest.MonkeyPatch, request_context: RequestContext, providers: MagicMock
) -> None:
    apply_config_overrides(monkeypatch, FILE_SCAN_ENABLED=False)

    calls: list[Callable[[], object]] = [
        lambda: unwrap(FileScanProviderTypesApi().get)(FileScanProviderTypesApi(), request_context),
        lambda: unwrap(FileScanProvidersApi().get)(FileScanProvidersApi(), request_context),
        lambda: unwrap(FileScanProviderApi().delete)(FileScanProviderApi(), request_context, PROVIDER_ID),
        lambda: unwrap(FileScanProviderTestApi().post)(FileScanProviderTestApi(), request_context, PROVIDER_ID),
        lambda: unwrap(DatasetFileScanPolicyApi().get)(DatasetFileScanPolicyApi(), request_context, DATASET_ID),
        lambda: unwrap(KnowledgeFSFileScanPolicyApi().get)(KnowledgeFSFileScanPolicyApi(), request_context, SPACE_ID),
    ]
    for call in calls:
        with pytest.raises(NotFound):
            call()
    providers.assert_not_called()


def test_provider_types_report_availability(request_context: RequestContext, providers: MagicMock) -> None:
    providers.provider_types.return_value = [
        FileScanProviderTypeView(provider_type="clamav", available=False, credential_fields=()),
        FileScanProviderTypeView(provider_type="scanii", available=True, credential_fields=("api_key", "api_secret")),
    ]

    response = unwrap(FileScanProviderTypesApi().get)(FileScanProviderTypesApi(), request_context)

    assert response == {
        "data": [
            {"provider_type": "clamav", "available": False, "credential_fields": []},
            {"provider_type": "scanii", "available": True, "credential_fields": ["api_key", "api_secret"]},
        ]
    }


def test_provider_list_and_create_never_return_secrets(request_context: RequestContext, providers: MagicMock) -> None:
    providers.return_value.list.return_value = [_VIEW]
    providers.return_value.create.return_value = replace(_VIEW, policy_count=0)

    listed = unwrap(FileScanProvidersApi().get)(FileScanProvidersApi(), request_context)
    payload = FileScanProviderCreatePayload(
        name="Company scanner",
        provider_type="scanii",
        config={"region": "eu1"},
        credentials={"api_key": "key", "api_secret": "top-secret"},
    )
    created = unwrap(FileScanProvidersApi().post)(FileScanProvidersApi(), payload, request_context)

    expected = {
        "id": str(PROVIDER_ID),
        "name": "Company scanner",
        "provider_type": "scanii",
        "config": {"region": "eu1"},
        "credentials_set": {"api_key": True, "api_secret": True},
        "status": "active",
        "last_error": None,
        "last_tested_at": int(datetime(2026, 11, 11, 12, 0, tzinfo=UTC).timestamp()),
        "created_at": int(datetime(2026, 11, 10, 12, 0, tzinfo=UTC).timestamp()),
        "policy_count": 2,
    }
    assert listed == {"data": [expected]}
    assert created == (expected | {"policy_count": 0}, 201)
    assert "top-secret" not in repr(created)
    providers.return_value.list.assert_called_once_with(tenant_id=TENANT_ID)
    providers.return_value.create.assert_called_once_with(
        tenant_id=TENANT_ID,
        account_id=ACCOUNT_ID,
        name="Company scanner",
        provider_type="scanii",
        config={"region": "eu1"},
        credentials={"api_key": "key", "api_secret": "top-secret"},
    )


def test_provider_errors_keep_their_readable_message(request_context: RequestContext, providers: MagicMock) -> None:
    service = providers.return_value
    service.create.side_effect = FileScanValidationError("The scanner check failed (auth): HTTP 401")
    payload = FileScanProviderCreatePayload(name="X", provider_type="cloudmersive", credentials={"api_key": "bad"})
    with pytest.raises(BadRequest, match="The scanner check failed"):
        unwrap(FileScanProvidersApi().post)(FileScanProvidersApi(), payload, request_context)

    service.update.side_effect = FileScanProviderNotFoundError()
    with pytest.raises(NotFound):
        unwrap(FileScanProviderApi().patch)(
            FileScanProviderApi(), FileScanProviderUpdatePayload(name="Y"), request_context, PROVIDER_ID
        )

    service.delete.side_effect = FileScanProviderInUseError("This scanner is selected by at least one knowledge base.")
    with pytest.raises(Conflict, match="selected by at least one"):
        unwrap(FileScanProviderApi().delete)(FileScanProviderApi(), request_context, PROVIDER_ID)

    service.test.return_value = replace(_VIEW, status="error", last_error="HTTP 401")
    tested = unwrap(FileScanProviderTestApi().post)(FileScanProviderTestApi(), request_context, PROVIDER_ID)
    assert isinstance(tested, dict)
    assert (tested["status"], tested["last_error"]) == ("error", "HTTP 401")


def test_dataset_policy_is_read_and_written_for_the_dataset_scope(
    request_context: RequestContext, policies: MagicMock
) -> None:
    stored = ScanPolicy(
        enabled=True,
        provider_id=str(PROVIDER_ID),
        on_unavailable=FileScanFallbackAction.ALLOW,
        on_unscannable=FileScanFallbackAction.BLOCK,
    )
    policies.get.return_value = stored
    policies.set.return_value = stored
    scope = ScanScope("dataset", str(DATASET_ID))

    with patch.object(module, "_dataset_scope", return_value=scope) as resolve:
        read = unwrap(DatasetFileScanPolicyApi().get)(DatasetFileScanPolicyApi(), request_context, DATASET_ID)
        payload = FileScanPolicyPayload(
            enabled=True, provider_id=str(PROVIDER_ID), on_unavailable=FileScanFallbackAction.ALLOW
        )
        written = unwrap(DatasetFileScanPolicyApi().put)(
            DatasetFileScanPolicyApi(), payload, request_context, DATASET_ID
        )

    expected = {
        "enabled": True,
        "provider_id": str(PROVIDER_ID),
        "on_unavailable": "allow",
        "on_unscannable": "block",
    }
    assert read == written == expected
    assert resolve.call_count == 2
    policies.get.assert_called_once_with(tenant_id=TENANT_ID, scope=scope)
    policies.set.assert_called_once_with(tenant_id=TENANT_ID, scope=scope, policy=stored, account_id=ACCOUNT_ID)


def test_policy_validation_error_is_a_bad_request(request_context: RequestContext, policies: MagicMock) -> None:
    policies.set.side_effect = FileScanValidationError("Choose a scanner before turning on the malware scan.")

    with patch.object(module, "_dataset_scope", return_value=ScanScope("dataset", str(DATASET_ID))):
        with pytest.raises(BadRequest, match="Choose a scanner"):
            unwrap(DatasetFileScanPolicyApi().put)(
                DatasetFileScanPolicyApi(), FileScanPolicyPayload(enabled=True), request_context, DATASET_ID
            )


def test_dataset_scope_rejects_a_dataset_the_workspace_does_not_own(
    request_context: RequestContext, policies: MagicMock
) -> None:
    policies.dataset_scope.return_value = None

    with pytest.raises(NotFound):
        module._dataset_scope(request_context, DATASET_ID)

    policies.dataset_scope.assert_called_once_with(tenant_id=TENANT_ID, dataset_id=str(DATASET_ID))


def test_knowledge_fs_policy_uses_the_space_permissions(request_context: RequestContext, policies: MagicMock) -> None:
    policies.get.return_value = ScanPolicy()
    policies.set.return_value = ScanPolicy()
    runtime = _Runtime()
    with (
        patch.object(module, "get_knowledge_fs_features", return_value=_Features(enabled=True)),
        patch.object(module, "get_knowledge_fs_runtime", return_value=runtime),
        patch.object(module.session_factory, "get_session_maker"),
    ):
        read = unwrap(KnowledgeFSFileScanPolicyApi().get)(KnowledgeFSFileScanPolicyApi(), request_context, SPACE_ID)
        unwrap(KnowledgeFSFileScanPolicyApi().put)(
            KnowledgeFSFileScanPolicyApi(), FileScanPolicyPayload(enabled=False), request_context, SPACE_ID
        )

        assert [call["permission"] for call in runtime.control_plane.calls] == [
            KnowledgeFSProductPermission.READ,
            KnowledgeFSProductPermission.EDIT,
        ]
        assert runtime.control_plane.calls[-1] == {
            "tenant_id": TENANT_ID,
            "account_id": ACCOUNT_ID,
            "control_space_id": SPACE_ID,
            "permission": KnowledgeFSProductPermission.EDIT,
        }
        assert read == {"enabled": False, "provider_id": None, "on_unavailable": "block", "on_unscannable": "block"}
        policies.set.assert_called_once()
        assert policies.set.call_args.kwargs["scope"] == ScanScope("knowledge_fs_space", SPACE_ID)

        runtime.control_plane.error = PermissionError()
        with pytest.raises(Forbidden):
            unwrap(KnowledgeFSFileScanPolicyApi().put)(
                KnowledgeFSFileScanPolicyApi(), FileScanPolicyPayload(enabled=False), request_context, SPACE_ID
            )
        runtime.control_plane.error = KnowledgeFSProductNotFoundError()
        with pytest.raises(NotFound):
            unwrap(KnowledgeFSFileScanPolicyApi().get)(KnowledgeFSFileScanPolicyApi(), request_context, SPACE_ID)

    with patch.object(module, "get_knowledge_fs_features", return_value=_Features(enabled=False)):
        with pytest.raises(NotFound):
            unwrap(KnowledgeFSFileScanPolicyApi().get)(KnowledgeFSFileScanPolicyApi(), request_context, SPACE_ID)
