"""Project trusted runtime evidence into Dify's existing citation event contract."""

from collections.abc import Mapping

from dify_agent.protocol.knowledge_fs import KnowledgeFsCitation
from pydantic import ValidationError

from core.rag.entities.citation_metadata import RetrievalSourceMetadata


def knowledge_sources_from_tool_part(part: object) -> list[RetrievalSourceMetadata]:
    if not isinstance(part, dict) or part.get("part_kind") != "tool-return":
        return []
    metadata = part.get("metadata")
    if not isinstance(metadata, dict) or not isinstance(metadata.get("knowledge_fs_citations"), list):
        return []
    content = part.get("content")
    results = content.get("knowledge_results", []) if isinstance(content, dict) else []
    text_by_receipt: dict[str, str] = {}
    for result in results if isinstance(results, list) else []:
        data = result.get("data") if isinstance(result, dict) else None
        if not isinstance(data, dict):
            continue
        items = data.get("items", []) if "items" in data else [data]
        for item in items if isinstance(items, list) else []:
            if isinstance(item, dict) and isinstance(item.get("receipt_id"), str) and isinstance(item.get("text"), str):
                text_by_receipt[item["receipt_id"]] = item["text"][:4096]
    sources = []
    seen = set()
    for raw in metadata["knowledge_fs_citations"][:100]:
        try:
            citation = KnowledgeFsCitation.model_validate(raw)
        except ValidationError:
            continue
        if citation.id in seen:
            continue
        seen.add(citation.id)
        sources.append(
            RetrievalSourceMetadata(
                dataset_id=citation.control_space_id,
                dataset_name=citation.space_name,
                document_id=citation.document_asset_id,
                document_asset_id=citation.document_asset_id,
                document_version=citation.document_version,
                document_name=citation.document_title or citation.document_asset_id,
                segment_id=citation.node_id,
                index_node_hash=citation.artifact_hash,
                data_source_type="knowledge_fs",
                retriever_from="agent_knowledge_fs_cli",
                content=text_by_receipt.get(citation.id, ""),
                page=citation.page_number,
                knowledge_fs_citation=citation,
            )
        )
    return sources


def knowledge_sources_from_stream_event(data: object) -> list[RetrievalSourceMetadata]:
    if not isinstance(data, Mapping) or data.get("event_kind") != "function_tool_result":
        return []
    # PydanticAI serializes FunctionToolResultEvent under `part`; retain the
    # normalized adapter's `result` alias for older recorded events as well.
    return knowledge_sources_from_tool_part(data.get("part") or data.get("result"))
