from datetime import datetime

from core.entities.application_entities import ApplicationGenerateEntity
from events.message_event import message_was_created
from extensions.ext_database import db
from models.provider import Provider


@message_was_created.connect
def handle(sender, **kwargs):
    message = sender
    application_generate_entity: ApplicationGenerateEntity = kwargs.get('application_generate_entity')

    db.session.query(Provider).filter(
        Provider.tenant_id == application_generate_entity.tenant_id,
        Provider.provider_name == application_generate_entity.app_orchestration_config_entity.model_config.provider
    ).update({'last_used': datetime.utcnow()})
    db.session.commit()
