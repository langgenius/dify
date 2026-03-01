from collections.abc import Sequence
from typing import cast

from sqlalchemy import update
from sqlalchemy.orm import Session

from configs import dify_config
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.model_manager import ModelInstance
from core.model_runtime.entities import PromptMessageRole
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    PromptMessage,
    TextPromptMessageContent,
)
from core.model_runtime.entities.model_entities import AIModelEntity
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.workflow.file.models import File
from core.workflow.runtime import VariablePool
from core.workflow.variables.segments import ArrayAnySegment, ArrayFileSegment, FileSegment, NoneSegment
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.provider import Provider, ProviderType
from models.provider_ids import ModelProviderID

from .exc import InvalidVariableTypeError
from .protocols import PromptMessageMemory


def fetch_model_schema(*, model_instance: ModelInstance) -> AIModelEntity:
    model_schema = cast(LargeLanguageModel, model_instance.model_type_instance).get_model_schema(
        model_instance.model_name,
        model_instance.credentials,
    )
    if not model_schema:
        raise ValueError(f"Model schema not found for {model_instance.model_name}")
    return model_schema


def fetch_files(variable_pool: VariablePool, selector: Sequence[str]) -> Sequence["File"]:
    variable = variable_pool.get(selector)
    if variable is None:
        return []
    elif isinstance(variable, FileSegment):
        return [variable.value]
    elif isinstance(variable, ArrayFileSegment):
        return variable.value
    elif isinstance(variable, NoneSegment | ArrayAnySegment):
        return []
    raise InvalidVariableTypeError(f"Invalid variable type: {type(variable)}")


def convert_history_messages_to_text(
    *,
    history_messages: Sequence[PromptMessage],
    human_prefix: str,
    ai_prefix: str,
) -> str:
    string_messages: list[str] = []
    for message in history_messages:
        if message.role == PromptMessageRole.USER:
            role = human_prefix
        elif message.role == PromptMessageRole.ASSISTANT:
            role = ai_prefix
        else:
            continue

        if isinstance(message.content, list):
            content_parts = []
            for content in message.content:
                if isinstance(content, TextPromptMessageContent):
                    content_parts.append(content.data)
                elif isinstance(content, ImagePromptMessageContent):
                    content_parts.append("[image]")

            inner_msg = "\n".join(content_parts)
            string_messages.append(f"{role}: {inner_msg}")
        else:
            string_messages.append(f"{role}: {message.content}")

    return "\n".join(string_messages)


def fetch_memory_text(
    *,
    memory: PromptMessageMemory,
    max_token_limit: int,
    message_limit: int | None = None,
    human_prefix: str = "Human",
    ai_prefix: str = "Assistant",
) -> str:
    history_messages = memory.get_history_prompt_messages(
        max_token_limit=max_token_limit,
        message_limit=message_limit,
    )
    return convert_history_messages_to_text(
        history_messages=history_messages,
        human_prefix=human_prefix,
        ai_prefix=ai_prefix,
    )


def deduct_llm_quota(tenant_id: str, model_instance: ModelInstance, usage: LLMUsage):
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
