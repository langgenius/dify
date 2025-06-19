from datetime import UTC, datetime

from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, ChatAppGenerateEntity
from events.message_event import message_was_created
from extensions.ext_database import db
from models.provider import Provider

last_used_cache = {}
last_flush_cache_time = datetime.now(UTC).replace(tzinfo=None)


def try_flush_cache_to_db():
    global last_flush_cache_time
    if not last_used_cache:
        return
    now = datetime.now(UTC).replace(tzinfo=None)
    if (now - last_flush_cache_time).total_seconds() < 5:
        return
    last_flush_cache_time = now

    with Session(db.engine) as session:
        updates = [
            {"tenant_id": tenant_id, "provider_name": provider_name, "last_used": last_used}
            for (tenant_id, provider_name), last_used in last_used_cache.items()
        ]
        session.bulk_update_mappings(Provider, updates)
        session.commit()

    last_used_cache.clear()


@message_was_created.connect
def handle(sender, **kwargs):
    application_generate_entity = kwargs.get("application_generate_entity")

    if not isinstance(application_generate_entity, ChatAppGenerateEntity | AgentChatAppGenerateEntity):
        return

    tenant_id = application_generate_entity.app_config.tenant_id
    provider_name = application_generate_entity.model_conf.provider
    current_time = datetime.now(UTC).replace(tzinfo=None)

    if (tenant_id, provider_name) in last_used_cache:
        last_used_cache[(tenant_id, provider_name)] = max(
            last_used_cache[(tenant_id, provider_name)], current_time
        )
    else:
        last_used_cache[(tenant_id, provider_name)] = current_time
    
    try_flush_cache_to_db()
