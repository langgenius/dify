"""Session-owning compatibility adapter for Console load-balancing operations."""

from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from services.model_load_balancing_application_service import LoadBalancingConfigSummary
from services.model_load_balancing_service import ModelLoadBalancingService


class ModelLoadBalancingOperations:
    """Keep the shared legacy service's commit and provider-call ordering.

    Listing may create and commit an inherit config; updates commit each config
    and invalidate caches themselves. Do not wrap either in an outer transaction
    or commit again here. Validation retains the legacy provider/decryption flow
    in the operation's session; separating that flow is a separate migration.
    Sessions close on both success and failure and never escape to controllers.
    """

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def validate(
        self,
        *,
        tenant_id: str,
        provider: str,
        model: str,
        model_type: str,
        credentials: dict[str, Any],
        config_id: str | None,
    ) -> None:
        with self._session_factory() as session:
            ModelLoadBalancingService().validate_load_balancing_credentials(
                tenant_id=tenant_id,
                provider=provider,
                model=model,
                model_type=model_type,
                credentials=dict(credentials),
                config_id=config_id,
                session=session,
            )

    def get_configs(
        self,
        *,
        tenant_id: str,
        provider: str,
        model: str,
        model_type: str,
        config_from: str,
    ) -> tuple[bool, list[LoadBalancingConfigSummary]]:
        with self._session_factory() as session:
            return ModelLoadBalancingService().get_load_balancing_configs(
                tenant_id=tenant_id,
                provider=provider,
                model=model,
                model_type=model_type,
                config_from=config_from,
                session=session,
            )

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
    ) -> None:
        service = ModelLoadBalancingService()
        with self._session_factory() as session:
            service.update_load_balancing_configs(
                tenant_id=tenant_id,
                provider=provider,
                model=model,
                model_type=model_type,
                configs=configs,
                config_from=config_from,
                session=session,
            )
        if enabled:
            service.enable_model_load_balancing(
                tenant_id=tenant_id,
                provider=provider,
                model=model,
                model_type=model_type,
            )
        else:
            service.disable_model_load_balancing(
                tenant_id=tenant_id,
                provider=provider,
                model=model,
                model_type=model_type,
            )
