import datetime
import json
import uuid
from typing import Optional

from core.ops.aliyun_trace.data_exporter.traceclient import TraceClient
from core.ops.aliyun_trace.entities.aliyun_trace_entity import SpanData
from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import AliyunConfig
from core.ops.entities.trace_entity import (
    BaseTraceInfo,
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    ToolTraceInfo,
    WorkflowTraceInfo,
)
from models import EndUser, db


def convert_to_trace_id(uuid_v4:str) -> int:
    try:
        uuid_obj = uuid.UUID(uuid_v4)
        return uuid_obj.int
    except Exception as e:
        raise ValueError(f"Invalid UUID input: {e}")

def convert_to_span_id(uuid_v4:str, span_type:str) -> int:
    try:
        uuid_obj = uuid.UUID(uuid_v4)
    except Exception as e:
        raise ValueError(f"Invalid UUID input: {e}")

    type_hash = hash(span_type) & 0xFFFFFFFFFFFFFFFF
    span_id = (uuid_obj.int & 0xFFFFFFFFFFFFFFFF) ^ type_hash

    return span_id

def convert_datetime_to_nanoseconds(start_time_a: Optional[datetime]) -> Optional[int]:
    if start_time_a is None:
        return None
    timestamp_in_seconds = start_time_a.timestamp()
    timestamp_in_nanoseconds = int(timestamp_in_seconds * 1e9)
    return timestamp_in_nanoseconds


class AliyunDataTrace(BaseTraceInstance):

    def __init__(
        self,
        aliyun_config: AliyunConfig,
    ):
        super().__init__(aliyun_config)
        endpoint = aliyun_config.endpoint+aliyun_config.license_key+'/api/otlp/traces'
        self.trace_client = TraceClient(service_name=aliyun_config.app_name,endpoint=endpoint)

    def trace(self, trace_info: BaseTraceInfo):
        if isinstance(trace_info, WorkflowTraceInfo):
            self.workflow_trace(trace_info)
        if isinstance(trace_info, MessageTraceInfo):
            self.message_trace(trace_info)
        if isinstance(trace_info, ModerationTraceInfo):
            pass
        if isinstance(trace_info, SuggestedQuestionTraceInfo):
            pass
        if isinstance(trace_info, DatasetRetrievalTraceInfo):
            self.dataset_retrieval_trace(trace_info)
        if isinstance(trace_info, ToolTraceInfo):
            self.tool_trace(trace_info)
        if isinstance(trace_info, GenerateNameTraceInfo):
            pass

    def api_check(self):
        # todo
        return True

    def workflow_trace(self, trace_info: WorkflowTraceInfo):
        pass

    def message_trace(self, trace_info: MessageTraceInfo):
        # get message file data
        file_list = trace_info.file_list
        metadata = trace_info.metadata
        message_data = trace_info.message_data
        if message_data is None:
            return
        message_id = trace_info.message_id

        user_id = message_data.from_account_id
        if message_data.from_end_user_id:
            end_user_data: Optional[EndUser] = (
                db.session.query(EndUser).filter(EndUser.id == message_data.from_end_user_id).first()
            )
            if end_user_data is not None:
                user_id = end_user_data.session_id

        message_span = SpanData(
            trace_id=convert_to_trace_id(message_id),
            parent_span_id=None,
            span_id=convert_to_span_id(message_id,'message'),
            name='message',
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                'gen_ai.session.id': trace_info.metadata.get('conversation_id',''),
                'gen_ai.user.id':str(user_id),
                'gen_ai.span.kind':'CHAIN',
                'gen_ai.framework': 'dify',

                'input.value':json.dumps(trace_info.inputs),
                'output.value': str(trace_info.outputs),
            }
        )
        self.trace_client.add_span(message_span)

        llm_span = SpanData(
            trace_id=convert_to_trace_id(message_id),
            parent_span_id=convert_to_span_id(message_id,'message'),
            span_id=convert_to_span_id(message_id,'llm'),
            name='llm',
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                'gen_ai.session.id': trace_info.metadata.get('conversation_id',''),
                'gen_ai.user.id': str(user_id),
                'gen_ai.span.kind':'LLM',
                'gen_ai.framework': 'dify',

                'gen_ai.prompt_template.template': 'todo',
                'gen_ai.model_name':trace_info.message_data.model_id,

                'input.value':json.dumps(trace_info.inputs),
                'output.value': str(trace_info.outputs),
            }
        )

        self.trace_client.add_span(llm_span)


    def dataset_retrieval_trace(self, trace_info: DatasetRetrievalTraceInfo):
        if trace_info.message_data is None:
            return
        message_id = trace_info.message_id

        span_data = SpanData(
            trace_id=convert_to_trace_id(message_id),
            parent_span_id=convert_to_span_id(message_id,'message'),
            span_id=convert_to_span_id(message_id,'dataset_retrieval'),
            name='dataset_retrieval',
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                'gen_ai.session.id': 'todo',
                'gen_ai.user.id': 'todo',
                'gen_ai.span.kind': 'RETRIEVER',
                'gen_ai.framework': 'dify',

                'gen_ai.operation.name': 'TASK',
                'retrieval.query':str(trace_info.inputs),
                'retrieval.document	':str(trace_info.documents)
            }
        )
        self.trace_client.add_span(span_data)

    def tool_trace(self, trace_info: ToolTraceInfo):
        if trace_info.message_data is None:
            return
        message_id = trace_info.message_id

        span_data = SpanData(
            trace_id=convert_to_trace_id(message_id),
            parent_span_id=convert_to_span_id(message_id,'message'),
            span_id=convert_to_span_id(message_id,'tool'),
            name='tool',
            start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
            end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
            attributes={
                'gen_ai.session.id': 'todo',
                'gen_ai.user.id': 'todo',
                'gen_ai.span.kind': 'Tool',
                'gen_ai.framework': 'dify',

                'tool.name': trace_info.tool_name,
                'tool.description': trace_info.tool_name,
                'tool.parameters': json.dumps(trace_info.tool_inputs),
                'input.value': json.dumps(trace_info.inputs),
                'output.value': str(trace_info.tool_outputs),
            }
        )
        self.trace_client.add_span(span_data)
