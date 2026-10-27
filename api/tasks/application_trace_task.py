"""Durable application trace delivery on the existing ops_trace worker queue."""

from celery import shared_task

from extensions.ext_application_services import application_services


@shared_task(queue="ops_trace")
def export_application_trace(run_id: str) -> None:
    application_services().tracing.agent_traces.deliver(run_id)


@shared_task(queue="ops_trace")
def reconcile_application_traces() -> None:
    application_services().tracing.agent_traces.reconcile()
