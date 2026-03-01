import json
from collections.abc import Mapping
from typing import Any

from opentelemetry.trace import Link, Status, StatusCode

from core.ops.aliyun_trace.entities.semconv import (
    GEN_AI_FRAMEWORK,
    GEN_AI_SESSION_ID,
    GEN_AI_SPAN_KIND,
    GEN_AI_USER_ID,
    INPUT_VALUE,
    OUTPUT_VALUE,
    GenAISpanKind,
)
from core.rag.models.document import Document
from core.workflow.entities import WorkflowNodeExecution
from core.workflow.enums import WorkflowNodeExecutionStatus
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


def get_workflow_node_status(node_execution: WorkflowNodeExecution) -> Status:
    if node_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED:
        return Status(StatusCode.OK)
    if node_execution.status in [WorkflowNodeExecutionStatus.FAILED, WorkflowNodeExecutionStatus.EXCEPTION]:
        return Status(StatusCode.ERROR, str(node_execution.error))
    return Status(StatusCode.UNSET)


def create_links_from_trace_id(trace_id: str | None) -> list[Link]:
    from core.ops.aliyun_trace.data_exporter.traceclient import create_link

    links = []
    if trace_id:
        links.append(create_link(trace_id_str=trace_id))
    return links


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


def format_retrieval_documents(retrieval_documents: list) -> list:
    try:
        if not isinstance(retrieval_documents, list):
            return []

        semantic_documents = []
        for doc in retrieval_documents:
            if not isinstance(doc, dict):
                continue

            metadata = doc.get("metadata", {})
            content = doc.get("content", "")
            title = doc.get("title", "")
            score = metadata.get("score", 0.0)
            document_id = metadata.get("document_id", "")

            semantic_metadata = {}
            if title:
                semantic_metadata["title"] = title
            if metadata.get("source"):
                semantic_metadata["source"] = metadata["source"]
            elif metadata.get("_source"):
                semantic_metadata["source"] = metadata["_source"]
            if metadata.get("doc_metadata"):
                doc_metadata = metadata["doc_metadata"]
                if isinstance(doc_metadata, dict):
                    semantic_metadata.update(doc_metadata)

            semantic_doc = {
                "document": {"content": content, "metadata": semantic_metadata, "score": score, "id": document_id}
            }
            semantic_documents.append(semantic_doc)

        return semantic_documents
    except Exception:
        return []


def format_input_messages(process_data: Mapping[str, Any]) -> str:
    try:
        if not isinstance(process_data, dict):
            return serialize_json_data([])

        prompts = process_data.get("prompts", [])
        if not prompts:
            return serialize_json_data([])

        valid_roles = {"system", "user", "assistant", "tool"}
        input_messages = []
        for prompt in prompts:
            if not isinstance(prompt, dict):
                continue

            role = prompt.get("role", "")
            text = prompt.get("text", "")

            if not role or role not in valid_roles:
                continue

            if text:
                message = {"role": role, "parts": [{"type": "text", "content": text}]}
                input_messages.append(message)

        return serialize_json_data(input_messages)
    except Exception:
        return serialize_json_data([])


def format_output_messages(outputs: Mapping[str, Any]) -> str:
    try:
        if not isinstance(outputs, dict):
            return serialize_json_data([])

        text = outputs.get("text", "")
        finish_reason = outputs.get("finish_reason", "")

        if not text:
            return serialize_json_data([])

        valid_finish_reasons = {"stop", "length", "content_filter", "tool_call", "error"}
        if finish_reason not in valid_finish_reasons:
            finish_reason = "stop"

        output_message = {
            "role": "assistant",
            "parts": [{"type": "text", "content": text}],
            "finish_reason": finish_reason,
        }

        return serialize_json_data([output_message])
    except Exception:
        return serialize_json_data([])
