from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import BadGateway, BadRequest, Conflict, Forbidden, HTTPException, NotFound, ServiceUnavailable

from controllers.console.app.error import AppNotFoundError
from controllers.console.workspace.network_access_group import (
    AppNetworkAccessGroupApi,
    AppNetworkAccessGroupUpdatePayload,
    CurrentWorkspaceNetworkAccessGroupApi,
    CurrentWorkspaceNetworkAccessGroupsApi,
    NetworkAccessGroupCreatePayload,
    NetworkAccessGroupDeleteQuery,
    NetworkAccessGroupUpdatePayload,
    _translate_service_error,
    _translate_upstream_error,
)
from machinery.context import RequestContext
from services.network_access_group_service import (
    NetworkAccessGroupAccessDeniedError,
    NetworkAccessGroupAppNotFoundError,
    NetworkAccessGroupEntitlementUnavailableError,
    NetworkAccessGroupError,
    NetworkAccessGroupUnsupportedAccessPointsError,
    NetworkAccessGroupUnsupportedAppModeError,
    NetworkAccessGroupUpstreamError,
)

TENANT_ID = "11111111-1111-4111-8111-111111111111"
ACCOUNT_ID = "22222222-2222-4222-8222-222222222222"
APP_ID = "33333333-3333-4333-8333-333333333333"
GROUP_ID = "44444444-4444-4444-8444-444444444444"
BINDING_ID = "55555555-5555-4555-8555-555555555555"


def _request_context() -> RequestContext:
    return RequestContext(
        request_id="request-id",
        trace_id=None,
        account_id=ACCOUNT_ID,
        active_workspace_id=TENANT_ID,
    )


@contextmanager
def _application_services(service: MagicMock) -> Generator[None]:
    with patch(
        "controllers.console.workspace.network_access_group.application_services",
        return_value=SimpleNamespace(network_access_groups=service),
    ):
        yield


def _group_payload(*, app_ids: list[str] | None = None) -> dict[str, object]:
    app_ids = app_ids or []
    return {
        "id": GROUP_ID,
        "tenantId": TENANT_ID,
        "name": "Office network",
        "description": "Reusable office egress addresses",
        "allowedCidrs": ["203.0.113.7/32"],
        "usedByCount": len(app_ids),
        "usedByAppIds": app_ids,
        "apps": [],
        "version": "2",
        "updatedByAccountId": ACCOUNT_ID,
        "createdAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
        "updatedAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
    }


def _binding_payload(
    *,
    enabled: bool = True,
    group_id: str | None = GROUP_ID,
    access_points: list[str] | None = None,
) -> dict[str, object]:
    return {
        "id": BINDING_ID,
        "tenantId": TENANT_ID,
        "appId": APP_ID,
        "enabled": enabled,
        "groupId": group_id,
        "accessPoints": ["webapp", "service_api"] if access_points is None else access_points,
        "version": "3",
        "updatedByAccountId": ACCOUNT_ID,
        "createdAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
        "updatedAt": datetime(2026, 8, 21, tzinfo=UTC).isoformat(),
    }


def test_list_forwards_request_context_and_serializes_response() -> None:
    service = MagicMock()
    service.list_groups.return_value = {
        "tenantId": TENANT_ID,
        "entitled": True,
        "groups": [_group_payload()],
    }
    api = CurrentWorkspaceNetworkAccessGroupsApi()

    with _application_services(service):
        result = unwrap(api.get)(api, request_context=_request_context())

    service.list_groups.assert_called_once_with(_request_context())
    assert result["tenant_id"] == TENANT_ID
    assert result["groups"][0]["version"] == 2
    assert result["groups"][0]["updated_at"] == "2026-08-21T00:00:00Z"


def test_create_forwards_payload_and_returns_201() -> None:
    service = MagicMock()
    service.create_group.return_value = {"group": _group_payload()}
    request_payload = NetworkAccessGroupCreatePayload(
        name="Office network",
        description="Reusable office egress addresses",
        allowed_cidrs=["203.0.113.7/32"],
    )
    api = CurrentWorkspaceNetworkAccessGroupsApi()

    with _application_services(service):
        body, status = unwrap(api.post)(
            api,
            req_data=request_payload,
            request_context=_request_context(),
        )

    service.create_group.assert_called_once_with(
        _request_context(),
        name="Office network",
        description="Reusable office egress addresses",
        allowed_cidrs=["203.0.113.7/32"],
    )
    assert status == 201
    assert body["group"]["id"] == GROUP_ID


def test_group_detail_update_and_delete_forward_path_and_query_values() -> None:
    service = MagicMock()
    service.get_group.return_value = {"group": _group_payload()}
    service.update_group.return_value = {"group": _group_payload()}
    service.delete_group.return_value = {"deleted": True}
    update_payload = NetworkAccessGroupUpdatePayload(
        name="Office network",
        description="Updated",
        allowed_cidrs=["203.0.113.0/24"],
        expected_version=1,
    )
    api = CurrentWorkspaceNetworkAccessGroupApi()

    with _application_services(service):
        get_result = unwrap(api.get)(api, request_context=_request_context(), group_id=UUID(GROUP_ID))
        update_result = unwrap(api.put)(
            api,
            req_data=update_payload,
            request_context=_request_context(),
            group_id=UUID(GROUP_ID),
        )
        delete_result = unwrap(api.delete)(
            api,
            req_data=NetworkAccessGroupDeleteQuery(expected_version=2),
            request_context=_request_context(),
            group_id=UUID(GROUP_ID),
        )

    service.get_group.assert_called_once_with(_request_context(), group_id=GROUP_ID)
    service.update_group.assert_called_once_with(
        _request_context(),
        group_id=GROUP_ID,
        name="Office network",
        description="Updated",
        allowed_cidrs=["203.0.113.0/24"],
        expected_version=1,
    )
    service.delete_group.assert_called_once_with(_request_context(), group_id=GROUP_ID, expected_version=2)
    assert get_result["group"]["id"] == GROUP_ID
    assert update_result["group"]["version"] == 2
    assert delete_result == {"deleted": True}


def test_app_get_and_put_forward_app_id_without_orm_models() -> None:
    service = MagicMock()
    service.get_app_binding.return_value = {
        "tenantId": TENANT_ID,
        "appId": APP_ID,
        "entitled": True,
        "available_access_points": ["webapp", "service_api", "mcp"],
        "binding": None,
    }
    service.update_app_binding.return_value = {
        "binding": _binding_payload(),
        "available_access_points": ["webapp", "service_api", "mcp"],
    }
    request_payload = AppNetworkAccessGroupUpdatePayload(
        enabled=True,
        group_id=GROUP_ID,
        access_points=["webapp", "service_api"],
        expected_version=2,
    )
    api = AppNetworkAccessGroupApi()

    with _application_services(service):
        get_result = unwrap(api.get)(api, request_context=_request_context(), app_id=UUID(APP_ID))
        put_result = unwrap(api.put)(
            api,
            req_data=request_payload,
            request_context=_request_context(),
            app_id=UUID(APP_ID),
        )

    service.get_app_binding.assert_called_once_with(_request_context(), app_id=APP_ID)
    service.update_app_binding.assert_called_once_with(
        _request_context(),
        app_id=APP_ID,
        enabled=True,
        group_id=GROUP_ID,
        access_points=["webapp", "service_api"],
        expected_version=2,
    )
    assert get_result["binding"] is None
    assert put_result["binding"]["version"] == 3


@pytest.mark.parametrize(
    ("status_code", "expected_exception"),
    [
        (400, BadRequest),
        (401, ServiceUnavailable),
        (403, Forbidden),
        (404, NotFound),
        (409, Conflict),
        (500, ServiceUnavailable),
        (418, BadGateway),
    ],
)
def test_upstream_error_mapping(status_code: int, expected_exception: type[HTTPException]) -> None:
    assert isinstance(_translate_upstream_error(NetworkAccessGroupUpstreamError(status_code)), expected_exception)


@pytest.mark.parametrize(
    ("reason", "expected_message"),
    [
        ("NETWORK_ACCESS_VERSION_CONFLICT", "changed"),
        ("NETWORK_ACCESS_GROUP_NAME_CONFLICT", "already exists"),
        ("NETWORK_ACCESS_GROUP_LIMIT", "reached"),
    ],
)
def test_conflict_error_mapping_preserves_safe_actionable_reason(reason: str, expected_message: str) -> None:
    error = _translate_upstream_error(NetworkAccessGroupUpstreamError(409, reason))
    assert isinstance(error, Conflict)
    assert error.description is not None
    assert expected_message in error.description


def test_internal_secret_error_is_not_reported_as_tenant_input_failure() -> None:
    assert isinstance(
        _translate_upstream_error(NetworkAccessGroupUpstreamError(400, "INVALID_SECRET_KEY")),
        ServiceUnavailable,
    )


@pytest.mark.parametrize(
    ("service_error", "expected_exception", "expected_message"),
    [
        (NetworkAccessGroupAccessDeniedError(), Forbidden, "owners and administrators"),
        (NetworkAccessGroupEntitlementUnavailableError(), ServiceUnavailable, "temporarily unavailable"),
        (NetworkAccessGroupAppNotFoundError(), AppNotFoundError, "not found"),
        (NetworkAccessGroupUnsupportedAppModeError("channel"), BadRequest, "channel"),
        (NetworkAccessGroupUnsupportedAccessPointsError(["trigger"]), BadRequest, "trigger"),
    ],
)
def test_application_error_mapping(
    service_error: NetworkAccessGroupError,
    expected_exception: type[HTTPException],
    expected_message: str,
) -> None:
    error = _translate_service_error(service_error)
    assert isinstance(error, expected_exception)
    assert error.description is not None
    assert expected_message in error.description.lower()


@pytest.mark.parametrize(
    "mutation",
    [
        CurrentWorkspaceNetworkAccessGroupsApi.post,
        CurrentWorkspaceNetworkAccessGroupApi.put,
        CurrentWorkspaceNetworkAccessGroupApi.delete,
        AppNetworkAccessGroupApi.put,
    ],
)
def test_mutation_paid_plan_admission_precedes_payload_validation(mutation: Callable[..., object]) -> None:
    app = Flask(__name__)
    paid_plan_wrapper = unwrap(mutation, stop=lambda candidate: candidate is not mutation)

    with (
        app.test_request_context(json={"name": "", "description": "", "allowed_cidrs": []}),
        patch(
            "controllers.console.wraps.current_account_with_tenant",
            return_value=(object(), TENANT_ID),
        ),
        patch(
            "controllers.console.wraps.is_cloud_edition_billing_paid_plan",
            return_value=False,
        ) as is_paid_plan,
        pytest.raises(HTTPException) as exc_info,
    ):
        paid_plan_wrapper(object())

    assert exc_info.value.code == 403
    is_paid_plan.assert_called_once_with(TENANT_ID)


def test_controller_maps_service_error_before_serialization() -> None:
    service = MagicMock()
    service.list_groups.side_effect = NetworkAccessGroupAccessDeniedError

    with _application_services(service), pytest.raises(Forbidden, match="owners and administrators"):
        unwrap(CurrentWorkspaceNetworkAccessGroupsApi().get)(
            CurrentWorkspaceNetworkAccessGroupsApi(),
            request_context=_request_context(),
        )


def test_invalid_service_response_is_bad_gateway() -> None:
    service = MagicMock()
    service.list_groups.return_value = {
        "tenant_id": TENANT_ID,
        "entitled": True,
        "groups": [{"allowed_cidrs": list[str]()}],
    }

    with _application_services(service), pytest.raises(BadGateway):
        unwrap(CurrentWorkspaceNetworkAccessGroupsApi().get)(
            CurrentWorkspaceNetworkAccessGroupsApi(),
            request_context=_request_context(),
        )


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "", "description": "", "allowed_cidrs": []},
        {"name": "group", "description": "", "allowed_cidrs": []},
        {"name": "group", "description": "", "allowed_cidrs": ["127.0.0.1"] * 101},
    ],
)
def test_create_payload_contract_rejects_invalid_shapes(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        NetworkAccessGroupCreatePayload.model_validate(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"enabled": True, "group_id": None, "access_points": ["webapp"], "expected_version": 0},
        {"enabled": True, "group_id": GROUP_ID, "access_points": [], "expected_version": 0},
        {
            "enabled": True,
            "group_id": GROUP_ID,
            "access_points": ["webapp", "webapp"],
            "expected_version": 0,
        },
        {"enabled": True, "group_id": GROUP_ID, "access_points": ["unknown"], "expected_version": 0},
    ],
)
def test_enabled_app_config_rejects_incomplete_or_invalid_access_points(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        AppNetworkAccessGroupUpdatePayload.model_validate(payload)


def test_app_config_accepts_policy_id_alias_and_disabled_draft() -> None:
    payload = AppNetworkAccessGroupUpdatePayload.model_validate(
        {
            "enabled": False,
            "policy_id": GROUP_ID,
            "accessPoints": ["webapp", "service_api"],
            "expected_version": 3,
        }
    )

    assert str(payload.group_id) == GROUP_ID
    assert payload.access_points == ["webapp", "service_api"]
