"""Application boundary for app tracing provider configurations."""

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Protocol

from machinery.context import RequestContext


@dataclass(frozen=True, slots=True)
class AppTraceSettings:
    enabled: bool = False
    tracing_provider: str | None = None
    capture_content: bool = False
    capture_agent: bool = True


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
        activate: bool = False,
    ) -> bool: ...

    def update(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
        expected: AppTracingConfigRecord,
        activate: bool = False,
    ) -> bool: ...

    def delete(
        self,
        *,
        workspace_id: str,
        app_id: str,
        tracing_provider: str,
    ) -> bool: ...

    def set_trace(
        self, *, workspace_id: str, app_id: str, settings: AppTraceSettings, expected: AppTracingConfigRecord | None
    ) -> None: ...


class TracingConfigProviderGateway(Protocol):
    def validate_provider(self, tracing_provider: str) -> None: ...

    def validate_saved_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any]
    ) -> None: ...

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


class AppTracingConfigConflictError(AppTracingConfigError):
    def __init__(self) -> None:
        super().__init__("Tracing configuration changed. Refresh and try again.")


class AppTracingConfigNotFoundError(AppTracingConfigError):
    def __init__(self) -> None:
        super().__init__("Trace config not exist.")


class AppTracingConfigInvalidProviderError(AppTracingConfigError):
    def __init__(self, tracing_provider: str) -> None:
        super().__init__(f"Invalid tracing provider: {tracing_provider}")


class AppTracingConfigProviderUnavailableError(AppTracingConfigError):
    def __init__(self) -> None:
        super().__init__("The tracing provider is not available in this deployment.")


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
        *,
        activate: bool = False,
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
            activate=activate,
        )
        if not created:
            raise AppTracingConfigAlreadyExistsError

    def update(
        self,
        context: RequestContext,
        app_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
        *,
        activate: bool = False,
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
            expected=current,
            activate=activate,
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

    def set_trace(self, context: RequestContext, app_id: str, settings: AppTraceSettings) -> None:
        expected = None
        provider = settings.tracing_provider
        if provider is not None:
            self._provider.validate_provider(provider)
        if settings.enabled:
            if provider is None:
                raise AppTracingConfigNotFoundError
            expected = self._configs.get(
                workspace_id=context.active_workspace_id, app_id=app_id, tracing_provider=provider
            )
            if expected is None or not expected.is_active or not expected.tracing_config:
                raise AppTracingConfigNotFoundError
            self._provider.validate_saved_config(
                workspace_id=context.active_workspace_id,
                tracing_provider=provider,
                tracing_config=expected.tracing_config,
            )
        self._configs.set_trace(
            workspace_id=context.active_workspace_id, app_id=app_id, settings=settings, expected=expected
        )
