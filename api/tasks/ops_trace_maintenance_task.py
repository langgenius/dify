"""Recover broker publication and delete terminal trace bodies independently."""

from flask import current_app

from configs import dify_config
from models.ops_trace import OpsTraceDelivery
from repositories.ops_trace_delivery_repository import OpsTraceDeliveryRepository


def enqueue_due_traces() -> None:
    repository: OpsTraceDeliveryRepository = current_app.extensions["ops_trace_delivery_repository"]
    publish_delivery = current_app.extensions["ops_trace_queue"].publish_delivery
    repository.cancel_expired_uploads()
    for tenant_id, delivery_id in repository.due_deliveries():
        try:
            publish_delivery(tenant_id, delivery_id)
        except Exception:
            current_app.logger.warning(
                "OPS recovery publication failed tenant_id=%s delivery_id=%s", tenant_id, delivery_id
            )


def delete_expired_traces() -> None:
    repository: OpsTraceDeliveryRepository = current_app.extensions["ops_trace_delivery_repository"]
    for delivery in repository.expired_traces(
        success_retention_seconds=dify_config.OPS_TRACE_SUCCESS_RETENTION_SECONDS,
        failure_retention_seconds=dify_config.OPS_TRACE_FAILURE_RETENTION_SECONDS,
    ):
        delete_trace_body(delivery)
    repository.delete_expired_deliveries()


def delete_trace_body(delivery: OpsTraceDelivery) -> None:
    repository: OpsTraceDeliveryRepository = current_app.extensions["ops_trace_delivery_repository"]
    try:
        try:
            current_app.extensions["ops_trace_storage"].delete(delivery.trace_storage_key())
        except FileNotFoundError:
            pass
        repository.record_trace_deleted(delivery)
    except Exception:
        current_app.logger.warning("OPS cleanup failed tenant_id=%s delivery_id=%s", delivery.tenant_id, delivery.id)
