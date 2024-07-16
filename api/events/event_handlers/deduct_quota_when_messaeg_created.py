from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, ChatAppGenerateEntity
from core.entities.provider_entities import QuotaUnit
from events.message_event import message_was_created
from extensions.ext_database import db
from models.provider import Provider, ProviderType


@message_was_created.connect
def handle(sender, **kwargs):
    message = sender
    application_generate_entity = kwargs.get('application_generate_entity')

    if not isinstance(application_generate_entity, ChatAppGenerateEntity | AgentChatAppGenerateEntity):
        return

    model_config = application_generate_entity.model_conf
    provider_model_bundle = model_config.provider_model_bundle
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
            used_quota = message.message_tokens + message.answer_tokens
        elif quota_unit == QuotaUnit.CREDITS:
            used_quota = 1

            if 'gpt-4' in model_config.model:
                used_quota = 20
        else:
            used_quota = 1

    if used_quota is not None:
        db.session.query(Provider).filter(
            Provider.tenant_id == application_generate_entity.app_config.tenant_id,
            Provider.provider_name == model_config.provider,
            Provider.provider_type == ProviderType.SYSTEM.value,
            Provider.quota_type == system_configuration.current_quota_type.value,
            Provider.quota_limit > Provider.quota_used
        ).update({'quota_used': Provider.quota_used + used_quota})
        db.session.commit()
