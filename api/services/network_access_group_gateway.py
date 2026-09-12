"""HTTP and Billing adapters used by the network access group service."""

import json
from typing import Any, Literal, override

import httpx
from pydantic import ValidationError
from tenacity import retry, retry_if_exception_type, stop_before_delay, wait_fixed

from core.helper.http_client_pooling import get_pooled_http_client
from enums import CloudPlan
from services.billing_service import BillingService, _BillingHTTPStatusError
from services.network_access_group_service import (
    NetworkAccessGroupControlPlane,
    NetworkAccessGroupEntitlement,
    NetworkAccessGroupEntitlementUnavailableError,
    NetworkAccessGroupUpstreamError,
)

_http_client: httpx.Client = get_pooled_http_client(
    "network-access-group:default",
    lambda: httpx.Client(
        timeout=httpx.Timeout(30.0, connect=5.0),
        limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
    ),
)


class NetworkAccessGroupGateway(NetworkAccessGroupControlPlane):
    def __init__(
        self,
        *,
        base_url: str,
        fallback_base_url: str,
        secret_key: str,
        http_client: httpx.Client = _http_client,
    ) -> None:
        self._base_url = base_url.strip() or fallback_base_url
        self._secret_key = secret_key
        self._http_client = http_client

    @override
    def list_groups(self, workspace_id: str, actor_account_id: str) -> dict[str, Any]:
        return self._send_request(
            "GET",
            f"/tenants/{workspace_id}/network-access-groups",
            params={"actor_account_id": actor_account_id},
        )

    @override
    def create_group(
        self,
        workspace_id: str,
        *,
        name: str,
        description: str,
        allowed_cidrs: list[str],
        actor_account_id: str,
    ) -> dict[str, Any]:
        return self._send_request(
            "POST",
            f"/tenants/{workspace_id}/network-access-groups",
            payload_json={
                "name": name,
                "description": description,
                "allowed_cidrs": allowed_cidrs,
                "actor_account_id": actor_account_id,
            },
        )

    @override
    def get_group(self, workspace_id: str, group_id: str, actor_account_id: str) -> dict[str, Any]:
        return self._send_request(
            "GET",
            f"/tenants/{workspace_id}/network-access-groups/{group_id}",
            params={"actor_account_id": actor_account_id},
        )

    @override
    def update_group(
        self,
        workspace_id: str,
        group_id: str,
        *,
        name: str,
        description: str,
        allowed_cidrs: list[str],
        expected_version: int,
        actor_account_id: str,
    ) -> dict[str, Any]:
        return self._send_request(
            "PUT",
            f"/tenants/{workspace_id}/network-access-groups/{group_id}",
            payload_json={
                "name": name,
                "description": description,
                "allowed_cidrs": allowed_cidrs,
                "expected_version": expected_version,
                "actor_account_id": actor_account_id,
            },
        )

    @override
    def delete_group(
        self,
        workspace_id: str,
        group_id: str,
        *,
        expected_version: int,
        actor_account_id: str,
    ) -> dict[str, Any]:
        return self._send_request(
            "DELETE",
            f"/tenants/{workspace_id}/network-access-groups/{group_id}",
            params={
                "expected_version": expected_version,
                "actor_account_id": actor_account_id,
            },
        )

    @override
    def get_app_binding(self, workspace_id: str, app_id: str, actor_account_id: str) -> dict[str, Any]:
        return self._send_request(
            "GET",
            f"/tenants/{workspace_id}/apps/{app_id}/network-access-group",
            params={"actor_account_id": actor_account_id},
        )

    @override
    def update_app_binding(
        self,
        workspace_id: str,
        app_id: str,
        *,
        enabled: bool,
        group_id: str | None,
        access_points: list[str],
        expected_version: int,
        actor_account_id: str,
    ) -> dict[str, Any]:
        return self._send_request(
            "PUT",
            f"/tenants/{workspace_id}/apps/{app_id}/network-access-group",
            payload_json={
                "enabled": enabled,
                "group_id": group_id,
                "access_points": access_points,
                "expected_version": expected_version,
                "actor_account_id": actor_account_id,
            },
        )

    @override
    def cleanup_app_binding(self, workspace_id: str, app_id: str) -> dict[str, Any]:
        return self._send_request(
            "DELETE",
            f"/tenants/{workspace_id}/apps/{app_id}/network-access-group-binding",
        )

    def _send_request(
        self,
        method: Literal["GET", "POST", "PUT", "DELETE"],
        endpoint: str,
        *,
        payload_json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            response = self._send_http_request(
                method,
                endpoint,
                payload_json=payload_json,
                params=params,
            )
        except httpx.RequestError as exc:
            raise NetworkAccessGroupUpstreamError(httpx.codes.SERVICE_UNAVAILABLE) from exc

        if response.status_code not in (httpx.codes.OK, httpx.codes.CREATED):
            reason = None
            try:
                error_payload = response.json()
                if isinstance(error_payload, dict) and isinstance(error_payload.get("reason"), str):
                    reason = error_payload["reason"]
            except (json.JSONDecodeError, TypeError, ValueError):
                pass
            raise NetworkAccessGroupUpstreamError(response.status_code, reason)

        try:
            payload = response.json()
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            raise NetworkAccessGroupUpstreamError(httpx.codes.BAD_GATEWAY) from exc

        if not isinstance(payload, dict):
            raise NetworkAccessGroupUpstreamError(httpx.codes.BAD_GATEWAY)
        return payload

    @retry(
        wait=wait_fixed(2),
        stop=stop_before_delay(10),
        retry=retry_if_exception_type(httpx.RequestError),
        reraise=True,
    )
    def _send_http_request(
        self,
        method: Literal["GET", "POST", "PUT", "DELETE"],
        endpoint: str,
        *,
        payload_json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        headers = {"Content-Type": "application/json", "Billing-Api-Secret-Key": self._secret_key}
        return self._http_client.request(
            method,
            f"{self._base_url.rstrip('/')}{endpoint}",
            json=payload_json,
            params=params,
            headers=headers,
            follow_redirects=True,
        )


class BillingNetworkAccessGroupEntitlementGateway(NetworkAccessGroupEntitlement):
    @override
    def is_paid_plan(self, workspace_id: str) -> bool:
        try:
            billing_info = BillingService.get_info(workspace_id, exclude_vector_space=True)
        except (
            httpx.RequestError,
            json.JSONDecodeError,
            UnicodeDecodeError,
            ValidationError,
            _BillingHTTPStatusError,
        ) as exc:
            raise NetworkAccessGroupEntitlementUnavailableError from exc
        return billing_info["subscription"]["plan"] in (CloudPlan.PROFESSIONAL, CloudPlan.TEAM)
