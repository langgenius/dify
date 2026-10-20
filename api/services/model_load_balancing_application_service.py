"""Console load-balancing operations with an explicit workspace boundary."""

from typing import Any, Protocol, TypedDict

from machinery.context import RequestContext


class LoadBalancingConfigSummary(TypedDict):
    id: str
    name: str
    credentials: dict[str, Any]
    credential_id: str | None
    enabled: bool
    in_cooldown: bool
    ttl: int


class LoadBalancingOperations(Protocol):
    """Legacy-compatible runtime operations; implementations own their sessions."""

    def validate(
        self,
        *,
        tenant_id: str,
        provider: str,
        model: str,
        model_type: str,
        credentials: dict[str, Any],
        config_id: str | None,
    ) -> None: ...

    def get_configs(
        self,
        *,
        tenant_id: str,
        provider: str,
        model: str,
        model_type: str,
        config_from: str,
    ) -> tuple[bool, list[LoadBalancingConfigSummary]]: ...

    def update_configs(
        self,
        *,
        tenant_id: str,
        provider: str,
        model: str,
        model_type: str,
        configs: list[dict[str, Any]],
        config_from: str,
        enabled: bool,
    ) -> None: ...


class ModelLoadBalancingApplicationService:
    def __init__(self, *, operations: LoadBalancingOperations) -> None:
        self._operations = operations

    def validate_credentials(
        self,
        context: RequestContext,
        *,
        provider: str,
        model: str,
        model_type: str,
        credentials: dict[str, Any],
        config_id: str | None,
    ) -> None:
        self._operations.validate(
            tenant_id=context.active_workspace_id,
            provider=provider,
            model=model,
            model_type=model_type,
            credentials=credentials,
            config_id=config_id,
        )

    def get_configs(
        self,
        context: RequestContext,
        *,
        provider: str,
        model: str,
        model_type: str,
        config_from: str,
    ) -> tuple[bool, list[LoadBalancingConfigSummary]]:
        return self._operations.get_configs(
            tenant_id=context.active_workspace_id,
            provider=provider,
            model=model,
            model_type=model_type,
            config_from=config_from,
        )

    def update_configs(
        self,
        context: RequestContext,
        *,
        provider: str,
        model: str,
        model_type: str,
        configs: list[dict[str, Any]],
        config_from: str,
        enabled: bool,
    ) -> None:
        self._operations.update_configs(
            tenant_id=context.active_workspace_id,
            provider=provider,
            model=model,
            model_type=model_type,
            configs=configs,
            config_from=config_from,
            enabled=enabled,
        )
