import logging
import secrets
from typing import cast

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities import DEFAULT_PLUGIN_ID
from core.plugin.impl.model_runtime_factory import create_plugin_model_assembly
from extensions.ext_hosting_provider import hosting_configuration
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeBadRequestError
from graphon.model_runtime.model_providers.base.moderation_model import ModerationModel
from models.provider import ProviderType

logger = logging.getLogger(__name__)


def check_moderation(tenant_id: str, model_config: ModelConfigWithCredentialsEntity, text: str) -> bool:
    moderation_config = hosting_configuration.moderation_config
    openai_provider_name = f"{DEFAULT_PLUGIN_ID}/openai/openai"
    if (
        moderation_config
        and moderation_config.enabled is True
        and openai_provider_name in hosting_configuration.provider_map
        and hosting_configuration.provider_map[openai_provider_name].enabled is True
    ):
        using_provider_type = model_config.provider_model_bundle.configuration.using_provider_type
        provider_name = model_config.provider
        if using_provider_type == ProviderType.SYSTEM and provider_name in moderation_config.providers:
            hosting_openai_config = hosting_configuration.provider_map[openai_provider_name]

            if hosting_openai_config.credentials is None:
                return False

            # 2000 text per chunk
            length = 2000
            text_chunks = [text[i : i + length] for i in range(0, len(text), length)]

            if len(text_chunks) == 0:
                return True

            text_chunk = secrets.choice(text_chunks)

            try:
                model_assembly = create_plugin_model_assembly(tenant_id=tenant_id)
                model_type_instance = model_assembly.create_model_type_instance(
                    provider=openai_provider_name, model_type=ModelType.MODERATION
                )
                model_type_instance = cast(ModerationModel, model_type_instance)
                moderation_result = model_type_instance.invoke(
                    model="omni-moderation-latest", credentials=hosting_openai_config.credentials, text=text_chunk
                )

                if moderation_result is True:
                    return True
            except Exception:
                logger.exception("Fails to check moderation, provider_name: %s", provider_name)
                raise InvokeBadRequestError("Rate limit exceeded, please try again later.")

    return False
