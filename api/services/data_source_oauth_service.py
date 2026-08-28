"""Application service for Console OAuth data-source use cases."""

from collections.abc import Mapping
from typing import Protocol

from machinery.context import RequestContext
from services.entities.data_source_oauth_entities import (
    DataSourceOAuthAuthorization,
    DataSourceOAuthBindingRecord,
    DataSourceOAuthCallback,
)


class DataSourceOAuthError(Exception):
    """Base error for an OAuth data-source use case."""


class InvalidDataSourceOAuthProviderError(DataSourceOAuthError):
    """Raised when the requested OAuth provider is not configured."""


class InvalidDataSourceOAuthCodeError(DataSourceOAuthError):
    """Raised when an authorization code is missing or invalid."""


class DataSourceOAuthConfigurationError(DataSourceOAuthError):
    """Raised when the configured OAuth flow cannot be started."""


class DataSourceProviderGateway(Protocol):
    def get_authorization_url(self) -> str: ...

    def authorize(self, code: str) -> DataSourceOAuthAuthorization: ...

    def authorize_internal(self, access_token: str, workspace_id: str) -> DataSourceOAuthAuthorization: ...

    def refresh(
        self,
        access_token: str,
        source_info: Mapping[str, object],
    ) -> Mapping[str, object]: ...


class DataSourceOAuthBindingRepository(Protocol):
    def upsert_authorization(
        self,
        *,
        workspace_id: str,
        provider: str,
        authorization: DataSourceOAuthAuthorization,
    ) -> None: ...

    def get_enabled(
        self,
        *,
        workspace_id: str,
        provider: str,
        binding_id: str,
    ) -> DataSourceOAuthBindingRecord | None: ...

    def update_source_info(
        self,
        *,
        workspace_id: str,
        provider: str,
        binding_id: str,
        source_info: Mapping[str, object],
    ) -> bool: ...


class DataSourceOAuthService:
    def __init__(
        self,
        *,
        provider_name: str,
        provider_gateway: DataSourceProviderGateway,
        bindings: DataSourceOAuthBindingRepository,
        is_internal_provider: bool = False,
        internal_access_token: str | None = None,
    ) -> None:
        self._provider_name = provider_name
        self._provider_gateway = provider_gateway
        self._bindings = bindings
        self._is_internal_provider = is_internal_provider
        self._internal_access_token = internal_access_token

    def start_authorization(self, context: RequestContext) -> str:
        if not self._is_internal_provider:
            return self._provider_gateway.get_authorization_url()

        access_token = self._internal_access_token
        if not access_token:
            raise DataSourceOAuthConfigurationError("Internal secret is not set")

        workspace_id = self._require_active_workspace(context)
        authorization = self._provider_gateway.authorize_internal(access_token, workspace_id)
        self._bindings.upsert_authorization(
            workspace_id=workspace_id,
            provider=self._provider_name,
            authorization=authorization,
        )
        return "internal"

    def complete_callback(self, *, code: str | None, error: str | None) -> DataSourceOAuthCallback:
        return DataSourceOAuthCallback(
            provider=self._provider_name,
            code=code,
            error=None if code is not None else error or "Access denied",
        )

    def bind(self, context: RequestContext, *, code: str) -> None:
        if not code:
            raise InvalidDataSourceOAuthCodeError("Invalid code")

        workspace_id = self._require_active_workspace(context)
        authorization = self._provider_gateway.authorize(code)
        self._bindings.upsert_authorization(
            workspace_id=workspace_id,
            provider=self._provider_name,
            authorization=authorization,
        )

    def sync(self, context: RequestContext, *, binding_id: str) -> None:
        workspace_id = self._require_active_workspace(context)
        binding = self._bindings.get_enabled(
            workspace_id=workspace_id,
            provider=self._provider_name,
            binding_id=binding_id,
        )
        if binding is None:
            raise DataSourceOAuthError("Data source binding not found")

        source_info = self._provider_gateway.refresh(binding.access_token, binding.source_info)
        updated = self._bindings.update_source_info(
            workspace_id=workspace_id,
            provider=self._provider_name,
            binding_id=binding.id,
            source_info=source_info,
        )
        if not updated:
            raise DataSourceOAuthError("Data source binding not found")

    @staticmethod
    def _require_active_workspace(context: RequestContext) -> str:
        workspace_id = context.active_workspace_id
        if workspace_id is None:
            raise RuntimeError("Console account admission did not resolve an active workspace")
        return workspace_id
