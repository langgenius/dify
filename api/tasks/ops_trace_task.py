import logging
import time

from celery import shared_task
from flask import current_app

from core.ops.entities.trace_entity import trace_info_info_map
from core.rag.models.document import Document
from models.model import Message
from models.workflow import WorkflowRun


@shared_task(queue='ops_trace')
def process_trace_tasks(tasks_data):
    """
    Async process trace tasks
    :param tasks_data: List of dictionaries containing task data

    Usage: process_trace_tasks.delay(tasks_data)
    """
    from core.ops.ops_trace_manager import OpsTraceManager

    trace_info = tasks_data.get('trace_info')
    app_id = tasks_data.get('app_id')
    trace_info_type = tasks_data.get('trace_info_type')
    trace_instance = OpsTraceManager.get_ops_trace_instance(app_id)

    if trace_info.get('message_data'):
        trace_info['message_data'] = Message.from_dict(data=trace_info['message_data'])
    if trace_info.get('workflow_data'):
        trace_info['workflow_data'] = WorkflowRun.from_dict(data=trace_info['workflow_data'])
    if trace_info.get('documents'):
        trace_info['documents'] = [Document(**doc) for doc in trace_info['documents']]

    try:
        if trace_instance:
            with current_app.app_context():
                trace_type = trace_info_info_map.get(trace_info_type)
                if trace_type:
                    trace_info = trace_type(**trace_info)
                trace_instance.trace(trace_info)
            end_at = time.perf_counter()
    except Exception:
        logging.exception("Processing trace tasks failed")
