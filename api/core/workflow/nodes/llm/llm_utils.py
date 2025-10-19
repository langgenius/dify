from collections.abc import Sequence
from typing import cast

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.provider_entities import QuotaUnit
from core.file.models import File
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.variables.segments import ArrayAnySegment, ArrayFileSegment, FileSegment, NoneSegment, StringSegment
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes.llm.entities import ModelConfig
from core.workflow.runtime import VariablePool
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.model import Conversation
from models.provider import Provider, ProviderType
from models.provider_ids import ModelProviderID

from .exc import InvalidVariableTypeError, LLMModeRequiredError, ModelNotExistError


def fetch_model_config(
    tenant_id: str, node_data_model: ModelConfig
) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
    if not node_data_model.mode:
        raise LLMModeRequiredError("LLM mode is required.")

    model = ModelManager().get_model_instance(
        tenant_id=tenant_id,
        model_type=ModelType.LLM,
        provider=node_data_model.provider,
        model=node_data_model.name,
    )

    model.model_type_instance = cast(LargeLanguageModel, model.model_type_instance)

    # check model
    provider_model = model.provider_model_bundle.configuration.get_provider_model(
        model=node_data_model.name, model_type=ModelType.LLM
    )

    if provider_model is None:
        raise ModelNotExistError(f"Model {node_data_model.name} not exist.")
    provider_model.raise_for_status()

    # model config
    stop: list[str] = []
    if "stop" in node_data_model.completion_params:
        stop = node_data_model.completion_params.pop("stop")

    model_schema = model.model_type_instance.get_model_schema(node_data_model.name, model.credentials)
    if not model_schema:
        raise ModelNotExistError(f"Model {node_data_model.name} not exist.")

    return model, ModelConfigWithCredentialsEntity(
        provider=node_data_model.provider,
        model=node_data_model.name,
        model_schema=model_schema,
        mode=node_data_model.mode,
        provider_model_bundle=model.provider_model_bundle,
        credentials=model.credentials,
        parameters=node_data_model.completion_params,
        stop=stop,
    )


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


def fetch_memory(
    variable_pool: VariablePool, app_id: str, node_data_memory: MemoryConfig | None, model_instance: ModelInstance
) -> TokenBufferMemory | None:
    if not node_data_memory:
        return None

    # get conversation id
    conversation_id_variable = variable_pool.get(["sys", SystemVariableKey.CONVERSATION_ID])
    if not isinstance(conversation_id_variable, StringSegment):
        return None
    conversation_id = conversation_id_variable.value

    with Session(db.engine, expire_on_commit=False) as session:
        stmt = select(Conversation).where(Conversation.app_id == app_id, Conversation.id == conversation_id)
        conversation = session.scalar(stmt)
        if not conversation:
            return None

    memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)
    return memory


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
            used_quota = dify_config.get_model_credits(model_instance.model)
        else:
            used_quota = 1

    if used_quota is not None and system_configuration.current_quota_type is not None:
        with Session(db.engine) as session:
            stmt = (
                update(Provider)
                .where(
                    Provider.tenant_id == tenant_id,
                    # TODO: Use provider name with prefix after the data migration.
                    Provider.provider_name == ModelProviderID(model_instance.provider).provider_name,
                    Provider.provider_type == ProviderType.SYSTEM,
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
