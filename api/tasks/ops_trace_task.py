import json
import logging

from celery import shared_task  # type: ignore
from flask import current_app

from core.ops.entities.config_entity import OPS_FILE_PATH, OPS_TRACE_FAILED_KEY
from core.ops.entities.trace_entity import trace_info_info_map
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.model import Message
from models.workflow import WorkflowRun


@shared_task(queue="ops_trace")
def process_trace_tasks(file_info):
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
    trace_instance = OpsTraceManager.get_ops_trace_instance(app_id)

    if trace_info.get("message_data"):
        trace_info["message_data"] = Message.from_dict(data=trace_info["message_data"])
    if trace_info.get("workflow_data"):
        trace_info["workflow_data"] = WorkflowRun.from_dict(data=trace_info["workflow_data"])
    if trace_info.get("documents"):
        trace_info["documents"] = [Document(**doc) for doc in trace_info["documents"]]

    try:
        if trace_instance:
            with current_app.app_context():
                trace_type = trace_info_info_map.get(trace_info_type)
                if trace_type:
                    trace_info = trace_type(**trace_info)
                trace_instance.trace(trace_info)
        logging.info(f"Processing trace tasks success, app_id: {app_id}")
    except Exception as e:
        logging.info(
            f"error:\n\n\n{e}\n\n\n\n",
        )
        failed_key = f"{OPS_TRACE_FAILED_KEY}_{app_id}"
        redis_client.incr(failed_key)
        logging.info(f"Processing trace tasks failed, app_id: {app_id}")
    finally:
        storage.delete(file_path)
