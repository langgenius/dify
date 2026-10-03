"""Workspace machine-credential policies; storage owns sessions and transactions."""

from typing import Protocol

from constants.resource_access_token import ResourceAccessTokenResourceType
from machinery.context import RequestContext
from services.auth.resource_access_token_contracts import (
    ResourceAccessTokenAccess,
    ResourceAccessTokenCreateResult,
    ResourceAccessTokenForbiddenError,
    ResourceAccessTokenGrant,
    ResourceAccessTokenInputError,
    ResourceAccessTokenResource,
    ResourceAccessTokenRow,
)


class ResourceAccessTokenStore(Protocol):
    def create(
        self, tenant_id: str, created_by: str, name: str, resources: tuple[ResourceAccessTokenResource, ...]
    ) -> ResourceAccessTokenCreateResult: ...

    def list_rows(
        self, tenant_id: str, page: int, limit: int, keyword: str | None = None
    ) -> tuple[ResourceAccessTokenRow, ...]: ...

    def count_tokens(self, tenant_id: str, keyword: str | None = None) -> int: ...

    def update(
        self, tenant_id: str, token_id: str, name: str, resources: tuple[ResourceAccessTokenResource, ...] | None
    ) -> tuple[ResourceAccessTokenRow, ...]:
        """None preserves bindings; an explicit tuple replaces them atomically."""
        ...

    def delete(self, tenant_id: str, token_id: str, relation_id: str) -> None: ...

    def access_by_secret(self, token: str) -> ResourceAccessTokenAccess: ...

    def access_by_id(self, token_id: str) -> ResourceAccessTokenAccess: ...

    def record_usage(self, tenant_id: str, token_id: str) -> None: ...


class ResourceAccessTokenService:
    def __init__(self, *, tokens: ResourceAccessTokenStore) -> None:
        self._tokens = tokens

    def create(
        self, context: RequestContext, *, name: str, resources: tuple[ResourceAccessTokenResource, ...]
    ) -> ResourceAccessTokenCreateResult:
        return self._tokens.create(
            context.active_workspace_id, context.account_id, self._normalize_name(name), self._resources(resources)
        )

    def list_rows(
        self, context: RequestContext, *, page: int, limit: int, keyword: str | None = None
    ) -> tuple[ResourceAccessTokenRow, ...]:
        return self._tokens.list_rows(context.active_workspace_id, page, limit, keyword)

    def count_rows(self, context: RequestContext, *, keyword: str | None = None) -> int:
        return self._tokens.count_tokens(context.active_workspace_id, keyword)

    def update(
        self,
        context: RequestContext,
        *,
        token_id: str,
        name: str,
        resources: tuple[ResourceAccessTokenResource, ...] | None,
    ) -> tuple[ResourceAccessTokenRow, ...]:
        return self._tokens.update(
            context.active_workspace_id,
            token_id,
            self._normalize_name(name),
            self._resources(resources) if resources is not None else None,
        )

    def delete_relation(self, context: RequestContext, *, token_id: str, relation_id: str) -> None:
        # The existing endpoint revokes the whole token, including all its relations.
        self._tokens.delete(context.active_workspace_id, token_id, relation_id)

    def authenticate(self, token: str) -> ResourceAccessTokenAccess:
        return self._tokens.access_by_secret(token)

    def authorize_openapi(
        self, *, token_id: str, workspace_id: str | None, app_id: str | None
    ) -> ResourceAccessTokenGrant:
        """None ids mean the discovery route has not selected a workspace or app."""
        access = self._tokens.access_by_id(token_id)
        if not access.workspace_active:
            raise ResourceAccessTokenForbiddenError("workspace unavailable")
        if workspace_id and workspace_id != access.tenant_id:
            raise ResourceAccessTokenForbiddenError("resource_not_authorized")
        apps = tuple(r for r in access.resources if r.type == ResourceAccessTokenResourceType.APP and r.exists)
        if app_id and not any(r.id == app_id and r.enabled for r in apps):
            raise ResourceAccessTokenForbiddenError("resource_not_authorized")
        self._tokens.record_usage(access.tenant_id, access.token_id)
        return ResourceAccessTokenGrant(access.token_id, access.tenant_id, frozenset(r.id for r in apps))

    def resolve_app_for_service_api(self, *, token: str, requested_app_id: str | None) -> ResourceAccessTokenGrant:
        """With no app id, require exactly one bound app."""
        access = self._tokens.access_by_secret(token)
        apps = tuple(
            r
            for r in access.resources
            if r.type == ResourceAccessTokenResourceType.APP and (not requested_app_id or r.id == requested_app_id)
        )
        if not apps:
            raise ResourceAccessTokenForbiddenError("Resource access token is not allowed to access this app.")
        if len(apps) > 1:
            raise ResourceAccessTokenInputError(
                "App ID is required when a resource access token is bound to multiple apps."
            )
        if not apps[0].exists:
            raise ResourceAccessTokenForbiddenError("The app no longer exists.")
        self._tokens.record_usage(access.tenant_id, access.token_id)
        return ResourceAccessTokenGrant(access.token_id, access.tenant_id, frozenset({apps[0].id}))

    def resolve_tenant_for_dataset_service_api(self, *, token: str, dataset_id: str | None) -> str:
        """With no dataset id, authorize the collection route using any knowledge binding."""
        access = self._tokens.access_by_secret(token)
        if not any(
            r.type == ResourceAccessTokenResourceType.KNOWLEDGE and (not dataset_id or r.id == dataset_id)
            for r in access.resources
        ):
            raise ResourceAccessTokenForbiddenError(
                "Resource access token is not allowed to access this knowledge base."
            )
        self._tokens.record_usage(access.tenant_id, access.token_id)
        return access.tenant_id

    @staticmethod
    def _normalize_name(name: str) -> str:
        normalized = name.strip()
        if not normalized:
            raise ResourceAccessTokenInputError("Name is required.")
        return normalized

    @staticmethod
    def _resources(resources: tuple[ResourceAccessTokenResource, ...]) -> tuple[ResourceAccessTokenResource, ...]:
        if not resources:
            raise ResourceAccessTokenInputError("At least one resource is required.")
        return tuple(dict.fromkeys(resources))


class ResourceAccessTokenCleanupStore(Protocol):
    def delete_resource_relations(
        self, *, tenant_id: str, resource_type: ResourceAccessTokenResourceType, resource_id: str
    ) -> None:
        """Remove bindings and orphan tokens within the resource deletion transaction."""
        ...


class ResourceAccessTokenCleanupService:
    """Clean up credentials in the caller-owned resource deletion transaction."""

    def __init__(self, *, tokens: ResourceAccessTokenCleanupStore) -> None:
        self._tokens = tokens

    def delete_resource_relations(
        self, *, tenant_id: str, resource_type: ResourceAccessTokenResourceType, resource_id: str
    ) -> None:
        self._tokens.delete_resource_relations(
            tenant_id=tenant_id, resource_type=resource_type, resource_id=resource_id
        )
