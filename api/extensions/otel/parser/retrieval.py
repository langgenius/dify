"""
Parser for knowledge retrieval nodes that captures retrieval-specific metadata.
"""

import logging

from opentelemetry.trace import Span

from core.variables import Segment
from core.variables.segments import ArrayObjectSegment
from core.workflow.graph_events import GraphNodeEventBase
from core.workflow.nodes.base.node import Node
from extensions.otel.parser.base import DefaultNodeOTelParser, _safe_json_dumps
from extensions.otel.semconv.gen_ai import RetrieverAttributes

logger = logging.getLogger(__name__)


def _format_retrieval_documents(retrieval_documents: list) -> list:
    """
    Format retrieval documents for semantic conventions.

    Args:
        retrieval_documents: List of retrieval document dictionaries

    Returns:
        List of formatted semantic documents
    """
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
    except Exception as e:
        logger.warning("Failed to format retrieval documents: %s", e, exc_info=True)
        return []


class RetrievalNodeOTelParser:
    """Parser for knowledge retrieval nodes that captures retrieval-specific metadata."""

    def __init__(self) -> None:
        self._delegate = DefaultNodeOTelParser()

    def parse(
        self, *, node: Node, span: "Span", error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        self._delegate.parse(node=node, span=span, error=error, result_event=result_event)

        if not result_event or not result_event.node_run_result:
            return

        node_run_result = result_event.node_run_result
        inputs = node_run_result.inputs or {}
        outputs = node_run_result.outputs or {}

        # Extract query from inputs
        query = str(inputs.get("query", "")) if inputs else ""
        if query:
            span.set_attribute(RetrieverAttributes.QUERY, query)

        # Extract and format retrieval documents from outputs
        result_value = outputs.get("result") if outputs else None
        retrieval_documents = []
        if result_value:
            if isinstance(result_value, ArrayObjectSegment):
                retrieval_documents = result_value.value
            elif isinstance(result_value, list):
                retrieval_documents = result_value
            elif isinstance(result_value, Segment):
                if hasattr(result_value, "value"):
                    value = result_value.value
                    if isinstance(value, list):
                        retrieval_documents = value
                    else:
                        retrieval_documents = []
                else:
                    retrieval_documents = []

        if retrieval_documents:
            semantic_retrieval_documents = _format_retrieval_documents(retrieval_documents)
            semantic_retrieval_documents_json = _safe_json_dumps(semantic_retrieval_documents)
            span.set_attribute(RetrieverAttributes.DOCUMENT, semantic_retrieval_documents_json)

