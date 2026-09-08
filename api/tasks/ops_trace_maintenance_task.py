"""Recover broker publication and delete terminal trace bodies independently."""

from flask import current_app

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
    trace_storage = current_app.extensions["ops_trace_storage"]
    for delivery in repository.expired_traces():
        try:
            trace_storage.delete(delivery.trace_storage_key())
            repository.record_trace_deleted(delivery)
        except FileNotFoundError:
            repository.record_trace_deleted(delivery)
        except Exception:
            current_app.logger.warning(
                "OPS cleanup failed tenant_id=%s delivery_id=%s", delivery.tenant_id, delivery.id
            )
    repository.delete_expired_deliveries()
