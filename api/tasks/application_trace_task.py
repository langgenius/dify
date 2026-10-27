"""Durable application trace delivery on the existing ops_trace worker queue."""

from celery import shared_task

from configs import dify_config


@shared_task(queue="ops_trace")
def export_application_trace(run_id: str) -> None:
    from services.tracing.service import application_tracing_service

    application_tracing_service().deliver(run_id)


@shared_task(queue="ops_trace")
def reconcile_application_traces() -> None:
    from services.tracing.service import application_tracing_service

    service = application_tracing_service()
    for run_id in service.repository.pending_ids():
        service.schedule(run_id)
    service.repository.purge(retention_days=dify_config.OPS_AGENT_TRACE_RETENTION_DAYS)
