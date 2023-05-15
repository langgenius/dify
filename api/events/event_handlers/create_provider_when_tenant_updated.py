from events.tenant_event import tenant_was_created
from services.provider_service import ProviderService


@tenant_was_created.connect
def handle(sender, **kwargs):
    tenant = sender
    if tenant.status == 'normal':
        ProviderService.create_system_provider(tenant)
