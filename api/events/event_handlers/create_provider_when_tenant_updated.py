from flask import current_app

from events.tenant_event import tenant_was_created
from models.provider import ProviderName
from services.provider_service import ProviderService


@tenant_was_created.connect
def handle(sender, **kwargs):
    tenant = sender
    if tenant.status == 'normal':
        ProviderService.create_system_provider(
            tenant,
            ProviderName.OPENAI.value,
            current_app.config['OPENAI_HOSTED_QUOTA_LIMIT'],
            True
        )

        ProviderService.create_system_provider(
            tenant,
            ProviderName.ANTHROPIC.value,
            current_app.config['ANTHROPIC_HOSTED_QUOTA_LIMIT'],
            True
        )
