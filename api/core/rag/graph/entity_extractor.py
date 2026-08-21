"""LLM-backed entity and relation extraction for knowledge-graph indexing."""

import concurrent.futures
import logging
from typing import Any, cast

from flask import Flask, current_app

from configs import dify_config
from core.model_manager import ModelManager
from core.rag.graph.entities import (
    UNKNOWN_ENTITY_TYPE,
    ChunkGraph,
    GraphEntity,
    GraphExtraction,
    GraphIndexSetting,
    GraphRelation,
    normalize_display_name,
    normalize_entity_name,
)
from core.rag.graph.prompts import GRAPH_EXTRACTION_PROMPT, GRAPH_QUERY_ENTITY_PROMPT
from core.rag.models.document import Document
from graphon.model_runtime.entities.llm_entities import LLMResult
from graphon.model_runtime.entities.message_entities import PromptMessage, UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from libs.json_in_md_parser import parse_json_markdown

logger = logging.getLogger(__name__)

# Relation labels are stored in a String(255) column.
MAX_PREDICATE_LENGTH = 255
MAX_DESCRIPTION_LENGTH = 2000


class EntityRelationExtractor:
    """Extracts a per-chunk subgraph using the dataset's configured LLM.

    Extraction is best-effort by design: a chunk whose extraction fails is
    skipped with a warning rather than failing the whole indexing run, because
    the vector/keyword index for that chunk is already valid on its own and the
    graph is an enhancement layer over it.
    """

    def __init__(self, tenant_id: str, setting: GraphIndexSetting):
        if not setting.model_provider_name or not setting.model_name:
            raise ValueError("model_provider_name and model_name are required for graph extraction")
        self._tenant_id = tenant_id
        self._setting = setting

    def extract(self, text: str) -> GraphExtraction:
        """Extract entities and relations from a single chunk of text."""
        if not text or not text.strip():
            return GraphExtraction()

        prompt = self._build_prompt(text)
        raw = self._invoke_llm(prompt)
        return self.parse_extraction(raw)

    def extract_documents(self, documents: list[Document]) -> list[ChunkGraph]:
        """Extract subgraphs for many chunks concurrently.

        Returns one :class:`ChunkGraph` per chunk that produced at least one
        entity. Chunks missing provenance metadata are skipped, since a fact we
        cannot cite is not useful for retrieval.
        """
        pending: list[Document] = []
        for document in documents:
            metadata = document.metadata or {}
            if metadata.get("doc_id") and metadata.get("document_id"):
                pending.append(document)
        if not pending:
            return []

        flask_app: Flask | None = None
        try:
            flask_app = cast(Flask, current_app._get_current_object())  # type: ignore[attr-defined]
        except RuntimeError:
            logger.warning("No Flask application context available for graph extraction")

        results: list[ChunkGraph] = []
        max_workers = min(dify_config.KNOWLEDGE_GRAPH_EXTRACTION_WORKERS, len(pending))
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(self._extract_one, flask_app, document): document for document in pending}
            for future in concurrent.futures.as_completed(futures):
                chunk_graph = future.result()
                if chunk_graph and chunk_graph.extraction.entities:
                    results.append(chunk_graph)
        return results

    def extract_query_entities(self, query: str) -> list[str]:
        """Extract candidate entity mentions from a user query.

        Used as a fallback when lexical matching against the stored entity names
        finds no seed, which is common for paraphrased or multi-hop questions.
        """
        if not query or not query.strip():
            return []
        try:
            raw = self._invoke_llm(GRAPH_QUERY_ENTITY_PROMPT.format(query=query))
            parsed = parse_json_markdown(raw)
        except Exception:
            logger.warning("Failed to extract query entities from the query", exc_info=True)
            return []

        entities = parsed.get("entities") if isinstance(parsed, dict) else None
        if not isinstance(entities, list):
            return []
        seen: set[str] = set()
        mentions: list[str] = []
        for item in entities:
            if not isinstance(item, str):
                continue
            normalized = normalize_entity_name(item)
            if normalized and normalized not in seen:
                seen.add(normalized)
                mentions.append(normalized)
        return mentions

    def _extract_one(self, flask_app: Flask | None, document: Document) -> ChunkGraph | None:
        metadata = document.metadata or {}
        try:
            if flask_app:
                with flask_app.app_context():
                    extraction = self.extract(document.page_content)
            else:
                extraction = self.extract(document.page_content)
        except Exception:
            # A failed chunk must not abort indexing: the chunk stays searchable
            # through the vector/keyword index, it just has no graph facts.
            logger.warning("Graph extraction failed for chunk %s", metadata.get("doc_id"), exc_info=True)
            return None

        return ChunkGraph(
            index_node_id=str(metadata["doc_id"]),
            document_id=str(metadata["document_id"]),
            extraction=extraction,
        )

    def _build_prompt(self, text: str) -> str:
        if self._setting.extract_prompt:
            # Custom prompts are responsible for their own formatting; only the
            # text is appended so user templates are never silently rewritten.
            return f"{self._setting.extract_prompt}\n\nTEXT:\n{text}"
        entity_types = ", ".join(self._setting.entity_types) or "CONCEPT"
        return GRAPH_EXTRACTION_PROMPT.format(
            entity_types=entity_types,
            max_entities=self._setting.max_entities_per_chunk,
            text=text,
        )

    def _invoke_llm(self, prompt: str) -> str:
        model_manager = ModelManager.for_tenant(tenant_id=self._tenant_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=self._tenant_id,
            provider=cast(str, self._setting.model_provider_name),
            model_type=ModelType.LLM,
            model=cast(str, self._setting.model_name),
        )
        prompt_messages: list[PromptMessage] = [UserPromptMessage(content=prompt)]
        result = model_instance.invoke_llm(prompt_messages=prompt_messages, model_parameters={}, stream=False)
        if not isinstance(result, LLMResult):
            raise ValueError("Expected LLMResult when stream=False")
        return result.message.get_text_content()

    @classmethod
    def parse_extraction(cls, raw: str) -> GraphExtraction:
        """Parse and sanitize the model's JSON answer into a :class:`GraphExtraction`.

        Malformed output yields an empty extraction rather than an exception, and
        relation endpoints that the model forgot to list are back-filled as
        untyped entities so the edge is not lost.
        """
        try:
            parsed = parse_json_markdown(raw)
        except Exception:
            logger.warning("Graph extraction returned unparsable output")
            return GraphExtraction()
        if not isinstance(parsed, dict):
            return GraphExtraction()

        entities: dict[str, GraphEntity] = {}
        for item in cls._as_list(parsed.get("entities")):
            entity = cls._parse_entity(item)
            if not entity:
                continue
            existing = entities.get(entity.name)
            if existing is None:
                entities[entity.name] = entity
            else:
                # Keep the richer description and the more specific type.
                if len(entity.description) > len(existing.description):
                    existing.description = entity.description
                if existing.entity_type == UNKNOWN_ENTITY_TYPE:
                    existing.entity_type = entity.entity_type

        relations: dict[tuple[str, str, str], GraphRelation] = {}
        for item in cls._as_list(parsed.get("relations")):
            relation = cls._parse_relation(item)
            if not relation:
                continue
            for endpoint in (relation.source, relation.target):
                if endpoint not in entities:
                    entities[endpoint] = GraphEntity(
                        name=endpoint,
                        display_name=endpoint,
                        entity_type=UNKNOWN_ENTITY_TYPE,
                        description="",
                    )
            key = (relation.source, relation.target, relation.predicate)
            if key not in relations:
                relations[key] = relation

        return GraphExtraction(entities=list(entities.values()), relations=list(relations.values()))

    @staticmethod
    def _as_list(value: Any) -> list[Any]:
        return value if isinstance(value, list) else []

    @staticmethod
    def _parse_entity(item: Any) -> GraphEntity | None:
        if not isinstance(item, dict):
            return None
        raw_name = item.get("name")
        if not isinstance(raw_name, str):
            return None
        name = normalize_entity_name(raw_name)
        if not name:
            return None
        raw_type = item.get("type") or item.get("entity_type")
        entity_type = (
            normalize_display_name(raw_type).upper()[:64] if isinstance(raw_type, str) else UNKNOWN_ENTITY_TYPE
        )
        description = item.get("description")
        return GraphEntity(
            name=name,
            display_name=normalize_display_name(raw_name) or name,
            entity_type=entity_type or UNKNOWN_ENTITY_TYPE,
            description=description[:MAX_DESCRIPTION_LENGTH] if isinstance(description, str) else "",
        )

    @staticmethod
    def _parse_relation(item: Any) -> GraphRelation | None:
        if not isinstance(item, dict):
            return None
        raw_source = item.get("source")
        raw_target = item.get("target")
        raw_predicate = item.get("predicate") or item.get("relation")
        if not isinstance(raw_source, str) or not isinstance(raw_target, str):
            return None
        source = normalize_entity_name(raw_source)
        target = normalize_entity_name(raw_target)
        if not source or not target or source == target:
            return None
        predicate = (
            normalize_display_name(raw_predicate).replace(" ", "_").lower()[:MAX_PREDICATE_LENGTH]
            if isinstance(raw_predicate, str)
            else ""
        )
        if not predicate:
            predicate = "related_to"
        description = item.get("description")
        return GraphRelation(
            source=source,
            target=target,
            predicate=predicate,
            description=description[:MAX_DESCRIPTION_LENGTH] if isinstance(description, str) else "",
        )
