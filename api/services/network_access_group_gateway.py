"""HTTP and Billing adapters used by the network access group service."""

import json
import re
from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, ClassVar, Literal, override

import httpx
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictBool,
    StrictStr,
    ValidationError,
    model_validator,
)
from tenacity import retry, retry_if_exception_type, stop_before_delay, wait_fixed

from core.helper.http_client_pooling import get_pooled_http_client
from enums import CloudPlan
from services.billing_service import BillingService, _BillingHTTPStatusError
from services.entities.network_access_group_entities import (
    NetworkAccessAppConfig,
    NetworkAccessBinding,
    NetworkAccessBindingUpdate,
    NetworkAccessGroup,
    NetworkAccessGroupList,
)
from services.network_access_group_service import (
    NetworkAccessGroupControlPlane,
    NetworkAccessGroupEntitlement,
    NetworkAccessGroupEntitlementUnavailableError,
    NetworkAccessGroupInvalidResponseError,
    NetworkAccessGroupUpstreamError,
)


def _int64(value: object) -> int:
    if type(value) is int:
        return value
    if isinstance(value, str) and re.fullmatch(r"[+-]?[0-9]+", value):
        return int(value)
    raise ValueError("Expected a ProtoJSON integer or decimal string")


_Count = Annotated[int, BeforeValidator(_int64), Field(ge=0, le=2**63 - 1)]
_Version = Annotated[int, BeforeValidator(_int64), Field(ge=1, le=2**63 - 1)]
_Identifier = Annotated[StrictStr, Field(min_length=1)]


class _WireModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")
    aliases: ClassVar[Mapping[str, tuple[str, ...]]] = {}

    @model_validator(mode="before")
    @classmethod
    def canonical_names(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        for name, aliases in cls.aliases.items():
            supplied = [data[key] for key in (name, *aliases) if key in data]
            if not supplied:
                continue
            if any(type(item) is not type(supplied[0]) or item != supplied[0] for item in supplied[1:]):
                raise ValueError(f"Conflicting aliases for {name}")
            data[name] = supplied[0]
            for alias in aliases:
                data.pop(alias, None)
        return data


class _GroupWire(_WireModel):
    aliases = {
        "tenant_id": ("tenantId",),
        "allowed_cidrs": ("allowedCidrs",),
        "used_by_count": ("usedByCount",),
        "enforcing_count": ("enforcingCount",),
        "app_ids": ("appIds", "used_by_app_ids", "usedByAppIds"),
        "updated_by_account_id": ("updatedByAccountId",),
        "created_at": ("createdAt",),
        "updated_at": ("updatedAt",),
    }
    id: _Identifier
    tenant_id: _Identifier
    name: StrictStr
    description: StrictStr = ""
    allowed_cidrs: Annotated[tuple[StrictStr, ...], Field(min_length=1, max_length=100)]
    version: _Version
    used_by_count: _Count | None = None
    enforcing_count: _Count = 0
    app_ids: tuple[_Identifier, ...] = ()
    updated_by_account_id: StrictStr | None = None
    created_at: datetime
    updated_at: datetime

    def record(self) -> NetworkAccessGroup:
        return NetworkAccessGroup(
            id=self.id,
            tenant_id=self.tenant_id,
            name=self.name,
            description=self.description,
            allowed_cidrs=self.allowed_cidrs,
            version=self.version,
            used_by_count=len(self.app_ids) if self.used_by_count is None else self.used_by_count,
            enforcing_count=self.enforcing_count,
            app_ids=self.app_ids,
            updated_by_account_id=self.updated_by_account_id,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


class _BindingWire(_WireModel):
    aliases = {
        "tenant_id": ("tenantId",),
        "app_id": ("appId",),
        "group_id": ("groupId", "policy_id", "policyId"),
        "access_points": ("accessPoints",),
        "updated_by_account_id": ("updatedByAccountId",),
        "created_at": ("createdAt",),
        "updated_at": ("updatedAt",),
    }
    id: _Identifier
    tenant_id: _Identifier
    app_id: _Identifier
    enabled: StrictBool = False
    group_id: StrictStr | None = None
    access_points: tuple[StrictStr, ...] = ()
    version: _Version
    updated_by_account_id: StrictStr | None = None
    created_at: datetime
    updated_at: datetime

    def record(self) -> NetworkAccessBinding:
        return NetworkAccessBinding(
            id=self.id,
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            enabled=self.enabled,
            group_id=self.group_id or None,
            access_points=self.access_points,
            version=self.version,
            updated_by_account_id=self.updated_by_account_id,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


class _GroupResultWire(_WireModel):
    group: _GroupWire


class _ListWire(_WireModel):
    aliases = {"tenant_id": ("tenantId",)}
    tenant_id: _Identifier
    entitled: StrictBool = False
    groups: tuple[_GroupWire, ...] = ()


class _AppConfigWire(_WireModel):
    aliases = {"tenant_id": ("tenantId",), "app_id": ("appId",), "effective_enabled": ("effectiveEnabled",)}
    tenant_id: _Identifier
    app_id: _Identifier
    entitled: StrictBool = False
    effective_enabled: StrictBool = False
    binding: _BindingWire | None = None


class _BindingUpdateWire(_WireModel):
    aliases = {"effective_enabled": ("effectiveEnabled",)}
    binding: _BindingWire
    effective_enabled: StrictBool = False


class _DeletedWire(_WireModel):
    deleted: StrictBool = False


def _decode[T: _WireModel](model: type[T], value: dict[str, Any]) -> T:
    try:
        return model.model_validate(value)
    except ValidationError as exc:
        raise NetworkAccessGroupInvalidResponseError from exc


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
    def list_groups(self, workspace_id: str, actor_account_id: str) -> NetworkAccessGroupList:
        wire = _decode(
            _ListWire,
            self._send_request(
                "GET",
                f"/tenants/{workspace_id}/network-access-groups",
                params={"actor_account_id": actor_account_id},
            ),
        )
        return NetworkAccessGroupList(wire.tenant_id, wire.entitled, tuple(group.record() for group in wire.groups))

    @override
    def create_group(
        self,
        workspace_id: str,
        *,
        name: str,
        description: str,
        allowed_cidrs: list[str],
        actor_account_id: str,
    ) -> NetworkAccessGroup:
        return _decode(
            _GroupResultWire,
            self._send_request(
                "POST",
                f"/tenants/{workspace_id}/network-access-groups",
                payload_json={
                    "name": name,
                    "description": description,
                    "allowed_cidrs": allowed_cidrs,
                    "actor_account_id": actor_account_id,
                },
            ),
        ).group.record()

    @override
    def get_group(self, workspace_id: str, group_id: str, actor_account_id: str) -> NetworkAccessGroup:
        return _decode(
            _GroupResultWire,
            self._send_request(
                "GET",
                f"/tenants/{workspace_id}/network-access-groups/{group_id}",
                params={"actor_account_id": actor_account_id},
            ),
        ).group.record()

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
    ) -> NetworkAccessGroup:
        return _decode(
            _GroupResultWire,
            self._send_request(
                "PUT",
                f"/tenants/{workspace_id}/network-access-groups/{group_id}",
                payload_json={
                    "name": name,
                    "description": description,
                    "allowed_cidrs": allowed_cidrs,
                    "expected_version": expected_version,
                    "actor_account_id": actor_account_id,
                },
            ),
        ).group.record()

    @override
    def delete_group(
        self,
        workspace_id: str,
        group_id: str,
        *,
        expected_version: int,
        actor_account_id: str,
    ) -> bool:
        return _decode(
            _DeletedWire,
            self._send_request(
                "DELETE",
                f"/tenants/{workspace_id}/network-access-groups/{group_id}",
                params={
                    "expected_version": expected_version,
                    "actor_account_id": actor_account_id,
                },
            ),
        ).deleted

    @override
    def get_app_binding(self, workspace_id: str, app_id: str, actor_account_id: str) -> NetworkAccessAppConfig:
        wire = _decode(
            _AppConfigWire,
            self._send_request(
                "GET",
                f"/tenants/{workspace_id}/apps/{app_id}/network-access-group",
                params={"actor_account_id": actor_account_id},
            ),
        )
        return NetworkAccessAppConfig(
            wire.tenant_id,
            wire.app_id,
            wire.entitled,
            wire.effective_enabled,
            wire.binding.record() if wire.binding is not None else None,
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
    ) -> NetworkAccessBindingUpdate:
        wire = _decode(
            _BindingUpdateWire,
            self._send_request(
                "PUT",
                f"/tenants/{workspace_id}/apps/{app_id}/network-access-group",
                payload_json={
                    "enabled": enabled,
                    "group_id": group_id,
                    "access_points": access_points,
                    "expected_version": expected_version,
                    "actor_account_id": actor_account_id,
                },
            ),
        )
        return NetworkAccessBindingUpdate(wire.binding.record(), wire.effective_enabled)

    @override
    def cleanup_app_binding(self, workspace_id: str, app_id: str) -> bool:
        return _decode(
            _DeletedWire,
            self._send_request(
                "DELETE",
                f"/tenants/{workspace_id}/apps/{app_id}/network-access-group-binding",
            ),
        ).deleted

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
            raise NetworkAccessGroupInvalidResponseError from exc

        if not isinstance(payload, dict):
            raise NetworkAccessGroupInvalidResponseError
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
