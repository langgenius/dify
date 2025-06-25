from datetime import UTC, datetime

from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, ChatAppGenerateEntity
from extensions.ext_database import db
from models.provider import Provider


# DEPRECATED: This handler has been replaced by update_provider_when_message_created.py
# to prevent deadlocks. This file is kept for reference but the handler is disabled.
# @message_was_created.connect  # DISABLED
def handle_deprecated(sender, **kwargs):
    application_generate_entity = kwargs.get("application_generate_entity")

    if not isinstance(application_generate_entity, ChatAppGenerateEntity | AgentChatAppGenerateEntity):
        return

    db.session.query(Provider).filter(
        Provider.tenant_id == application_generate_entity.app_config.tenant_id,
        Provider.provider_name == application_generate_entity.model_conf.provider,
    ).update({"last_used": datetime.now(UTC).replace(tzinfo=None)})
    db.session.commit()
