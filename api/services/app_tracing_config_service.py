"""Application boundary for app tracing provider configurations."""

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Protocol

from machinery.context import RequestContext


@dataclass(frozen=True, slots=True)
class AppTracingConfigRecord:
    id: str
    app_id: str
    tracing_provider: str | None
    tracing_config: dict[str, Any] | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class AppTracingConfigStore(Protocol):
    def get(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
    ) -> AppTracingConfigRecord | None: ...

    def create(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
    ) -> bool: ...

    def update(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
    ) -> bool: ...

    def delete(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
    ) -> bool: ...


class TracingConfigProviderGateway(Protocol):
    def validate_provider(self, tracing_provider: str) -> None: ...

    def prepare_new_config(
        self,
        *,
        workspace_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
    ) -> dict[str, Any]: ...

    def prepare_updated_config(
        self,
        *,
        workspace_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
        current_tracing_config: dict[str, Any] | None,
    ) -> dict[str, Any]: ...

    def present_config(
        self,
        *,
        workspace_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any] | None,
    ) -> dict[str, Any]: ...


class AppTracingConfigError(Exception):
    """Base class for framework-neutral app tracing configuration failures."""


class AppTracingConfigAppNotFoundError(AppTracingConfigError):
    def __init__(self) -> None:
        super().__init__("App not found")


class AppTracingConfigAlreadyExistsError(AppTracingConfigError):
    def __init__(self) -> None:
        super().__init__("Trace config is exist.")


class AppTracingConfigNotFoundError(AppTracingConfigError):
    def __init__(self) -> None:
        super().__init__("Trace config not exist.")


class AppTracingConfigInvalidProviderError(AppTracingConfigError):
    def __init__(self, tracing_provider: str) -> None:
        super().__init__(f"Invalid tracing provider: {tracing_provider}")


class AppTracingConfigInvalidConfigurationError(AppTracingConfigError):
    """The submitted provider configuration does not match its schema."""

    def __init__(self) -> None:
        super().__init__("Invalid tracing configuration")


class AppTracingConfigVerificationFailedError(AppTracingConfigError):
    """The submitted configuration could not be verified by its provider."""

    def __init__(self) -> None:
        super().__init__("Tracing configuration verification failed")


class AppTracingConfigProcessingError(AppTracingConfigError):
    """A validated or stored configuration could not be processed internally."""

    def __init__(self) -> None:
        super().__init__("Tracing configuration processing failed")


class AppTracingConfigService:
    def __init__(self, *, configs: AppTracingConfigStore, provider: TracingConfigProviderGateway) -> None:
        self._configs = configs
        self._provider = provider

    def get(
        self,
        context: RequestContext,
        app_id: str,
        tracing_provider: str,
    ) -> AppTracingConfigRecord | None:
        workspace_id = context.active_workspace_id
        self._provider.validate_provider(tracing_provider)
        record = self._configs.get(
            workspace_id=workspace_id,
            app_id=app_id,
            tracing_provider=tracing_provider,
        )
        if record is None:
            return None

        tracing_config = self._provider.present_config(
            workspace_id=workspace_id,
            tracing_provider=tracing_provider,
            tracing_config=record.tracing_config,
        )
        return replace(record, tracing_config=tracing_config)

    def create(
        self,
        context: RequestContext,
        app_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
    ) -> None:
        workspace_id = context.active_workspace_id
        current = self._configs.get(
            workspace_id=workspace_id,
            app_id=app_id,
            tracing_provider=tracing_provider,
        )
        if current is not None:
            raise AppTracingConfigAlreadyExistsError

        encrypted_config = self._provider.prepare_new_config(
            workspace_id=workspace_id,
            tracing_provider=tracing_provider,
            tracing_config=tracing_config,
        )

        created = self._configs.create(
            workspace_id=workspace_id,
            app_id=app_id,
            tracing_provider=tracing_provider,
            tracing_config=encrypted_config,
        )
        if not created:
            raise AppTracingConfigAlreadyExistsError

    def update(
        self,
        context: RequestContext,
        app_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
    ) -> None:
        workspace_id = context.active_workspace_id
        current = self._configs.get(
            workspace_id=workspace_id,
            app_id=app_id,
            tracing_provider=tracing_provider,
        )
        self._provider.validate_provider(tracing_provider)
        if current is None:
            raise AppTracingConfigNotFoundError

        encrypted_config = self._provider.prepare_updated_config(
            workspace_id=workspace_id,
            tracing_provider=tracing_provider,
            tracing_config=tracing_config,
            current_tracing_config=current.tracing_config,
        )
        updated = self._configs.update(
            workspace_id=workspace_id,
            app_id=app_id,
            tracing_provider=tracing_provider,
            tracing_config=encrypted_config,
        )
        if not updated:
            raise AppTracingConfigNotFoundError

    def delete(self, context: RequestContext, app_id: str, tracing_provider: str) -> None:
        self._provider.validate_provider(tracing_provider)
        deleted = self._configs.delete(
            workspace_id=context.active_workspace_id,
            app_id=app_id,
            tracing_provider=tracing_provider,
        )
        if not deleted:
            raise AppTracingConfigNotFoundError
