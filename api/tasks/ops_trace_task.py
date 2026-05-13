"""
Celery task for asynchronous ops trace dispatch.

Trace providers may report explicitly retryable dispatch failures through the
core retryable exception contract. The task preserves the payload file only
when Celery accepts the retry request; successful dispatches and terminal
failures clean up the stored payload.

One concrete producer today is Phoenix nested workflow tracing. The outer
workflow tool span publishes a restorable parent span context asynchronously,
while the nested workflow trace may be picked up by Celery first. In that
ordering window, the provider raises a retryable core exception instead of
dropping the trace or emitting it under the wrong parent. The task intentionally
does not know that the provider is Phoenix; it only honors the core retryable
dispatch contract.
"""

import json
import logging

from celery import shared_task
from celery.exceptions import Retry
from flask import current_app

from configs import dify_config
from core.ops.entities.config_entity import OPS_FILE_PATH, OPS_TRACE_FAILED_KEY
from core.ops.entities.trace_entity import trace_info_info_map
from core.ops.exceptions import RetryableTraceDispatchError
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.model import Message
from models.workflow import WorkflowRun

logger = logging.getLogger(__name__)

_RETRYABLE_TRACE_DISPATCH_LIMIT = dify_config.OPS_TRACE_RETRYABLE_DISPATCH_MAX_RETRIES
_RETRYABLE_TRACE_DISPATCH_DELAY_SECONDS = dify_config.OPS_TRACE_RETRYABLE_DISPATCH_DELAY_SECONDS


@shared_task(
    queue="ops_trace",
    bind=True,
    max_retries=_RETRYABLE_TRACE_DISPATCH_LIMIT,
    default_retry_delay=_RETRYABLE_TRACE_DISPATCH_DELAY_SECONDS,
)
def process_trace_tasks(self, file_info):
    """
    Async process trace tasks
    Usage: process_trace_tasks.delay(tasks_data)
    """
    from core.ops.ops_trace_manager import OpsTraceManager

    app_id = file_info.get("app_id")
    file_id = file_info.get("file_id")
    file_path = f"{OPS_FILE_PATH}{app_id}/{file_id}.json"
    file_data = json.loads(storage.load(file_path))
    trace_info = file_data.get("trace_info")
    trace_info_type = file_data.get("trace_info_type")
    enterprise_trace_dispatched = bool(file_data.get("_enterprise_trace_dispatched"))
    trace_instance = OpsTraceManager.get_ops_trace_instance(app_id)

    if trace_info.get("message_data"):
        trace_info["message_data"] = Message.from_dict(data=trace_info["message_data"])
    if trace_info.get("workflow_data"):
        trace_info["workflow_data"] = WorkflowRun.from_dict(data=trace_info["workflow_data"])
    if trace_info.get("documents"):
        trace_info["documents"] = [Document.model_validate(doc) for doc in trace_info["documents"]]

    should_delete_file = True

    try:
        trace_type = trace_info_info_map.get(trace_info_type)
        if trace_type:
            trace_info = trace_type(**trace_info)

        from extensions.ext_enterprise_telemetry import is_enabled as is_ee_telemetry_enabled

        if is_ee_telemetry_enabled() and not enterprise_trace_dispatched:
            from enterprise.telemetry.enterprise_trace import EnterpriseOtelTrace

            try:
                EnterpriseOtelTrace().trace(trace_info)
            except Exception:
                logger.exception("Enterprise trace failed for app_id: %s", app_id)
            else:
                file_data["_enterprise_trace_dispatched"] = True
                enterprise_trace_dispatched = True

        if trace_instance:
            with current_app.app_context():
                trace_instance.trace(trace_info)

        logger.info("Processing trace tasks success, app_id: %s", app_id)
    except RetryableTraceDispatchError as e:
        # Retryable dispatch failures represent a transient provider-side
        # ordering gap, not corrupt payload data. Keep the payload only after
        # Celery accepts the retry request; otherwise this attempt becomes a
        # terminal failure and the stored file is cleaned up in `finally`.
        #
        # Enterprise telemetry runs before provider dispatch. If it already ran
        # and provider dispatch asks for a retry, persist that private flag so
        # the next attempt does not emit the same enterprise trace twice.
        if self.request.retries >= _RETRYABLE_TRACE_DISPATCH_LIMIT:
            logger.exception("Retryable trace dispatch budget exhausted, app_id: %s", app_id)
            failed_key = f"{OPS_TRACE_FAILED_KEY}_{app_id}"
            redis_client.incr(failed_key)
        else:
            logger.warning(
                "Retryable trace dispatch failure, scheduling retry %s/%s for app_id %s: %s",
                self.request.retries + 1,
                _RETRYABLE_TRACE_DISPATCH_LIMIT,
                app_id,
                e,
            )
            try:
                if enterprise_trace_dispatched:
                    storage.save(file_path, json.dumps(file_data).encode("utf-8"))
                raise self.retry(exc=e, countdown=_RETRYABLE_TRACE_DISPATCH_DELAY_SECONDS)
            except Retry:
                should_delete_file = False
                raise
            except Exception:
                logger.exception("Failed to schedule trace dispatch retry, app_id: %s", app_id)
                failed_key = f"{OPS_TRACE_FAILED_KEY}_{app_id}"
                redis_client.incr(failed_key)
    except Exception as e:
        logger.exception("Processing trace tasks failed, app_id: %s", app_id)
        failed_key = f"{OPS_TRACE_FAILED_KEY}_{app_id}"
        redis_client.incr(failed_key)
    finally:
        if should_delete_file:
            try:
                storage.delete(file_path)
            except Exception as e:
                logger.warning(
                    "Failed to delete trace file %s for app_id %s: %s",
                    file_path,
                    app_id,
                    e,
                )
