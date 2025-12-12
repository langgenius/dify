import logging
from collections.abc import Sequence
from typing import Any, cast

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.provider_configuration import ProviderConfiguration
from core.entities.provider_entities import QuotaUnit
from core.file.models import File
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.provider_manager import ProviderManager
from core.variables.segments import ArrayAnySegment, ArrayFileSegment, FileSegment, NoneSegment, StringSegment
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes.llm.entities import ModelConfig
from core.workflow.runtime import VariablePool
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.model import Conversation
from models.provider import Provider, ProviderType
from models.provider_ids import ModelProviderID

from .entities import CredentialOverride
from .exc import InvalidVariableTypeError, LLMModeRequiredError, ModelNotExistError

logger = logging.getLogger(__name__)


def _fetch_override_credentials(
    tenant_id: str, provider: str, model: str, credential_override: CredentialOverride
) -> dict[str, Any] | None:
    """
    Fetch workflow-specific override credentials.
    :param tenant_id: workspace id
    :param provider: provider name
    :param model: model name
    :param credential_override: credential override configuration
    :return: Override credentials dict or None if no override is specified or if credentials are not found
    """
    # Return None if no credential override is specified
    if not credential_override.credential_id and not credential_override.credential_name:
        return None

    provider_manager = ProviderManager()

    # If credential_id is specified, fetch that specific credential
    if credential_override.credential_id:
        # Get provider configuration to access credential methods
        provider_configurations = provider_manager.get_configurations(tenant_id)
        provider_configuration = provider_configurations.get(provider)

        # If provider configuration is missing or clearly unusable, fall back gracefully
        if not provider_configuration:
            return None
        pc = provider_configuration  # narrow Optional for type-checker

        token_or_id = credential_override.credential_id

        # First, try public provider-level API (works with tests/mocks)
        explicit_not_found = False
        try:
            credentials = pc.get_provider_credential(token_or_id)
            if isinstance(credentials, dict) and credentials:
                # If looks masked, and pc is a real ProviderConfiguration, fetch raw via private helper
                if any(isinstance(v, str) and v.count("*") >= 6 for v in credentials.values()):
                    try:
                        if isinstance(pc, ProviderConfiguration):
                            raw = pc._get_specific_provider_credential(token_or_id, obfuscated=False)  # type: ignore[attr-defined]
                            if isinstance(raw, dict) and raw:
                                return raw
                    except Exception as e:
                        logger.warning("Failed to fetch credentials for %s %s", token_or_id, e)
                return credentials
        except ValueError:
            explicit_not_found = True
        except Exception as e:
            logger.warning("Failed to fetch credentials for %s %s", token_or_id, e)

        # Next, try public model-level API
        try:
            model_credential_result = pc.get_custom_model_credential(
                model_type=ModelType.LLM, model=model, credential_id=token_or_id
            )
            if isinstance(model_credential_result, dict):
                creds = model_credential_result.get("credentials", {}) if model_credential_result else {}
                if isinstance(creds, dict) and creds:
                    if any(isinstance(v, str) and v.count("*") >= 6 for v in creds.values()):
                        try:
                            if isinstance(pc, ProviderConfiguration):
                                raw_result = pc._get_specific_custom_model_credential(  # type: ignore[attr-defined]
                                    model_type=ModelType.LLM, model=model, credential_id=token_or_id, obfuscated=False
                                )
                                if isinstance(raw_result, dict) and isinstance(raw_result.get("credentials"), dict):
                                    return raw_result.get("credentials")
                        except Exception as e:
                            logger.warning("Failed to fetch credentials for %s %s", token_or_id, e)
                    return creds
        except ValueError:
            explicit_not_found = True
        except Exception as e:
            logger.warning("Failed to fetch credentials for %s %s", token_or_id, e)

        # If provider explicitly indicated not-found, raise; otherwise, fall back to None
        if explicit_not_found:
            raise ValueError(f"Credential with ID {token_or_id} not found")
        return None
    # If credential_name is specified, find credential by name
    elif credential_override.credential_name:
        # Get provider configuration
        provider_configurations = provider_manager.get_configurations(tenant_id)
        provider_configuration = provider_configurations.get(provider)

        if not provider_configuration:
            raise ValueError(f"Provider {provider} not found")

        # Search provider credentials by name
        if provider_configuration.custom_configuration and provider_configuration.custom_configuration.provider:
            available_credentials = provider_configuration.custom_configuration.provider.available_credentials
            if isinstance(available_credentials, (list, tuple)):
                for cred_config in available_credentials:
                    if cred_config.credential_name == credential_override.credential_name:
                        return provider_configuration.get_provider_credential(cred_config.credential_id)

        # Search model credentials by name
        if provider_configuration.custom_configuration and provider_configuration.custom_configuration.models:
            models = provider_configuration.custom_configuration.models
            for model_config in models:
                available_model_credentials = model_config.available_model_credentials
                for cred_config in available_model_credentials:
                    if cred_config.credential_name == credential_override.credential_name:
                        model_credential_result = provider_configuration.get_custom_model_credential(
                            model_type=ModelType.LLM, model=model, credential_id=cred_config.credential_id
                        )
                        if isinstance(model_credential_result, dict):
                            if "credentials" in model_credential_result and isinstance(
                                model_credential_result.get("credentials"), dict
                            ):
                                return model_credential_result.get("credentials", {})
                            return model_credential_result
                return {}
        raise ValueError(f"Credential with name '{credential_override.credential_name}' not found")
    return None


def fetch_model_config(
    tenant_id: str, node_data_model: ModelConfig, workflow_credential_override: CredentialOverride | None = None
) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
    if not node_data_model.mode:
        raise LLMModeRequiredError("LLM mode is required.")

    override_credentials = None
    if workflow_credential_override:
        try:
            override_credentials = _fetch_override_credentials(
                tenant_id=tenant_id,
                provider=node_data_model.provider,
                model=node_data_model.name,
                credential_override=workflow_credential_override,
            )
        except ValueError as e:
            logger.warning("Failed to fetch workflow credential override: %s. Using default credentials.", e)

    model = ModelManager().get_model_instance(
        tenant_id=tenant_id,
        model_type=ModelType.LLM,
        provider=node_data_model.provider,
        model=node_data_model.name,
    )

    if override_credentials:
        model.credentials = override_credentials

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
