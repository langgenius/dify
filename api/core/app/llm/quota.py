"""Tenant-scoped helpers for checking and deducting LLM provider quota.

Workflow callers now bill quota from public model identity instead of passing a
fully prepared ``ModelInstance``. Keep the model-instance helpers as thin,
deprecated adapters so non-workflow code can move independently.
"""

import warnings

from sqlalchemy import update
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


def _get_provider_configuration(*, tenant_id: str, provider: str):
    """Resolve the tenant-bound provider configuration for quota decisions."""
    provider_manager = create_plugin_provider_manager(tenant_id=tenant_id)
    provider_configuration = provider_manager.get_configurations(tenant_id).get(provider)
    if provider_configuration is None:
        raise ValueError(f"Provider {provider} does not exist.")
    return provider_configuration


def ensure_llm_quota_available_for_model(*, tenant_id: str, provider: str, model: str) -> None:
    """Raise when a tenant-bound system provider model is already out of quota."""
    provider_configuration = _get_provider_configuration(tenant_id=tenant_id, provider=provider)
    if provider_configuration.using_provider_type != ProviderType.SYSTEM:
        return

    provider_model = provider_configuration.get_provider_model(
        model_type=ModelType.LLM,
        model=model,
    )
    if provider_model and provider_model.status == ModelStatus.QUOTA_EXCEEDED:
        raise QuotaExceededError(f"Model provider {provider} quota exceeded.")


def deduct_llm_quota_for_model(*, tenant_id: str, provider: str, model: str, usage: LLMUsage) -> None:
    """Deduct tenant-bound quota for the resolved LLM model identity."""
    provider_configuration = _get_provider_configuration(tenant_id=tenant_id, provider=provider)
    if provider_configuration.using_provider_type != ProviderType.SYSTEM:
        return

    system_configuration = provider_configuration.system_configuration

    quota_unit = None
    for quota_configuration in system_configuration.quota_configurations:
        if quota_configuration.quota_type == system_configuration.current_quota_type:
            quota_unit = quota_configuration.quota_unit

            if quota_configuration.quota_limit == -1:
                return

            break

    used_quota = None
    if quota_unit:
        if quota_unit == QuotaUnit.TOKENS:
            used_quota = usage.total_tokens
        elif quota_unit == QuotaUnit.CREDITS:
            used_quota = dify_config.get_model_credits(model)
        else:
            used_quota = 1

    if used_quota is not None and system_configuration.current_quota_type is not None:
        match system_configuration.current_quota_type:
            case ProviderQuotaType.TRIAL:
                from services.credit_pool_service import CreditPoolService

                CreditPoolService.check_and_deduct_credits(
                    tenant_id=tenant_id,
                    credits_required=used_quota,
                )
            case ProviderQuotaType.PAID:
                from services.credit_pool_service import CreditPoolService

                CreditPoolService.check_and_deduct_credits(
                    tenant_id=tenant_id,
                    credits_required=used_quota,
                    pool_type="paid",
                )
            case ProviderQuotaType.FREE:
                with sessionmaker(bind=db.engine).begin() as session:
                    stmt = (
                        update(Provider)
                        .where(
                            Provider.tenant_id == tenant_id,
                            # TODO: Use provider name with prefix after the data migration.
                            Provider.provider_name == ModelProviderID(provider).provider_name,
                            Provider.provider_type == ProviderType.SYSTEM.value,
                            Provider.quota_type == system_configuration.current_quota_type,
                            Provider.quota_limit > Provider.quota_used,
                        )
                        .values(
                            quota_used=Provider.quota_used + used_quota,
                            last_used=naive_utc_now(),
                        )
                    )
                    session.execute(stmt)


def ensure_llm_quota_available(*, model_instance: ModelInstance) -> None:
    """Deprecated compatibility wrapper for callers that still pass ModelInstance."""
    warnings.warn(
        "ensure_llm_quota_available(model_instance=...) is deprecated; "
        "use ensure_llm_quota_available_for_model(...) instead.",
        DeprecationWarning,
        stacklevel=2,
    )
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
    deduct_llm_quota_for_model(
        tenant_id=tenant_id,
        provider=model_instance.provider,
        model=model_instance.model_name,
        usage=usage,
    )
