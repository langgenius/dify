from datetime import datetime, timezone

from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, ChatAppGenerateEntity
from events.message_event import message_was_created
from extensions.ext_database import db
from models.provider import Provider


@message_was_created.connect
def handle(sender, **kwargs):
    message = sender
    application_generate_entity = kwargs.get('application_generate_entity')

    if not isinstance(application_generate_entity, ChatAppGenerateEntity | AgentChatAppGenerateEntity):
        return

    db.session.query(Provider).filter(
        Provider.tenant_id == application_generate_entity.app_config.tenant_id,
        Provider.provider_name == application_generate_entity.model_conf.provider
    ).update({'last_used': datetime.now(timezone.utc).replace(tzinfo=None)})
    db.session.commit()
