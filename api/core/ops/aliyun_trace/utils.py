import json
from typing import Any

from opentelemetry.trace import Link, Status, StatusCode

from core.ops.aliyun_trace.data_exporter.traceclient import convert_datetime_to_nanoseconds, convert_to_span_id
from core.ops.aliyun_trace.entities.aliyun_trace_entity import SpanData
from core.ops.aliyun_trace.entities.semconv import (
    GEN_AI_COMPLETION,
    GEN_AI_FRAMEWORK,
    GEN_AI_MODEL_NAME,
    GEN_AI_PROMPT,
    GEN_AI_PROMPT_TEMPLATE_TEMPLATE,
    GEN_AI_PROMPT_TEMPLATE_VARIABLE,
    GEN_AI_SESSION_ID,
    GEN_AI_SPAN_KIND,
    GEN_AI_SYSTEM,
    GEN_AI_USAGE_INPUT_TOKENS,
    GEN_AI_USAGE_OUTPUT_TOKENS,
    GEN_AI_USAGE_TOTAL_TOKENS,
    GEN_AI_USER_ID,
    INPUT_VALUE,
    OUTPUT_VALUE,
    GenAISpanKind,
)
from core.ops.entities.trace_entity import MessageTraceInfo
from core.rag.models.document import Document
from extensions.ext_database import db
from models import EndUser

# Constants
DEFAULT_JSON_ENSURE_ASCII = False
DEFAULT_FRAMEWORK_NAME = "dify"


def get_user_id_from_message_data(message_data) -> str:
    user_id = message_data.from_account_id
    if message_data.from_end_user_id:
        end_user_data: EndUser | None = (
            db.session.query(EndUser).where(EndUser.id == message_data.from_end_user_id).first()
        )
        if end_user_data is not None:
            user_id = end_user_data.session_id
    return user_id


def create_status_from_error(error: str | None) -> Status:
    if error:
        return Status(StatusCode.ERROR, error)
    return Status(StatusCode.OK)


def create_links_from_trace_id(trace_id: str | None) -> list[Link]:
    from core.ops.aliyun_trace.data_exporter.traceclient import create_link

    links = []
    if trace_id:
        links.append(create_link(trace_id_str=trace_id))
    return links


def create_llm_span_data(
    trace_id: int,
    parent_span_id: int,
    message_id: str,
    trace_info: MessageTraceInfo,
    user_id: str,
    status: Status,
    inputs_json: str,
    outputs_str: str,
) -> SpanData:
    app_model_config = getattr(trace_info.message_data, "app_model_config", {})
    pre_prompt = getattr(app_model_config, "pre_prompt", "")
    inputs_data = getattr(trace_info.message_data, "inputs", {})

    return SpanData(
        trace_id=trace_id,
        parent_span_id=parent_span_id,
        span_id=convert_to_span_id(message_id, "llm"),
        name="llm",
        start_time=convert_datetime_to_nanoseconds(trace_info.start_time),
        end_time=convert_datetime_to_nanoseconds(trace_info.end_time),
        attributes={
            GEN_AI_SESSION_ID: trace_info.metadata.get("conversation_id") or "",
            GEN_AI_USER_ID: str(user_id),
            GEN_AI_SPAN_KIND: GenAISpanKind.LLM,
            GEN_AI_FRAMEWORK: DEFAULT_FRAMEWORK_NAME,
            GEN_AI_MODEL_NAME: trace_info.metadata.get("ls_model_name") or "",
            GEN_AI_SYSTEM: trace_info.metadata.get("ls_provider") or "",
            GEN_AI_USAGE_INPUT_TOKENS: str(trace_info.message_tokens),
            GEN_AI_USAGE_OUTPUT_TOKENS: str(trace_info.answer_tokens),
            GEN_AI_USAGE_TOTAL_TOKENS: str(trace_info.total_tokens),
            GEN_AI_PROMPT_TEMPLATE_VARIABLE: json.dumps(inputs_data, ensure_ascii=DEFAULT_JSON_ENSURE_ASCII),
            GEN_AI_PROMPT_TEMPLATE_TEMPLATE: pre_prompt,
            GEN_AI_PROMPT: inputs_json,
            GEN_AI_COMPLETION: outputs_str,
            INPUT_VALUE: inputs_json,
            OUTPUT_VALUE: outputs_str,
        },
        status=status,
    )


def extract_retrieval_documents(documents: list[Document]) -> list[dict[str, Any]]:
    documents_data = []
    for document in documents:
        document_data = {
            "content": document.page_content,
            "metadata": {
                "dataset_id": document.metadata.get("dataset_id"),
                "doc_id": document.metadata.get("doc_id"),
                "document_id": document.metadata.get("document_id"),
            },
            "score": document.metadata.get("score"),
        }
        documents_data.append(document_data)
    return documents_data


def serialize_json_data(data: Any, ensure_ascii: bool = DEFAULT_JSON_ENSURE_ASCII) -> str:
    return json.dumps(data, ensure_ascii=ensure_ascii)


def create_common_span_attributes(
    session_id: str = "",
    user_id: str = "",
    span_kind: str = GenAISpanKind.CHAIN,
    framework: str = DEFAULT_FRAMEWORK_NAME,
    inputs: str = "",
    outputs: str = "",
) -> dict[str, Any]:
    return {
        GEN_AI_SESSION_ID: session_id,
        GEN_AI_USER_ID: user_id,
        GEN_AI_SPAN_KIND: span_kind,
        GEN_AI_FRAMEWORK: framework,
        INPUT_VALUE: inputs,
        OUTPUT_VALUE: outputs,
    }
