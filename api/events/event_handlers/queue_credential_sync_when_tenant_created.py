from configs import dify_config
from enums import DeploymentEdition
from events.tenant_event import tenant_was_created
from services.enterprise.workspace_sync import WorkspaceSyncService


@tenant_was_created.connect
def handle(sender, **kwargs):
    """Queue credential sync when a tenant/workspace is created."""
    # Only queue sync tasks if plugin manager (enterprise feature) is enabled
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.ENTERPRISE:
        return

    tenant = sender

    # Determine source from kwargs if available, otherwise use generic
    source = kwargs.get("source", "tenant_created")

    # Queue credential sync task to Redis for enterprise backend to process
    WorkspaceSyncService.queue_credential_sync(tenant.id, source=source)
