"""Tenant-scoped helpers for checking and deducting hosted model quota.

The reservation entry point covers every model invocation type. Legacy quota
helpers remain LLM-specific because token-based settlement requires LLM usage.
"""

import warnings
from dataclasses import dataclass, field
from enum import StrEnum, auto
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.entities.model_entities import ModelStatus
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.errors.error import QuotaExceededError
from core.model_manager import ModelInstance
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from extensions.ext_database import db
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.model_entities import ModelType
from libs.datetime_utils import naive_utc_now
from models.provider import Provider, ProviderType
from models.provider_ids import ModelProviderID
from services.credit_pool_service import CreditPoolReservation, CreditPoolService


class ModelQuotaReservationState(StrEnum):
    RESERVED = auto()
    COMMITTED = auto()
    RELEASED = auto()


@dataclass
class ModelQuotaReservation:
    """Quota reserved for one system-hosted model invocation."""

    tenant_id: str
    provider: str
    model_type: ModelType
    model: str
    provider_configuration: Any
    quota_unit: QuotaUnit | None = None
    credit_pool_reservation: CreditPoolReservation | None = None
    requires_settlement: bool = False
    _state: ModelQuotaReservationState = field(default=ModelQuotaReservationState.RESERVED, init=False, repr=False)

    @property
    def state(self) -> ModelQuotaReservationState:
        return self._state

    @property
    def commit_before_delivery(self) -> bool:
        return self.credit_pool_reservation is not None

    def commit(self, usage: LLMUsage | None = None) -> None:
        if self._state == ModelQuotaReservationState.COMMITTED:
            return
        if self._state == ModelQuotaReservationState.RELEASED:
            raise RuntimeError("Cannot commit a released model quota reservation.")

        if self.credit_pool_reservation is not None:
            self.credit_pool_reservation.commit()
        elif self.requires_settlement:
            used_quota = _resolve_model_used_quota(
                system_configuration=self.provider_configuration.system_configuration,
                model_type=self.model_type,
                model=self.model,
                usage=usage,
            )
            _deduct_used_model_quota(
                tenant_id=self.tenant_id,
                provider=self.provider,
                provider_configuration=self.provider_configuration,
                used_quota=used_quota,
            )

        self._state = ModelQuotaReservationState.COMMITTED

    def release(self) -> None:
        if self._state in {ModelQuotaReservationState.COMMITTED, ModelQuotaReservationState.RELEASED}:
            return

        if self.credit_pool_reservation is not None:
            self.credit_pool_reservation.release()
        self._state = ModelQuotaReservationState.RELEASED


# Compatibility aliases for callers that still import the LLM-specific names.
LLMQuotaReservationState = ModelQuotaReservationState
LLMQuotaReservation = ModelQuotaReservation


def _get_provider_configuration(*, tenant_id: str, provider: str):
    """Resolve the tenant-bound provider configuration for quota decisions."""
    provider_manager = create_plugin_provider_manager(tenant_id=tenant_id)
    provider_configuration = provider_manager.get_configurations(tenant_id).get(provider)
    if provider_configuration is None:
        raise ValueError(f"Provider {provider} does not exist.")
    return provider_configuration


def _get_current_quota_configuration(system_configuration):
    return next(
        (
            quota_configuration
            for quota_configuration in system_configuration.quota_configurations
            if quota_configuration.quota_type == system_configuration.current_quota_type
        ),
        None,
    )


def reserve_model_quota_for_model(
    *,
    tenant_id: str,
    provider: str,
    model_type: ModelType,
    model: str,
    request_id: str | None = None,
) -> ModelQuotaReservation:
    """Reserve system-hosted model quota before invoking the provider."""
    provider_configuration = _get_provider_configuration(tenant_id=tenant_id, provider=provider)
    reservation = ModelQuotaReservation(
        tenant_id=tenant_id,
        provider=provider,
        model_type=model_type,
        model=model,
        provider_configuration=provider_configuration,
    )
    if provider_configuration.using_provider_type != ProviderType.SYSTEM:
        return reservation

    provider_model = provider_configuration.get_provider_model(model_type=model_type, model=model)
    if provider_model and provider_model.status == ModelStatus.QUOTA_EXCEEDED:
        raise QuotaExceededError(f"Model provider {provider} quota exceeded.")

    system_configuration = provider_configuration.system_configuration
    quota_configuration = _get_current_quota_configuration(system_configuration)
    if quota_configuration is None or quota_configuration.quota_limit == -1:
        return reservation

    reservation.quota_unit = quota_configuration.quota_unit
    quota_type = system_configuration.current_quota_type
    if quota_type in {ProviderQuotaType.TRIAL, ProviderQuotaType.PAID}:
        match quota_configuration.quota_unit:
            case QuotaUnit.CREDITS:
                amount = dify_config.get_model_credits(model)
            case QuotaUnit.TIMES:
                amount = 1
            case QuotaUnit.TOKENS:
                # Token usage is unknown before invocation. Enabling TOKENS for a hosted
                # credit pool requires accurate terminal usage and an upper-bound reservation strategy.
                raise ValueError("Token-based hosted credit pools do not support pre-invocation reservation.")
            case _:
                raise ValueError(f"Unsupported hosted credit pool quota unit: {quota_configuration.quota_unit}")

        reservation_meta = {"source": "llm.invoke", "provider": provider, "model": model}
        if model_type != ModelType.LLM:
            reservation_meta = {
                "source": "model.invoke",
                "provider": provider,
                "model_type": model_type.value,
                "model": model,
            }
        reservation.credit_pool_reservation = CreditPoolService.reserve_credits(
            tenant_id=tenant_id,
            credits_required=amount,
            pool_type="paid" if quota_type == ProviderQuotaType.PAID else "trial",
            request_id=request_id or str(uuid4()),
            session_factory=db.session,
            meta=reservation_meta,
        )
    elif quota_type == ProviderQuotaType.FREE:
        if quota_configuration.quota_unit == QuotaUnit.TOKENS and model_type != ModelType.LLM:
            raise ValueError("Token-based quota settlement only supports LLM invocations.")
        reservation.requires_settlement = True

    return reservation


def reserve_llm_quota_for_model(
    *, tenant_id: str, provider: str, model: str, request_id: str | None = None
) -> ModelQuotaReservation:
    """Reserve system-hosted LLM quota before invoking the provider."""
    return reserve_model_quota_for_model(
        tenant_id=tenant_id,
        provider=provider,
        model_type=ModelType.LLM,
        model=model,
        request_id=request_id,
    )


def ensure_llm_quota_available_for_model(*, tenant_id: str, provider: str, model: str) -> None:
    """Raise when a tenant-bound LLM model is already out of quota."""
    provider_configuration = _get_provider_configuration(tenant_id=tenant_id, provider=provider)
    if provider_configuration.using_provider_type != ProviderType.SYSTEM:
        return

    provider_model = provider_configuration.get_provider_model(
        model_type=ModelType.LLM,
        model=model,
    )
    if provider_model and provider_model.status == ModelStatus.QUOTA_EXCEEDED:
        raise QuotaExceededError(f"Model provider {provider} quota exceeded.")


def _resolve_model_used_quota(
    *, system_configuration, model_type: ModelType, model: str, usage: LLMUsage | None
) -> int | None:
    """Compute the quota impact for a model invocation under the current quota mode."""
    quota_unit = None
    for quota_configuration in system_configuration.quota_configurations:
        if quota_configuration.quota_type == system_configuration.current_quota_type:
            quota_unit = quota_configuration.quota_unit

            if quota_configuration.quota_limit == -1:
                return None

            break

    used_quota = None
    if quota_unit:
        if quota_unit == QuotaUnit.TOKENS:
            if model_type != ModelType.LLM or usage is None:
                raise ValueError("Accurate terminal usage is required for token-based LLM quota settlement.")
            used_quota = usage.total_tokens
        elif quota_unit == QuotaUnit.CREDITS:
            used_quota = dify_config.get_model_credits(model)
        else:
            used_quota = 1

    return used_quota


def _resolve_llm_used_quota(*, system_configuration, model: str, usage: LLMUsage) -> int | None:
    """Compute the quota impact for an LLM invocation under the current quota mode."""
    return _resolve_model_used_quota(
        system_configuration=system_configuration,
        model_type=ModelType.LLM,
        model=model,
        usage=usage,
    )


def _deduct_free_model_quota(
    *,
    tenant_id: str,
    provider: str,
    quota_type: ProviderQuotaType,
    used_quota: int,
) -> None:
    """Deduct FREE provider quota, capping at the limit before reporting exhaustion."""
    quota_exceeded = False
    with sessionmaker(bind=db.engine).begin() as session:
        provider_record = session.scalar(
            select(Provider)
            .where(
                Provider.tenant_id == tenant_id,
                # TODO: Use provider name with prefix after the data migration.
                Provider.provider_name == ModelProviderID(provider).provider_name,
                Provider.provider_type == ProviderType.SYSTEM.value,
                Provider.quota_type == quota_type,
            )
            .with_for_update()
        )
        if (
            provider_record is None
            or provider_record.quota_limit is None
            or provider_record.quota_used is None
            or provider_record.quota_limit <= provider_record.quota_used
        ):
            quota_exceeded = True
        else:
            available_quota = provider_record.quota_limit - provider_record.quota_used
            deducted_quota = min(used_quota, available_quota)
            provider_record.quota_used += deducted_quota
            provider_record.last_used = naive_utc_now()
            quota_exceeded = deducted_quota < used_quota

    if quota_exceeded:
        raise QuotaExceededError(f"Model provider {provider} quota exceeded.")


def _deduct_used_model_quota(*, tenant_id: str, provider: str, provider_configuration, used_quota: int | None) -> None:
    """Apply a resolved model quota charge against the current provider quota bucket."""
    if provider_configuration.using_provider_type != ProviderType.SYSTEM:
        return

    system_configuration = provider_configuration.system_configuration
    if used_quota is not None and system_configuration.current_quota_type is not None:
        match system_configuration.current_quota_type:
            case ProviderQuotaType.TRIAL:
                from services.credit_pool_service import CreditPoolService

                CreditPoolService.deduct_credits_capped(
                    tenant_id=tenant_id,
                    credits_required=used_quota,
                    session=db.session(),
                )
            case ProviderQuotaType.PAID:
                from services.credit_pool_service import CreditPoolService

                CreditPoolService.deduct_credits_capped(
                    tenant_id=tenant_id,
                    credits_required=used_quota,
                    pool_type="paid",
                    session=db.session(),
                )
            case ProviderQuotaType.FREE:
                _deduct_free_model_quota(
                    tenant_id=tenant_id,
                    provider=provider,
                    quota_type=system_configuration.current_quota_type,
                    used_quota=used_quota,
                )
            case _:
                return


def deduct_llm_quota_for_model(*, tenant_id: str, provider: str, model: str, usage: LLMUsage) -> None:
    """Deduct tenant-bound quota for the resolved LLM model identity."""
    provider_configuration = _get_provider_configuration(tenant_id=tenant_id, provider=provider)
    used_quota = _resolve_llm_used_quota(
        system_configuration=provider_configuration.system_configuration,
        model=model,
        usage=usage,
    )
    _deduct_used_model_quota(
        tenant_id=tenant_id,
        provider=provider,
        provider_configuration=provider_configuration,
        used_quota=used_quota,
    )


def _require_llm_model_instance(model_instance: ModelInstance) -> None:
    """Reject deprecated wrapper calls that pass a non-LLM model instance."""
    if model_instance.model_type_instance.model_type != ModelType.LLM:
        raise ValueError("LLM quota helpers only support LLM model instances.")


def ensure_llm_quota_available(*, model_instance: ModelInstance) -> None:
    """Deprecated compatibility wrapper for callers that still pass ModelInstance."""
    warnings.warn(
        "ensure_llm_quota_available(model_instance=...) is deprecated; "
        "use ensure_llm_quota_available_for_model(...) instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    _require_llm_model_instance(model_instance)
    ensure_llm_quota_available_for_model(
        tenant_id=model_instance.provider_model_bundle.configuration.tenant_id,
        provider=model_instance.provider,
        model=model_instance.model_name,
    )


def deduct_llm_quota(*, tenant_id: str, model_instance: ModelInstance, usage: LLMUsage) -> None:
    """Deprecated compatibility wrapper for callers that still pass ModelInstance."""
    warnings.warn(
        "deduct_llm_quota(tenant_id=..., model_instance=..., usage=...) is deprecated; "
        "use deduct_llm_quota_for_model(...) instead.",
        DeprecationWarning,
        stacklevel=2,
    )
    _require_llm_model_instance(model_instance)
    deduct_llm_quota_for_model(
        tenant_id=tenant_id,
        provider=model_instance.provider,
        model=model_instance.model_name,
        usage=usage,
    )
