from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import UUID

import httpx
import pytest
from flask import Flask, Response
from pydantic import ValidationError
from werkzeug.exceptions import BadGateway, BadRequest, Conflict, Forbidden, HTTPException, NotFound, ServiceUnavailable
from werkzeug.test import TestResponse

from controllers.console.app.error import AppNotFoundError
from controllers.console.workspace.network_access_group import (
    AppNetworkAccessGroupApi,
    AppNetworkAccessGroupUpdatePayload,
    CurrentWorkspaceNetworkAccessGroupApi,
    CurrentWorkspaceNetworkAccessGroupCurrentIPApi,
    CurrentWorkspaceNetworkAccessGroupCurrentIPCheckApi,
    CurrentWorkspaceNetworkAccessGroupsApi,
    NetworkAccessGroupCreatePayload,
    NetworkAccessGroupCurrentIPResponse,
    NetworkAccessGroupDeleteQuery,
    NetworkAccessGroupUpdatePayload,
    _translate_service_error,
    _translate_upstream_error,
)
from core.network_access.client_ip import NetworkAccessClientIPUnavailableError
from enums import DeploymentEdition
from machinery.context import RequestContext
from services.entities.network_access_group_entities import (
    NetworkAccessAppConfig,
    NetworkAccessBinding,
    NetworkAccessBindingUpdate,
    NetworkAccessCurrentIPCheck,
    NetworkAccessGroup,
    NetworkAccessGroupList,
)
from services.network_access_group_gateway import NetworkAccessGroupGateway
from services.network_access_group_service import (
    NetworkAccessGroupAccessDeniedError,
    NetworkAccessGroupAppNotFoundError,
    NetworkAccessGroupAppRecord,
    NetworkAccessGroupEntitlementUnavailableError,
    NetworkAccessGroupError,
    NetworkAccessGroupInvalidPolicyError,
    NetworkAccessGroupInvalidResponseError,
    NetworkAccessGroupService,
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
def _application_services(service: MagicMock | NetworkAccessGroupService) -> Generator[None]:
    with patch(
        "controllers.console.workspace.network_access_group.application_services",
        return_value=SimpleNamespace(network_access_groups=service),
    ):
        yield


def _group_payload(*, app_ids: list[str] | None = None) -> NetworkAccessGroup:
    app_ids = app_ids or []
    return NetworkAccessGroup(
        id=GROUP_ID,
        tenant_id=TENANT_ID,
        name="Office network",
        description="Reusable office egress addresses",
        allowed_cidrs=("203.0.113.7/32",),
        used_by_count=len(app_ids),
        enforcing_count=0,
        app_ids=tuple(app_ids),
        version=2,
        updated_by_account_id=ACCOUNT_ID,
        created_at=datetime(2026, 8, 21, tzinfo=UTC),
        updated_at=datetime(2026, 8, 21, tzinfo=UTC),
    )


def _binding_payload(
    *,
    enabled: bool = True,
    group_id: str | None = GROUP_ID,
    access_points: list[str] | None = None,
) -> NetworkAccessBinding:
    return NetworkAccessBinding(
        id=BINDING_ID,
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        enabled=enabled,
        group_id=group_id,
        access_points=("webapp", "service_api") if access_points is None else tuple(access_points),
        version=3,
        updated_by_account_id=ACCOUNT_ID,
        created_at=datetime(2026, 8, 21, tzinfo=UTC),
        updated_at=datetime(2026, 8, 21, tzinfo=UTC),
    )


def test_list_forwards_request_context_and_serializes_response() -> None:
    service = MagicMock()
    service.list_groups.return_value = NetworkAccessGroupList(TENANT_ID, True, (_group_payload(),))
    api = CurrentWorkspaceNetworkAccessGroupsApi()

    with _application_services(service):
        result = unwrap(api.get)(api, request_context=_request_context())

    service.list_groups.assert_called_once_with(_request_context())
    assert result["tenant_id"] == TENANT_ID
    assert result["groups"][0]["version"] == 2
    assert result["groups"][0]["updated_at"] == "2026-08-21T00:00:00Z"


def test_create_forwards_payload_and_returns_201() -> None:
    service = MagicMock()
    service.create_group.return_value = _group_payload()
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
    service.get_group.return_value = _group_payload()
    service.update_group.return_value = _group_payload()
    service.delete_group.return_value = True
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
    service.get_app_binding.return_value = NetworkAccessAppConfig(
        TENANT_ID,
        APP_ID,
        True,
        False,
        None,
        ("webapp", "service_api", "mcp"),
    )
    service.update_app_binding.return_value = NetworkAccessBindingUpdate(
        _binding_payload(),
        True,
        ("webapp", "service_api", "mcp"),
    )
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
    assert get_result["effective_enabled"] is False
    assert put_result["binding"]["version"] == 3
    assert put_result["effective_enabled"] is True


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
        (NetworkAccessGroupAccessDeniedError(), Forbidden, "workspace role"),
        (NetworkAccessGroupEntitlementUnavailableError(), ServiceUnavailable, "temporarily unavailable"),
        (NetworkAccessGroupAppNotFoundError(), AppNotFoundError, "not found"),
        (NetworkAccessGroupUnsupportedAppModeError("channel"), BadRequest, "channel"),
        (NetworkAccessGroupUnsupportedAccessPointsError(["trigger"]), BadRequest, "trigger"),
        (NetworkAccessGroupInvalidPolicyError(), ServiceUnavailable, "cannot be evaluated"),
        (NetworkAccessGroupInvalidResponseError(), BadGateway, "invalid response"),
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

    with _application_services(service), pytest.raises(Forbidden, match="workspace role"):
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


def test_current_ip_check_uses_trusted_resolver_after_service_admission_and_disables_caching(
    config_overrides: Callable[..., None],
) -> None:
    app = Flask(__name__)
    service = MagicMock()
    config_overrides(NETWORK_ACCESS_TRUSTED_PROXY_CIDRS="172.18.0.0/16")

    def check_current_ip(
        _context: RequestContext,
        *,
        group_id: str,
        client_ip_supplier: Callable[[], str],
    ) -> NetworkAccessCurrentIPCheck:
        assert group_id == GROUP_ID
        return NetworkAccessCurrentIPCheck(client_ip_supplier(), True, 4)

    service.check_current_ip.side_effect = check_current_ip
    api = CurrentWorkspaceNetworkAccessGroupCurrentIPCheckApi()

    with (
        app.test_request_context(
            headers={"X-Forwarded-For": "203.0.113.7"},
            environ_base={"REMOTE_ADDR": "172.18.0.3"},
        ),
        _application_services(service),
        patch(
            "controllers.console.workspace.network_access_group.resolve_network_access_client_ip",
            return_value="203.0.113.7",
        ) as resolve_client_ip,
    ):
        result = unwrap(api.get)(api, request_context=_request_context(), group_id=UUID(GROUP_ID))
        response = app.process_response(app.make_response(result))

    assert result == {"client_ip": "203.0.113.7", "allowed": True, "policy_version": 4}
    assert response.headers["Cache-Control"] == "no-store"
    assert resolve_client_ip.call_args.args[1] == "172.18.0.0/16"


def test_current_ip_check_maps_unavailable_client_ip_to_503(config_overrides: Callable[..., None]) -> None:
    app = Flask(__name__)
    service = MagicMock()
    config_overrides(NETWORK_ACCESS_TRUSTED_PROXY_CIDRS="172.18.0.0/16")
    service.check_current_ip.side_effect = lambda _context, *, group_id, client_ip_supplier: (
        client_ip_supplier() if group_id == GROUP_ID else None
    )
    api = CurrentWorkspaceNetworkAccessGroupCurrentIPCheckApi()

    with (
        app.test_request_context(environ_base={"REMOTE_ADDR": "172.18.0.3"}),
        _application_services(service),
        patch(
            "controllers.console.workspace.network_access_group.resolve_network_access_client_ip",
            side_effect=NetworkAccessClientIPUnavailableError,
        ),
        pytest.raises(ServiceUnavailable, match="Current client IP is unavailable"),
    ):
        unwrap(api.get)(api, request_context=_request_context(), group_id=UUID(GROUP_ID))


def test_current_ip_check_fails_closed_when_trusted_proxy_config_is_empty(
    config_overrides: Callable[..., None],
) -> None:
    app = Flask(__name__)
    service = MagicMock()
    config_overrides(NETWORK_ACCESS_TRUSTED_PROXY_CIDRS="")
    service.check_current_ip.side_effect = lambda _context, *, group_id, client_ip_supplier: (
        client_ip_supplier() if group_id == GROUP_ID else None
    )
    api = CurrentWorkspaceNetworkAccessGroupCurrentIPCheckApi()

    with (
        app.test_request_context(environ_base={"REMOTE_ADDR": "172.18.0.3"}),
        _application_services(service),
        patch(
            "controllers.console.workspace.network_access_group.resolve_network_access_client_ip"
        ) as resolve_client_ip,
        pytest.raises(ServiceUnavailable, match="Current client IP is unavailable"),
    ):
        unwrap(api.get)(api, request_context=_request_context(), group_id=UUID(GROUP_ID))

    resolve_client_ip.assert_not_called()


def test_group_response_rejects_enforcing_count_greater_than_used_by_count() -> None:
    service = MagicMock()
    group = replace(_group_payload(app_ids=[APP_ID]), enforcing_count=2)
    service.list_groups.return_value = NetworkAccessGroupList(TENANT_ID, True, (group,))

    with _application_services(service), pytest.raises(BadGateway, match="Invalid response"):
        unwrap(CurrentWorkspaceNetworkAccessGroupsApi().get)(
            CurrentWorkspaceNetworkAccessGroupsApi(),
            request_context=_request_context(),
        )


@pytest.mark.parametrize(
    ("peer", "forwarded", "expected"),
    [
        ("172.18.0.3", "203.0.113.7", "203.0.113.7"),
        ("172.18.0.3", "2001:db8::42", "2001:db8::42"),
        ("172.18.0.3", "::ffff:203.0.113.7", "203.0.113.7"),
        ("203.0.113.7", "192.0.2.1", "203.0.113.7"),
        ("172.18.0.3", "192.0.2.1, 203.0.113.7, 172.18.0.4", "203.0.113.7"),
    ],
    ids=["ipv4", "ipv6", "mapped-ipv6", "untrusted-peer-spoof", "trusted-proxy-appended-peer"],
)
def test_current_ip_read_uses_trusted_resolver_and_ignores_client_supplied_ip(
    config_overrides: Callable[..., None],
    peer: str,
    forwarded: str,
    expected: str,
) -> None:
    app = Flask(__name__)
    service = MagicMock()
    config_overrides(NETWORK_ACCESS_TRUSTED_PROXY_CIDRS="172.18.0.0/16")
    service.get_current_ip.side_effect = lambda _context, *, client_ip_supplier: client_ip_supplier()
    api = CurrentWorkspaceNetworkAccessGroupCurrentIPApi()

    with (
        app.test_request_context(
            "/workspaces/current/network-access-groups/current-ip?client_ip=192.0.2.1&group_id=ignored",
            headers={
                "X-Forwarded-For": forwarded,
                "CF-Connecting-IP": "192.0.2.1",
                "X-Real-IP": "192.0.2.1",
                "Forwarded": "for=192.0.2.1",
            },
            json={"client_ip": "192.0.2.1"},
            environ_base={"REMOTE_ADDR": peer},
        ),
        _application_services(service),
    ):
        result = unwrap(api.get)(api, request_context=_request_context())
        response = app.process_response(app.make_response(result))

    assert result == {"client_ip": expected}
    assert response.headers["Cache-Control"] == "no-store"
    assert service.get_current_ip.call_args.args == (_request_context(),)
    assert set(service.get_current_ip.call_args.kwargs) == {"client_ip_supplier"}
    service.get_group.assert_not_called()


@pytest.mark.parametrize(
    ("trusted_proxies", "forwarded"),
    [
        ("", "203.0.113.7"),
        ("not-a-cidr", "203.0.113.7"),
        ("172.18.0.0/16", None),
        ("172.18.0.0/16", "malformed"),
        ("172.18.0.0/16", "172.18.0.4"),
    ],
    ids=["missing-proxy-config", "invalid-proxy-config", "missing-xff", "invalid-xff", "all-trusted-hops"],
)
def test_current_ip_read_fails_closed_with_no_store_on_503(
    config_overrides: Callable[..., None], trusted_proxies: str, forwarded: str | None
) -> None:
    app = Flask(__name__)
    service = MagicMock()
    config_overrides(NETWORK_ACCESS_TRUSTED_PROXY_CIDRS=trusted_proxies)
    service.get_current_ip.side_effect = lambda _context, *, client_ip_supplier: client_ip_supplier()
    api = CurrentWorkspaceNetworkAccessGroupCurrentIPApi()

    with (
        app.test_request_context(
            headers={"X-Forwarded-For": forwarded} if forwarded is not None else {},
            environ_base={"REMOTE_ADDR": "172.18.0.3"},
        ),
        _application_services(service),
    ):
        with pytest.raises(ServiceUnavailable, match="Current client IP is unavailable") as exc_info:
            unwrap(api.get)(api, request_context=_request_context())
        response = app.process_response(app.make_response(exc_info.value.get_response()))

    assert response.status_code == 503
    assert response.headers["Cache-Control"] == "no-store"


def test_current_ip_read_maps_role_denial_without_resolving_ip() -> None:
    app = Flask(__name__)
    service = MagicMock()
    service.get_current_ip.side_effect = NetworkAccessGroupAccessDeniedError
    api = CurrentWorkspaceNetworkAccessGroupCurrentIPApi()

    with (
        app.test_request_context(),
        _application_services(service),
        patch(
            "controllers.console.workspace.network_access_group.resolve_network_access_client_ip"
        ) as resolve_client_ip,
    ):
        with pytest.raises(Forbidden, match="workspace role") as exc_info:
            unwrap(api.get)(api, request_context=_request_context())
        response = app.process_response(app.make_response(exc_info.value.get_response()))

    resolve_client_ip.assert_not_called()
    assert response.status_code == 403
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("edition", [DeploymentEdition.COMMUNITY, DeploymentEdition.ENTERPRISE])
def test_current_ip_read_is_cloud_only(config_overrides: Callable[..., None], edition: DeploymentEdition) -> None:
    app = Flask(__name__)
    service = MagicMock()
    config_overrides(DEPLOYMENT_EDITION=edition)

    with app.test_request_context(), _application_services(service), pytest.raises(NotFound):
        CurrentWorkspaceNetworkAccessGroupCurrentIPApi().get()

    service.get_current_ip.assert_not_called()


def test_current_ip_read_requires_authenticated_account(config_overrides: Callable[..., None]) -> None:
    app = Flask(__name__)
    service = MagicMock()
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=False)
    login_manager = MagicMock()
    login_manager.unauthorized.return_value = Response(status=401)

    with (
        app.test_request_context(),
        _application_services(service),
        patch("libs.login._resolve_current_user", return_value=None),
        patch("libs.login._get_login_manager", return_value=login_manager),
    ):
        response = CurrentWorkspaceNetworkAccessGroupCurrentIPApi().get()

    assert isinstance(response, Response)
    assert response.status_code == 401
    service.get_current_ip.assert_not_called()


def test_current_ip_read_response_schema_exposes_only_client_ip() -> None:
    schema = NetworkAccessGroupCurrentIPResponse.model_json_schema(mode="serialization")

    assert schema["required"] == ["client_ip"]
    assert set(schema["properties"]) == {"client_ip"}
    assert schema["properties"]["client_ip"]["type"] == "string"


@pytest.mark.parametrize("group_field", ["group_id", "groupId", "policy_id", "policyId"])
@pytest.mark.parametrize("stale_only", [False, True])
def test_typed_gateway_service_controller_pipeline_preserves_binding_configuration(
    group_field: str, stale_only: bool
) -> None:
    wire = {
        "tenantId": TENANT_ID,
        "appId": APP_ID,
        "entitled": True,
        "effectiveEnabled": True,
        "binding": {
            "id": BINDING_ID,
            "tenantId": TENANT_ID,
            "appId": APP_ID,
            "enabled": True,
            group_field: GROUP_ID,
            "accessPoints": ["future_scope"] if stale_only else ["webapp"],
            "version": "3",
            "createdAt": "2026-08-21T00:00:00Z",
            "updatedAt": "2026-08-21T00:00:00Z",
        },
    }
    response = _typed_binding_http_response(wire)
    assert response.status_code == 200
    body = response.get_json()
    assert body["binding"]["enabled"] is True
    assert body["binding"]["group_id"] == GROUP_ID
    assert body["binding"]["version"] == 3
    assert body["binding"]["access_points"] == ([] if stale_only else ["webapp"])
    assert body["effective_enabled"] is not stale_only
    assert wire["binding"]["accessPoints"] == (["future_scope"] if stale_only else ["webapp"])


def test_malformed_upstream_response_maps_to_http_502_before_business_truthiness() -> None:
    response = _typed_binding_http_response(
        {
            "tenantId": TENANT_ID,
            "appId": APP_ID,
            "entitled": "false",
            "effectiveEnabled": False,
        }
    )
    assert response.status_code == 502


def _typed_binding_http_response(wire: Mapping[str, object]) -> TestResponse:
    app = Flask(__name__)
    app.testing = True
    apps, memberships, entitlement = MagicMock(), MagicMock(), MagicMock()
    apps.get_manageable_app.return_value = NetworkAccessGroupAppRecord(APP_ID, "workflow", "Test", None, None, None)
    memberships.get_role_for_account.return_value = "owner"
    entitlement.is_paid_plan.return_value = True
    with httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json=wire))) as client:
        gateway = NetworkAccessGroupGateway(
            base_url="https://test.invalid",
            fallback_base_url="",
            secret_key="synthetic",
            http_client=client,
        )
        service = NetworkAccessGroupService(
            control_plane=gateway, apps=apps, memberships=memberships, entitlement=entitlement
        )
        api = AppNetworkAccessGroupApi()

        @app.get("/binding")
        def binding() -> dict[str, object]:
            return unwrap(api.get)(api, request_context=_request_context(), app_id=UUID(APP_ID))

        with _application_services(service):
            return app.test_client().get("/binding")
