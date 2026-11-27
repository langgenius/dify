"""Bounded durable External Agent command and cleanup workers."""

from dataclasses import asdict
from datetime import UTC, datetime

from celery import current_app as celery_app
from celery import shared_task
from pydantic import TypeAdapter

from configs import dify_config
from extensions.ext_application_services import application_services
from services.external_agents.runtime_contracts import RuntimeScope

_SCOPE = TypeAdapter(RuntimeScope)


@shared_task(ignore_result=True, soft_time_limit=100, time_limit=110)
def execute_external_command(scope: dict, command_id: str) -> None:
    services = application_services().external_agents
    # Scope originates in the DB scheduler. The repository revalidates its
    # complete owner chain and fencing lease before any outbound operation.
    services.runtime.run_command(_SCOPE.validate_python(scope), command_id)


@shared_task(ignore_result=True)
def drain_external_commands() -> None:
    services = application_services().external_agents
    now = datetime.now(UTC)
    services.repository.close_unavailable_executions(now=now, limit=dify_config.EXTERNAL_AGENTS_WORKER_BATCH)
    for scope in services.repository.recovery_scopes(now=now, limit=dify_config.EXTERNAL_AGENTS_WORKER_BATCH):
        services.runtime.reconcile(scope, now=now)
    for scope, command_id in services.repository.claim_publishable_commands(
        now=now, limit=dify_config.EXTERNAL_AGENTS_WORKER_BATCH
    ):
        celery_app.send_task(
            "tasks.external_agent_task.execute_external_command",
            args=(asdict(scope), command_id),
            queue=dify_config.EXTERNAL_AGENTS_QUEUE,
            expires=60,
        )


@shared_task(ignore_result=True)
def maintain_external_agents() -> None:
    services = application_services().external_agents
    now = datetime.now(UTC)
    services.retention.sweep(now=now, limit=dify_config.EXTERNAL_AGENTS_WORKER_BATCH)
    services.trace_delivery.reconcile_sources(now=now, limit=dify_config.EXTERNAL_AGENTS_WORKER_BATCH)
    for tenant_id, delivery_id in services.trace_delivery.claim_publishable_deliveries(
        now=now, limit=dify_config.EXTERNAL_AGENTS_WORKER_BATCH
    ):
        celery_app.send_task(
            "tasks.external_agent_task.execute_external_trace_delivery",
            args=(tenant_id, delivery_id),
            queue=dify_config.OPS_TRACE_QUEUE,
            expires=60,
        )


@shared_task(ignore_result=True, soft_time_limit=40, time_limit=45)
def execute_external_trace_delivery(tenant_id: str, delivery_id: str) -> None:
    services = application_services().external_agents
    services.trace_delivery.deliver(tenant_id=tenant_id, delivery_id=delivery_id, now=datetime.now(UTC))
