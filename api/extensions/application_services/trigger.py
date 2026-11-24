"""Compose trigger subscription, webhook, schedule and execution use cases."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.plugin.impl.oauth import OAuthHandler
from core.tools.tool_file_manager import ToolFileManager
from enums import QuotaType
from extensions.ext_redis import RedisClientWrapper
from extensions.ext_storage import storage
from repositories.credentials.query_repository import CredentialQueryRepository
from repositories.sqlalchemy_workflow_trigger_log_repository import (
    SQLAlchemyWorkflowTriggerExecutionRepository,
)
from repositories.trigger.app_repository import SQLAlchemyAppTriggerRepository
from repositories.trigger.debug_repository import RedisTriggerDebugRepository
from repositories.trigger.oauth_client_repository import TriggerOAuthClientRepository
from repositories.trigger.schedule_repository import TriggerScheduleRepository
from repositories.trigger.subscription_builder_repository import RedisTriggerSubscriptionBuilderRepository
from repositories.trigger.subscription_repository import (
    RedisTriggerSubscriptionLocks,
    RedisTriggerSubscriptionRefreshReservations,
    TriggerSubscriptionRepository,
)
from services.async_workflow_service import AsyncWorkflowService, TriggerWorkflowQuery
from services.quota_service import QuotaService
from services.trigger.credential_encryption import delete_cache_for_subscription
from services.trigger.debug_service import TriggerDebugService
from services.trigger.debug_store import TriggerDebugEventStore
from services.trigger.endpoint_gateway import PluginTriggerEndpointGateway, enqueue_triggered_workflows
from services.trigger.endpoint_service import TriggerEndpointService
from services.trigger.event_gateway import PluginTriggerEventGateway
from services.trigger.event_service import TriggerEventService
from services.trigger.execution_gateway import WorkflowTriggerExecutionGateway
from services.trigger.execution_service import TriggerExecutionService
from services.trigger.execution_store import TriggerExecutionStore
from services.trigger.oauth_client_service import TriggerOAuthClientService
from services.trigger.oauth_gateway import (
    OAuthProxyContextGateway,
    PluginTriggerOAuthGateway,
    TriggerOAuthBuilderGateway,
)
from services.trigger.oauth_service import TriggerOAuthService
from services.trigger.provider_gateway import PluginTriggerProviderQuery
from services.trigger.provider_loader import PluginTriggerProviderLoader
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
from services.trigger.webhook_service import (
    WebhookBindingService,
    WebhookFiles,
    WebhookService,
)
from services.trigger.workflow_dispatch_service import PluginTriggerWorkflowDispatchService, TriggerEndUserProvisioner
from services.workflow.queue_dispatcher import CeleryWorkflowQueuePublisher


@dataclass(frozen=True, slots=True)
class TriggerServices:
    providers: TriggerProviderQuery
    subscriptions: TriggerSubscriptionQueryService
    binding_queries: TriggerSubscriptionBindingQuery
    create_binding_service: Callable[[Session], TriggerSubscriptionBindingService]
    subscription_management: TriggerSubscriptionService
    subscription_renewal: TriggerSubscriptionRenewalService
    subscription_refresh: TriggerSubscriptionRefreshService
    builders: TriggerSubscriptionBuilderService
    endpoints: TriggerEndpointService
    events: TriggerEventService
    debug: TriggerDebugService
    debug_events: TriggerDebugEventStore
    workflow_dispatch: AsyncWorkflowService
    executions: TriggerExecutionService
    execution_logs: TriggerExecutionStore
    webhooks: WebhookService
    webhook_files: WebhookFiles
    webhook_draft_bindings: WebhookBindingService
    create_webhook_publication_service: Callable[[Session], WebhookBindingService]
    plugin_workflow_dispatch: PluginTriggerWorkflowDispatchService
    schedules: TriggerScheduleService
    create_schedule_publication_service: Callable[[Session], SchedulePublicationService]
    oauth_clients: TriggerOAuthClientService
    oauth: TriggerOAuthService


def build_trigger_services(
    *,
    database_client: sessionmaker[Session],
    redis: RedisClientWrapper,
    credentials: CredentialQueryRepository,
    subscriptions: TriggerSubscriptionRepository,
    provider_loader: PluginTriggerProviderLoader,
    workflow_queries: TriggerWorkflowQuery,
    trigger_end_users: TriggerEndUserProvisioner,
    mark_rate_limited: Callable[[str], None],
) -> TriggerServices:
    trigger_providers = PluginTriggerProviderQuery(providers=provider_loader)
    subscription_provider = PluginTriggerSubscriptionGateway(providers=provider_loader)
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
        get_provider=provider_loader.get_trigger_provider,
        subscribe=provider_loader.subscribe_trigger,
        create_subscription=trigger_subscription_management.create,
    )
    trigger_oauth_provider = PluginTriggerOAuthGateway(oauth=OAuthHandler(), providers=provider_loader)
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
    trigger_requests = TriggerHttpRequestCachingService(storage=storage)
    trigger_debug_events = RedisTriggerDebugRepository(redis=redis)
    trigger_events = TriggerEventService(
        subscriptions=trigger_subscriptions,
        plugins=PluginTriggerEventGateway(providers=provider_loader),
        requests=trigger_requests,
    )
    execution_logs = SQLAlchemyWorkflowTriggerExecutionRepository(session_factory=database_client)
    execution_runtime = WorkflowTriggerExecutionGateway(
        models=execution_logs, logs=execution_logs, session_factory=database_client
    )
    queues = CeleryWorkflowQueuePublisher()
    workflow_dispatch = AsyncWorkflowService(
        workflows=workflow_queries, logs=execution_logs, queues=queues, reserve_quota=QuotaService.reserve
    )
    app_triggers = SQLAlchemyAppTriggerRepository(session_factory=database_client)
    schedules = TriggerScheduleRepository(session_factory=database_client)
    return TriggerServices(
        providers=trigger_providers,
        subscriptions=trigger_subscriptions,
        binding_queries=subscriptions,
        # Bind only for the duration of the caller's publication transaction.
        create_binding_service=lambda session: TriggerSubscriptionBindingService(
            sync_bindings=partial(subscriptions.sync_workflow_bindings, session=session)
        ),
        events=trigger_events,
        debug_events=trigger_debug_events,
        debug=TriggerDebugService(
            events=trigger_debug_events,
            schedules=trigger_debug_events,
            invoke_plugin_event=trigger_events.invoke_debug,
            now=lambda: datetime.now(UTC),
        ),
        workflow_dispatch=workflow_dispatch,
        executions=TriggerExecutionService(logs=execution_logs, run=execution_runtime.run),
        execution_logs=execution_logs,
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
        plugin_workflow_dispatch=PluginTriggerWorkflowDispatchService(
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
        schedules=TriggerScheduleService(
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
        subscription_management=trigger_subscription_management,
        subscription_renewal=renewal,
        subscription_refresh=TriggerSubscriptionRefreshService(
            subscriptions=subscriptions,
            reservations=RedisTriggerSubscriptionRefreshReservations(redis=redis),
            publish=enqueue_subscription_refresh,
            renewal=renewal,
        ),
        builders=trigger_builders,
        endpoints=TriggerEndpointService(
            subscriptions=subscriptions,
            provider=PluginTriggerEndpointGateway(providers=provider_loader),
            requests=trigger_requests,
            publish=enqueue_triggered_workflows,
        ),
        oauth_clients=trigger_oauth_clients,
        oauth=TriggerOAuthService(
            clients=trigger_oauth_clients,
            providers=trigger_oauth_provider,
            contexts=OAuthProxyContextGateway(),
            builders=TriggerOAuthBuilderGateway(builders=trigger_builders),
        ),
    )
