from sqlalchemy import update
from sqlalchemy.orm import Session

from configs import dify_config
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.model_manager import ModelInstance
from core.model_runtime.entities.llm_entities import LLMUsage
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.provider import Provider, ProviderType
from models.provider_ids import ModelProviderID


def deduct_llm_quota(*, tenant_id: str, model_instance: ModelInstance, usage: LLMUsage) -> None:
    provider_model_bundle = model_instance.provider_model_bundle
    provider_configuration = provider_model_bundle.configuration

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
            used_quota = dify_config.get_model_credits(model_instance.model_name)
        else:
            used_quota = 1

    if used_quota is not None and system_configuration.current_quota_type is not None:
        if system_configuration.current_quota_type == ProviderQuotaType.TRIAL:
            from services.credit_pool_service import CreditPoolService

            CreditPoolService.check_and_deduct_credits(
                tenant_id=tenant_id,
                credits_required=used_quota,
            )
        elif system_configuration.current_quota_type == ProviderQuotaType.PAID:
            from services.credit_pool_service import CreditPoolService

            CreditPoolService.check_and_deduct_credits(
                tenant_id=tenant_id,
                credits_required=used_quota,
                pool_type="paid",
            )
        else:
            with Session(db.engine) as session:
                stmt = (
                    update(Provider)
                    .where(
                        Provider.tenant_id == tenant_id,
                        # TODO: Use provider name with prefix after the data migration.
                        Provider.provider_name == ModelProviderID(model_instance.provider).provider_name,
                        Provider.provider_type == ProviderType.SYSTEM.value,
                        Provider.quota_type == system_configuration.current_quota_type.value,
                        Provider.quota_limit > Provider.quota_used,
                    )
                    .values(
                        quota_used=Provider.quota_used + used_quota,
                        last_used=naive_utc_now(),
                    )
                )
                session.execute(stmt)
                session.commit()
