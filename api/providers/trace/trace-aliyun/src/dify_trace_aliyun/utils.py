import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, TypedDict

from opentelemetry.trace import Link, Status, StatusCode

from core.rag.models.document import Document
from dify_trace_aliyun.entities.semconv import (
    GEN_AI_FRAMEWORK,
    GEN_AI_SESSION_ID,
    GEN_AI_SPAN_KIND,
    GEN_AI_USER_ID,
    INPUT_VALUE,
    OUTPUT_VALUE,
    GenAISpanKind,
)
from extensions.ext_database import db
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionStatus
from models import EndUser

# Constants
DEFAULT_JSON_ENSURE_ASCII = False
DEFAULT_FRAMEWORK_NAME = "dify"


def get_user_id_from_message_data(message_data) -> str:
    user_id = message_data.from_account_id
    if message_data.from_end_user_id:
        end_user_data: EndUser | None = db.session.get(EndUser, message_data.from_end_user_id)
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
    from dify_trace_aliyun.data_exporter.traceclient import create_link

    links = []
    if trace_id:
        links.append(create_link(trace_id_str=trace_id))
    return links


class RetrievalDocumentMetadataDict(TypedDict):
    dataset_id: Any
    doc_id: Any
    document_id: Any


class RetrievalDocumentDict(TypedDict):
    content: str
    metadata: RetrievalDocumentMetadataDict
    score: Any


def extract_retrieval_documents(documents: list[Document]) -> list[RetrievalDocumentDict]:
    documents_data: list[RetrievalDocumentDict] = []
    for document in documents:
        document_data: RetrievalDocumentDict = {
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
) -> dict[str, str]:
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


def convert_seconds_to_nanoseconds(seconds: float) -> int:
    return int(seconds * 1e9)


_REACT_ROUND_LABEL_PATTERN = re.compile(r"ROUND\s+(\d+)", re.IGNORECASE)
_LLM_THOUGHT_LABEL_SUFFIX = " Thought"


@dataclass
class AgentLogEntry:
    """One entry of the agent-strategy execution log (``outputs["json"]`` of an agent node).

    Entries form a tree via ``parent_id``: top-level entries are ReAct rounds
    (label like ``ROUND 1``) and their children are LLM thoughts / tool calls.
    ``started_at``/``finished_at`` in ``metadata`` are monotonic-clock seconds
    (``time.perf_counter``), not epoch timestamps.
    """

    id: str
    parent_id: str | None
    label: str
    status: str
    error: str | None
    data: dict[str, Any]
    metadata: dict[str, Any]
    children: list["AgentLogEntry"] = field(default_factory=list)


def parse_agent_log_entries(outputs: Mapping[str, Any]) -> list[AgentLogEntry]:
    """Parse agent node outputs into a tree of log entries, returning top-level rounds in order.

    Entries without an ``id`` (e.g. the trailing ``{"data": []}`` element) are skipped.
    Children whose parent is missing are dropped.
    """
    raw_entries = outputs.get("json")
    if not isinstance(raw_entries, list):
        return []

    entries: list[AgentLogEntry] = []
    entries_by_id: dict[str, AgentLogEntry] = {}
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            continue
        entry_id = raw_entry.get("id")
        if not entry_id:
            continue
        data = raw_entry.get("data")
        metadata = raw_entry.get("metadata")
        entry = AgentLogEntry(
            id=str(entry_id),
            parent_id=raw_entry.get("parent_id"),
            label=str(raw_entry.get("label") or ""),
            status=str(raw_entry.get("status") or ""),
            error=raw_entry.get("error"),
            data=data if isinstance(data, dict) else {},
            metadata=metadata if isinstance(metadata, dict) else {},
        )
        entries.append(entry)
        entries_by_id[entry.id] = entry

    roots: list[AgentLogEntry] = []
    for entry in entries:
        if entry.parent_id is None:
            roots.append(entry)
        else:
            parent = entries_by_id.get(entry.parent_id)
            if parent is not None:
                parent.children.append(entry)
    return roots


def extract_react_round_number(label: str, fallback: int) -> int:
    match = _REACT_ROUND_LABEL_PATTERN.search(label)
    if match:
        return int(match.group(1))
    return fallback


def is_llm_thought_entry(entry: AgentLogEntry) -> bool:
    """LLM thought entries carry the model provider in metadata (e.g. label ``{model} Thought``)."""
    return bool(entry.metadata.get("provider")) or entry.label.endswith(_LLM_THOUGHT_LABEL_SUFFIX)


def extract_model_name_from_thought_label(label: str) -> str:
    if label.endswith(_LLM_THOUGHT_LABEL_SUFFIX):
        return label.removesuffix(_LLM_THOUGHT_LABEL_SUFFIX)
    return ""


def create_status_from_agent_log_entry(entry: AgentLogEntry) -> Status:
    if entry.error:
        return Status(StatusCode.ERROR, str(entry.error))
    if entry.status == "success":
        return Status(StatusCode.OK)
    return Status(StatusCode.UNSET)


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
