"""Compose workspace use cases with the shared account and workspace repositories."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.plugin.impl.oauth import OAuthHandler
from core.tools.tool_file_manager import ToolFileManager
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import delete_cache_for_subscription
from enums import QuotaType
from extensions.ext_redis import RedisClientWrapper
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.app.console_repository import ConsoleAppRepository
from repositories.credentials.query_repository import CredentialQueryRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerDispatchRepository
from repositories.trigger.app_repository import SQLAlchemyAppTriggerRepository
from repositories.trigger.oauth_client_repository import TriggerOAuthClientRepository
from repositories.trigger.schedule_repository import TriggerScheduleRepository
from repositories.trigger.subscription_builder_repository import RedisTriggerSubscriptionBuilderRepository
from repositories.trigger.subscription_repository import (
    RedisTriggerSubscriptionLocks,
    RedisTriggerSubscriptionRefreshReservations,
    TriggerSubscriptionRepository,
)
from repositories.workspace.resource_cleanup_repository import WorkspaceResourceCleanupRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.adapters import RedisInvitationTokenStore
from services.async_workflow_service import AsyncWorkflowService, TriggerWorkflowQuery
from services.file_service import FileService
from services.plugin.plugin_parameter_gateway import DaemonPluginParameterGateway
from services.plugin.plugin_parameter_service import PluginParameterService
from services.quota_service import QuotaService
from services.trigger.endpoint_gateway import PluginTriggerEndpointGateway, enqueue_triggered_workflows
from services.trigger.endpoint_service import TriggerEndpointService
from services.trigger.event_gateway import PluginTriggerEventGateway
from services.trigger.event_service import TriggerEventService
from services.trigger.oauth_client_service import TriggerOAuthClientService
from services.trigger.oauth_gateway import (
    OAuthProxyContextGateway,
    PluginTriggerOAuthGateway,
    TriggerOAuthBuilderGateway,
)
from services.trigger.oauth_service import TriggerOAuthService
from services.trigger.provider_gateway import PluginTriggerProviderQuery
from services.trigger.provider_query import TriggerProviderQuery
from services.trigger.schedule_gateway import ScheduleWorkflowGateway, publish_schedules
from services.trigger.schedule_service import SchedulePublicationService, TriggerScheduleService
from services.trigger.subscription_binding_service import (
    TriggerSubscriptionBindingQuery,
    TriggerSubscriptionBindingService,
)
from services.trigger.subscription_codec import ProviderTriggerSubscriptionCodec
from services.trigger.subscription_gateway import (
    PluginTriggerSubscriptionGateway,
    enqueue_subscription_refresh,
    invalidate_subscription_properties,
)
from services.trigger.subscription_query_service import TriggerSubscriptionQueryService
from services.trigger.subscription_refresh_service import TriggerSubscriptionRefreshService
from services.trigger.subscription_renewal_service import TriggerSubscriptionRenewalService
from services.trigger.subscription_service import TriggerSubscriptionService
from services.trigger.trigger_request_service import TriggerHttpRequestCachingService
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService
from services.trigger.webhook_gateway import ToolWebhookFiles
from services.trigger.webhook_service import WebhookBindingService, WebhookFiles, WebhookService
from services.trigger.workflow_dispatch_service import PluginTriggerWorkflowDispatchService, TriggerEndUserProvisioner
from services.workflow.queue_dispatcher import CeleryWorkflowQueuePublisher
from services.workspace.gateways import (
    DeploymentWorkspaceCreationPolicy,
    DeploymentWorkspaceFeatureGateway,
    DeploymentWorkspaceMemberAccessGateway,
    DeploymentWorkspaceMemberRoleResolver,
    DeploymentWorkspacePlanGateway,
    WorkspaceFileGateway,
    WorkspaceIdentityGateway,
    WorkspaceInvitationGateway,
    WorkspaceOwnerTransferGateway,
    WorkspaceProvisioningEffectsGateway,
)
from services.workspace.member_service import (
    InvitedAccountRegistration,
    WorkspaceInvitationService,
    WorkspaceMemberQueryService,
    WorkspaceMemberService,
    WorkspaceOwnerTransferService,
)
from services.workspace.provisioning_service import WorkspaceProvisioningService
from services.workspace.resource_cleanup_service import WorkspaceResourceCleanupService
from services.workspace.service import WorkspaceQueryService, WorkspaceService


@dataclass(frozen=True, slots=True)
class WorkspaceServices:
    queries: WorkspaceQueryService
    management: WorkspaceService
    provisioning: WorkspaceProvisioningService
    members: WorkspaceMemberService
    member_queries: WorkspaceMemberQueryService
    owner_transfer: WorkspaceOwnerTransferService
    invitations: WorkspaceInvitationService
    identity: WorkspaceIdentityGateway
    resource_cleanup: WorkspaceResourceCleanupService
    plugin_parameters: PluginParameterService
    trigger_providers: TriggerProviderQuery
    trigger_subscriptions: TriggerSubscriptionQueryService
    trigger_binding_queries: TriggerSubscriptionBindingQuery
    create_trigger_binding_service: Callable[[Session], TriggerSubscriptionBindingService]
    trigger_subscription_management: TriggerSubscriptionService
    trigger_subscription_renewal: TriggerSubscriptionRenewalService
    trigger_subscription_refresh: TriggerSubscriptionRefreshService
    trigger_builders: TriggerSubscriptionBuilderService
    trigger_endpoints: TriggerEndpointService
    trigger_events: TriggerEventService
    workflow_dispatch: AsyncWorkflowService
    webhooks: WebhookService
    webhook_files: WebhookFiles
    webhook_draft_bindings: WebhookBindingService
    create_webhook_publication_service: Callable[[Session], WebhookBindingService]
    trigger_workflow_dispatch: PluginTriggerWorkflowDispatchService
    trigger_schedules: TriggerScheduleService
    create_schedule_publication_service: Callable[[Session], SchedulePublicationService]
    trigger_oauth_clients: TriggerOAuthClientService
    trigger_oauth: TriggerOAuthService


def build_workspace_membership_services(
    *,
    workspaces: WorkspaceRepository,
    accounts: SQLAlchemyAccountRepository,
) -> tuple[WorkspaceMemberService, WorkspaceProvisioningService]:
    """Build the workspace prerequisites shared by account registration and invitations."""
    members = WorkspaceMemberService(
        workspaces=workspaces,
        accounts=accounts,
        access=DeploymentWorkspaceMemberAccessGateway(),
    )
    provisioning = WorkspaceProvisioningService(
        owners=accounts,
        provisioning=workspaces,
        effects=WorkspaceProvisioningEffectsGateway(),
        policies=DeploymentWorkspaceCreationPolicy(),
        memberships=workspaces,
        members=members,
    )
    return members, provisioning


def build_workspace_services(
    *,
    database_client: sessionmaker[Session],
    workspaces: WorkspaceRepository,
    accounts: SQLAlchemyAccountRepository,
    files: FileService,
    redis: RedisClientWrapper,
    members: WorkspaceMemberService,
    provisioning: WorkspaceProvisioningService,
    registration: InvitedAccountRegistration,
    invitation_tokens: RedisInvitationTokenStore,
    credentials: CredentialQueryRepository,
    workflow_queries: TriggerWorkflowQuery,
    trigger_end_users: TriggerEndUserProvisioner,
    mark_rate_limited: Callable[[str], None],
) -> WorkspaceServices:
    trigger_providers = PluginTriggerProviderQuery()
    subscriptions = TriggerSubscriptionRepository(session_factory=database_client)
    subscription_provider = PluginTriggerSubscriptionGateway()
    subscription_locks = RedisTriggerSubscriptionLocks(redis=redis)
    subscription_codec = ProviderTriggerSubscriptionCodec()
    trigger_subscription_management = TriggerSubscriptionService(
        subscriptions=subscriptions,
        providers=subscription_provider,
        locks=subscription_locks,
        codec=subscription_codec,
        invalidate_cache=delete_cache_for_subscription,
    )
    trigger_builders = TriggerSubscriptionBuilderService(
        builders=RedisTriggerSubscriptionBuilderRepository(redis=redis),
        get_provider=TriggerManager.get_trigger_provider,
        subscribe=TriggerManager.subscribe_trigger,
        create_subscription=trigger_subscription_management.create,
    )
    trigger_oauth_provider = PluginTriggerOAuthGateway(oauth=OAuthHandler())
    trigger_oauth_clients = TriggerOAuthClientService(
        clients=TriggerOAuthClientRepository(session_factory=database_client),
        providers=trigger_oauth_provider,
    )
    trigger_subscriptions = TriggerSubscriptionQueryService(
        credentials=credentials, schemas=trigger_providers, subscriptions=subscriptions
    )
    renewal = TriggerSubscriptionRenewalService(
        subscriptions=subscriptions,
        providers=subscription_provider,
        oauth=trigger_oauth_provider,
        clients=trigger_oauth_clients,
        locks=subscription_locks,
        codec=subscription_codec,
        credential_threshold=dify_config.TRIGGER_PROVIDER_CREDENTIAL_THRESHOLD_SECONDS,
        subscription_threshold=dify_config.TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS,
        console_api_url=dify_config.CONSOLE_API_URL,
        invalidate_cache=delete_cache_for_subscription,
        invalidate_properties=invalidate_subscription_properties,
    )
    trigger_events = TriggerEventService(
        subscriptions=trigger_subscriptions,
        plugins=PluginTriggerEventGateway(),
        requests=TriggerHttpRequestCachingService,
    )
    execution_logs = SQLAlchemyWorkflowTriggerDispatchRepository(session_factory=database_client)
    queues = CeleryWorkflowQueuePublisher()
    workflow_dispatch = AsyncWorkflowService(
        workflows=workflow_queries, logs=execution_logs, queues=queues, reserve_quota=QuotaService.reserve
    )
    app_triggers = SQLAlchemyAppTriggerRepository(session_factory=database_client)
    schedules = TriggerScheduleRepository(session_factory=database_client)
    return WorkspaceServices(
        queries=WorkspaceQueryService(workspaces=workspaces, plans=DeploymentWorkspacePlanGateway()),
        management=WorkspaceService(
            workspaces=workspaces,
            features=DeploymentWorkspaceFeatureGateway(),
            logos=WorkspaceFileGateway(files=files),
        ),
        provisioning=provisioning,
        members=members,
        member_queries=WorkspaceMemberQueryService(
            members=workspaces,
            roles=DeploymentWorkspaceMemberRoleResolver(),
        ),
        owner_transfer=WorkspaceOwnerTransferService(
            accounts=accounts,
            workspaces=workspaces,
            members=members,
            challenges=WorkspaceOwnerTransferGateway(redis=redis),
        ),
        invitations=WorkspaceInvitationService(
            accounts=registration,
            workspaces=workspaces,
            members=members,
            invitations=WorkspaceInvitationGateway(tokens=invitation_tokens, redis=redis),
        ),
        identity=WorkspaceIdentityGateway(workspaces=workspaces),
        resource_cleanup=WorkspaceResourceCleanupService(
            session_factory=database_client,
            apps=ConsoleAppRepository(session_factory=database_client),
            datasets=SQLAlchemyDatasetRepository(session_factory=database_client),
            agent_resources=WorkspaceResourceCleanupRepository(session_factory=database_client),
        ),
        plugin_parameters=PluginParameterService(
            credentials=credentials,
            subscriptions=subscriptions,
            builders=trigger_builders,
            plugins=DaemonPluginParameterGateway(),
        ),
        trigger_providers=trigger_providers,
        trigger_subscriptions=trigger_subscriptions,
        trigger_binding_queries=subscriptions,
        # Bind only for the duration of the caller's publication transaction.
        create_trigger_binding_service=lambda session: TriggerSubscriptionBindingService(
            sync_bindings=partial(subscriptions.sync_workflow_bindings, session=session)
        ),
        trigger_events=trigger_events,
        workflow_dispatch=workflow_dispatch,
        webhooks=WebhookService(
            webhooks=app_triggers,
            end_users=trigger_end_users,
            dispatch=workflow_dispatch,
            reserve_quota=QuotaService.reserve,
            mark_rate_limited=mark_rate_limited,
        ),
        webhook_files=ToolWebhookFiles(manager=ToolFileManager(), access=DatabaseFileAccessController()),
        webhook_draft_bindings=WebhookBindingService(sync_bindings=app_triggers.sync_draft_webhooks),
        # Publish binding changes atomically with the workflow that owns them.
        create_webhook_publication_service=lambda session: WebhookBindingService(
            sync_bindings=partial(app_triggers.sync_webhooks, session=session, remove_stale=True)
        ),
        trigger_workflow_dispatch=PluginTriggerWorkflowDispatchService(
            workflows=workflow_queries,
            logs=execution_logs,
            queues=queues,
            dispatch=workflow_dispatch,
            events=trigger_events,
            bindings=subscriptions,
            end_users=trigger_end_users,
            reserve_quota=QuotaService.reserve,
            mark_rate_limited=mark_rate_limited,
        ),
        trigger_schedules=TriggerScheduleService(
            schedules=schedules,
            publish=publish_schedules,
            dispatch=ScheduleWorkflowGateway(workflows=workflow_dispatch),
            reserve=partial(QuotaService.reserve, QuotaType.TRIGGER),
            mark_rate_limited=mark_rate_limited,
            now=lambda: datetime.now(UTC),
            batch_size=dify_config.WORKFLOW_SCHEDULE_POLLER_BATCH_SIZE,
            max_dispatch_per_tick=dify_config.WORKFLOW_SCHEDULE_MAX_DISPATCH_PER_TICK,
        ),
        create_schedule_publication_service=lambda session: SchedulePublicationService(
            sync_schedule=partial(schedules.sync_publication, session=session), now=lambda: datetime.now(UTC)
        ),
        trigger_subscription_management=trigger_subscription_management,
        trigger_subscription_renewal=renewal,
        trigger_subscription_refresh=TriggerSubscriptionRefreshService(
            subscriptions=subscriptions,
            reservations=RedisTriggerSubscriptionRefreshReservations(redis=redis),
            publish=enqueue_subscription_refresh,
            renewal=renewal,
        ),
        trigger_builders=trigger_builders,
        trigger_endpoints=TriggerEndpointService(
            subscriptions=subscriptions,
            provider=PluginTriggerEndpointGateway(),
            requests=TriggerHttpRequestCachingService,
            publish=enqueue_triggered_workflows,
        ),
        trigger_oauth_clients=trigger_oauth_clients,
        trigger_oauth=TriggerOAuthService(
            clients=trigger_oauth_clients,
            providers=trigger_oauth_provider,
            contexts=OAuthProxyContextGateway(),
            builders=TriggerOAuthBuilderGateway(builders=trigger_builders),
        ),
    )
