from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from werkzeug.exceptions import BadGateway, BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from controllers.console.workspace.network_access_policy import (
    CurrentWorkspaceNetworkAccessPolicyApi,
    NetworkAccessPolicyPayload,
    _translate_upstream_error,
)
from services.billing_service import BillingService, NetworkAccessPolicyUpstreamError


def _policy_payload() -> dict:
    return {
        "scope": "service_api",
        "mode": "enforce",
        "allowedCidrs": ["203.0.113.7/32"],
        "version": "2",
        "updatedByAccountId": "account-1",
        "createdAt": datetime(2026, 8, 20, tzinfo=UTC).isoformat(),
        "updatedAt": datetime(2026, 8, 20, tzinfo=UTC).isoformat(),
    }


def test_get_authorizes_and_forwards_tenant_and_actor():
    api = CurrentWorkspaceNetworkAccessPolicyApi()
    method = unwrap(api.get)
    current_user = SimpleNamespace(id="account-1")
    upstream_payload = {"tenantId": "tenant-1", "entitled": True, "policies": [_policy_payload()]}

    with (
        patch("controllers.console.workspace.network_access_policy.db") as db,
        patch.object(BillingService, "is_tenant_owner_or_admin") as authorize,
        patch.object(BillingService, "get_network_access_policies", return_value=upstream_payload) as get_policies,
    ):
        result = method(api, current_tenant_id="tenant-1", current_user=current_user)

    authorize.assert_called_once_with(current_user, session=db.session())
    get_policies.assert_called_once_with("tenant-1", "account-1")
    assert result["tenant_id"] == "tenant-1"
    assert result["policies"][0]["scope"] == "service_api"
    assert result["policies"][0]["updated_at"] == "2026-08-20T00:00:00Z"


def test_put_injects_actor_and_does_not_accept_it_from_payload():
    api = CurrentWorkspaceNetworkAccessPolicyApi()
    method = unwrap(api.put)
    current_user = SimpleNamespace(id="account-1")
    request_payload = NetworkAccessPolicyPayload(
        scope="service_api",
        mode="enforce",
        allowed_cidrs=["203.0.113.7/32"],
        expected_version=1,
    )

    with (
        patch("controllers.console.workspace.network_access_policy.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin"),
        patch.object(
            BillingService,
            "update_network_access_policy",
            return_value={"policy": _policy_payload()},
        ) as update_policy,
    ):
        result = method(
            api,
            req_data=request_payload,
            current_tenant_id="tenant-1",
            current_user=current_user,
        )

    update_policy.assert_called_once_with(
        "tenant-1",
        "service_api",
        mode="enforce",
        allowed_cidrs=["203.0.113.7/32"],
        expected_version=1,
        actor_account_id="account-1",
    )
    assert result["policy"]["version"] == 2


def test_get_rejects_non_privileged_workspace_member_before_upstream_call():
    api = CurrentWorkspaceNetworkAccessPolicyApi()
    method = unwrap(api.get)
    current_user = SimpleNamespace(id="account-1")

    with (
        patch("controllers.console.workspace.network_access_policy.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin", side_effect=ValueError("not privileged")),
        patch.object(BillingService, "get_network_access_policies") as get_policies,
        pytest.raises(Forbidden),
    ):
        method(api, current_tenant_id="tenant-1", current_user=current_user)

    get_policies.assert_not_called()


@pytest.mark.parametrize(
    ("status_code", "expected_exception"),
    [
        (400, BadRequest),
        (403, Forbidden),
        (404, NotFound),
        (409, Conflict),
        (500, ServiceUnavailable),
        (418, BadGateway),
    ],
)
def test_upstream_error_mapping(status_code, expected_exception):
    assert isinstance(_translate_upstream_error(NetworkAccessPolicyUpstreamError(status_code)), expected_exception)


def test_get_maps_invalid_upstream_contract_to_bad_gateway():
    api = CurrentWorkspaceNetworkAccessPolicyApi()
    method = unwrap(api.get)
    current_user = SimpleNamespace(id="account-1")

    with (
        patch("controllers.console.workspace.network_access_policy.db"),
        patch.object(BillingService, "is_tenant_owner_or_admin"),
        patch.object(
            BillingService,
            "get_network_access_policies",
            return_value={"tenant_id": "tenant-1", "entitled": True, "policies": [{"mode": "disabled"}]},
        ),
        pytest.raises(BadGateway),
    ):
        method(api, current_tenant_id="tenant-1", current_user=current_user)


@pytest.mark.parametrize(
    "payload",
    [
        {"scope": "unknown", "mode": "disabled", "allowed_cidrs": [], "expected_version": 0},
        {"scope": "mcp", "mode": "unknown", "allowed_cidrs": [], "expected_version": 0},
        {"scope": "mcp", "mode": "disabled", "allowed_cidrs": [], "expected_version": -1},
        {"scope": "mcp", "mode": "disabled", "allowed_cidrs": ["127.0.0.1"] * 101, "expected_version": 0},
    ],
)
def test_payload_contract_rejects_invalid_shapes(payload):
    with pytest.raises(ValidationError):
        NetworkAccessPolicyPayload.model_validate(payload)
