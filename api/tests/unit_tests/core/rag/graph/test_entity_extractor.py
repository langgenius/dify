import threading
from collections.abc import Callable, Generator
from contextlib import contextmanager

import pytest

from core.rag.graph import entity_extractor as entity_extractor_module
from core.rag.graph.entities import (
    DEFAULT_ENTITY_TYPES,
    UNKNOWN_ENTITY_TYPE,
    ChunkGraph,
    GraphIndexSetting,
    normalize_display_name,
    normalize_entity_name,
)
from core.rag.graph.entity_extractor import EntityRelationExtractor
from core.rag.models.document import Document
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage
from graphon.model_runtime.entities.model_entities import ModelType

TENANT_ID = "tenant-1"


def _setting(
    *,
    model_provider_name: str | None = "openai",
    model_name: str | None = "gpt-4o-mini",
    entity_types: list[str] | None = None,
    max_entities_per_chunk: int = 16,
    extract_prompt: str | None = None,
) -> GraphIndexSetting:
    return GraphIndexSetting(
        enabled=True,
        model_provider_name=model_provider_name,
        model_name=model_name,
        entity_types=list(DEFAULT_ENTITY_TYPES) if entity_types is None else entity_types,
        max_entities_per_chunk=max_entities_per_chunk,
        extract_prompt=extract_prompt,
    )


def _document(text: str, *, doc_id: str | None = "node-1", document_id: str | None = "doc-1") -> Document:
    metadata: dict[str, object] = {}
    if doc_id is not None:
        metadata["doc_id"] = doc_id
    if document_id is not None:
        metadata["document_id"] = document_id
    return Document(page_content=text, metadata=metadata)


def _answer(entities: str = "", relations: str = "") -> str:
    return f'{{"entities": [{entities}], "relations": [{relations}]}}'


class _FakeModelInstance:
    """Answers extraction prompts from a canned mapping, recording each one."""

    def __init__(self, respond: Callable[[str], object]) -> None:
        self._respond = respond
        self.prompts: list[str] = []
        self.stream_flags: list[bool] = []

    def invoke_llm(
        self,
        *,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, object],  # noqa: ARG002 -- part of the signature under test
        stream: bool,
    ) -> object:
        prompt = str(prompt_messages[0].content)
        self.prompts.append(prompt)
        self.stream_flags.append(stream)
        answer = self._respond(prompt)
        if isinstance(answer, Exception):
            raise answer
        if not isinstance(answer, str):
            return answer
        return LLMResult(
            model="gpt-4o-mini",
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content=answer),
            usage=LLMUsage.empty_usage(),
        )


class _FakeModelManager:
    def __init__(self, instance: _FakeModelInstance) -> None:
        self.instance = instance
        self.requests: list[tuple[str, str, ModelType, str]] = []
        self.tenant_ids: list[str] = []

    def get_model_instance(
        self, *, tenant_id: str, provider: str, model_type: ModelType, model: str
    ) -> _FakeModelInstance:
        self.requests.append((tenant_id, provider, model_type, model))
        return self.instance

    def for_tenant(self, tenant_id: str) -> "_FakeModelManager":
        self.tenant_ids.append(tenant_id)
        return self


@pytest.fixture
def llm(monkeypatch: pytest.MonkeyPatch) -> Callable[..., _FakeModelManager]:
    """Install a stand-in extraction model and hand back its recorder."""

    def _install(respond: Callable[[str], object] | str | Exception) -> _FakeModelManager:
        answer = respond if callable(respond) else (lambda _prompt: respond)
        manager = _FakeModelManager(_FakeModelInstance(answer))
        monkeypatch.setattr(entity_extractor_module, "ModelManager", manager)
        return manager

    return _install


class TestNormalizeEntityName:
    def test_casefolds_and_collapses_whitespace(self) -> None:
        assert normalize_entity_name("  Acme   Corp ") == "acme corp"

    def test_strips_edge_punctuation(self) -> None:
        assert normalize_entity_name('"Acme Corp."') == "acme corp"

    def test_spelling_variants_merge_to_one_key(self) -> None:
        assert normalize_entity_name("ACME Corp") == normalize_entity_name("acme corp")

    def test_display_name_keeps_original_casing(self) -> None:
        assert normalize_display_name("  Acme   Corp. ") == "Acme Corp"

    def test_unicode_is_normalized(self) -> None:
        # Full-width characters must fold onto their ASCII equivalents so the
        # same company does not become two nodes.
        assert normalize_entity_name("ＡＣＭＥ") == "acme"


class TestParseExtraction:
    def test_parses_plain_json(self) -> None:
        raw = """
        {
          "entities": [
            {"name": "Acme Corp", "type": "ORGANIZATION", "description": "A manufacturer."},
            {"name": "Jane Roe", "type": "PERSON", "description": "The CEO."}
          ],
          "relations": [
            {"source": "Jane Roe", "target": "Acme Corp", "predicate": "leads", "description": "Jane leads Acme."}
          ]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert {entity.name for entity in result.entities} == {"acme corp", "jane roe"}
        assert len(result.relations) == 1
        relation = result.relations[0]
        assert relation.source == "jane roe"
        assert relation.target == "acme corp"
        assert relation.predicate == "leads"

    def test_parses_json_inside_code_fence(self) -> None:
        raw = '```json\n{"entities": [{"name": "Acme", "type": "ORGANIZATION"}], "relations": []}\n```'
        result = EntityRelationExtractor.parse_extraction(raw)

        assert [entity.name for entity in result.entities] == ["acme"]

    def test_malformed_output_yields_empty_extraction(self) -> None:
        result = EntityRelationExtractor.parse_extraction("I could not find any entities, sorry!")

        assert result.entities == []
        assert result.relations == []

    def test_relation_endpoints_are_backfilled_as_entities(self) -> None:
        # The model routinely names a relation endpoint it forgot to list; the
        # edge is worth more than the missing type annotation.
        raw = """
        {
          "entities": [{"name": "Acme", "type": "ORGANIZATION"}],
          "relations": [{"source": "Acme", "target": "Globex", "predicate": "acquired"}]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        by_name = {entity.name: entity for entity in result.entities}
        assert set(by_name) == {"acme", "globex"}
        assert by_name["globex"].entity_type == UNKNOWN_ENTITY_TYPE
        assert len(result.relations) == 1

    def test_duplicate_entities_merge_keeping_richest_description(self) -> None:
        raw = """
        {
          "entities": [
            {"name": "Acme", "type": "UNKNOWN", "description": "short"},
            {"name": "ACME", "type": "ORGANIZATION", "description": "a much longer description"}
          ],
          "relations": []
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert len(result.entities) == 1
        entity = result.entities[0]
        assert entity.description == "a much longer description"
        assert entity.entity_type == "ORGANIZATION"

    def test_self_referential_relations_are_dropped(self) -> None:
        raw = """
        {
          "entities": [{"name": "Acme", "type": "ORGANIZATION"}],
          "relations": [{"source": "Acme", "target": "acme", "predicate": "is"}]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert result.relations == []

    def test_predicate_is_normalized_to_snake_case(self) -> None:
        raw = """
        {
          "entities": [],
          "relations": [{"source": "A", "target": "B", "predicate": "Reports To"}]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert result.relations[0].predicate == "reports_to"

    def test_missing_predicate_falls_back_to_related_to(self) -> None:
        raw = """
        {
          "entities": [],
          "relations": [{"source": "A", "target": "B"}]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert result.relations[0].predicate == "related_to"

    def test_non_dict_items_are_ignored(self) -> None:
        raw = '{"entities": ["just a string", {"name": "Acme"}], "relations": [42]}'
        result = EntityRelationExtractor.parse_extraction(raw)

        assert [entity.name for entity in result.entities] == ["acme"]
        assert result.relations == []

    def test_duplicate_relations_are_deduplicated(self) -> None:
        raw = """
        {
          "entities": [],
          "relations": [
            {"source": "A", "target": "B", "predicate": "owns"},
            {"source": "a", "target": "b", "predicate": "owns"}
          ]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert len(result.relations) == 1

    def test_a_json_array_is_not_an_extraction(self) -> None:
        # Valid JSON, wrong shape: the model answered with a bare list.
        result = EntityRelationExtractor.parse_extraction('[{"name": "Acme"}]')

        assert result.entities == []

    def test_an_entity_without_a_usable_name_is_dropped(self) -> None:
        raw = """
        {
          "entities": [
            {"type": "ORGANIZATION"},
            {"name": 42},
            {"name": "..."},
            {"name": "Acme"}
          ],
          "relations": []
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        # A name that normalizes to nothing would become an entity no query can
        # ever match.
        assert [entity.name for entity in result.entities] == ["acme"]

    def test_a_relation_missing_an_endpoint_is_dropped(self) -> None:
        raw = """
        {
          "entities": [],
          "relations": [
            {"source": "Acme", "predicate": "acquired"},
            {"source": 1, "target": "Globex", "predicate": "acquired"},
            {"source": "Acme", "target": "...", "predicate": "acquired"}
          ]
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        # A dangling edge has nothing to traverse to.
        assert result.relations == []
        assert result.entities == []

    def test_a_duplicate_keeps_the_first_description_and_type_when_it_adds_nothing(self) -> None:
        raw = """
        {
          "entities": [
            {"name": "Acme", "type": "ORGANIZATION", "description": "a long first description"},
            {"name": "acme", "type": "PRODUCT", "description": "short"}
          ],
          "relations": []
        }
        """
        result = EntityRelationExtractor.parse_extraction(raw)

        assert len(result.entities) == 1
        assert result.entities[0].description == "a long first description"
        # Only an unknown type is filled in; a second opinion does not overwrite
        # a type the model already committed to.
        assert result.entities[0].entity_type == "ORGANIZATION"


class TestExtractorConfiguration:
    def test_extraction_needs_a_provider(self) -> None:
        with pytest.raises(ValueError, match="model_provider_name"):
            EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting(model_provider_name=None))

    def test_extraction_needs_a_model(self) -> None:
        # Indexing would otherwise queue a batch of chunks and fail one LLM call
        # at a time.
        with pytest.raises(ValueError, match="model_name"):
            EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting(model_name=None))


class TestExtract:
    def test_blank_text_never_reaches_the_model(self, llm: Callable[..., _FakeModelManager]) -> None:
        manager = llm(_answer())

        result = EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract("   \n ")

        assert result.entities == []
        assert manager.instance.prompts == []

    def test_the_answer_is_parsed_into_a_subgraph(self, llm: Callable[..., _FakeModelManager]) -> None:
        llm(_answer('{"name": "Acme Corp", "type": "ORGANIZATION"}'))

        result = EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract("Acme Corp ships widgets.")

        assert [entity.name for entity in result.entities] == ["acme corp"]

    def test_the_extraction_model_is_resolved_for_this_tenant(self, llm: Callable[..., _FakeModelManager]) -> None:
        manager = llm(_answer())

        EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract("text")

        # A knowledge base extracts with its own workspace's credentials.
        assert manager.requests == [(TENANT_ID, "openai", ModelType.LLM, "gpt-4o-mini")]
        assert manager.instance.stream_flags == [False]

    def test_the_default_prompt_carries_the_configured_types_and_budget(
        self, llm: Callable[..., _FakeModelManager]
    ) -> None:
        manager = llm(_answer())
        setting = _setting(entity_types=["PERSON", "PRODUCT"], max_entities_per_chunk=3)

        EntityRelationExtractor(tenant_id=TENANT_ID, setting=setting).extract("Jane ships widgets.")

        prompt = manager.instance.prompts[0]
        assert "PERSON, PRODUCT" in prompt
        assert "at most 3 entities" in prompt
        assert "Jane ships widgets." in prompt

    def test_an_empty_type_list_still_gives_the_model_something_to_pick(
        self, llm: Callable[..., _FakeModelManager]
    ) -> None:
        manager = llm(_answer())

        EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting(entity_types=[])).extract("text")

        assert "CONCEPT" in manager.instance.prompts[0]

    def test_a_custom_prompt_is_never_silently_rewritten(self, llm: Callable[..., _FakeModelManager]) -> None:
        manager = llm(_answer())
        setting = _setting(extract_prompt="Only extract medications. Answer in JSON.", entity_types=["PERSON"])

        EntityRelationExtractor(tenant_id=TENANT_ID, setting=setting).extract("Take 5mg daily.")

        # The operator's template is responsible for its own formatting; only
        # the chunk is appended.
        prompt = manager.instance.prompts[0]
        assert prompt == "Only extract medications. Answer in JSON.\n\nTEXT:\nTake 5mg daily."

    def test_a_streamed_answer_is_rejected(self, llm: Callable[..., _FakeModelManager]) -> None:
        llm(lambda _prompt: iter(["chunked"]))

        with pytest.raises(ValueError, match="LLMResult"):
            EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract("text")


class TestExtractDocuments:
    def test_chunks_without_provenance_are_skipped(self, llm: Callable[..., _FakeModelManager]) -> None:
        manager = llm(_answer('{"name": "Acme"}'))
        documents = [
            _document("no chunk id", doc_id=None),
            _document("no document id", document_id=None),
            _document("citable", doc_id="node-1", document_id="doc-1"),
        ]

        results = EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_documents(documents)

        # A fact that cannot be cited back to a chunk is not worth an LLM call.
        assert len(manager.instance.prompts) == 1
        assert [chunk.index_node_id for chunk in results] == ["node-1"]

    def test_a_batch_with_nothing_citable_costs_nothing(self, llm: Callable[..., _FakeModelManager]) -> None:
        manager = llm(_answer('{"name": "Acme"}'))

        results = EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_documents(
            [_document("orphan", doc_id=None)]
        )

        assert results == []
        assert manager.instance.prompts == []

    def test_each_chunk_keeps_its_own_provenance(self, llm: Callable[..., _FakeModelManager]) -> None:
        llm(lambda prompt: _answer(f'{{"name": "{"Acme" if "first" in prompt else "Globex"}"}}'))
        documents = [
            _document("the first chunk", doc_id="node-1", document_id="doc-1"),
            _document("the second chunk", doc_id="node-2", document_id="doc-2"),
        ]

        results = EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_documents(documents)

        by_node = {chunk.index_node_id: chunk for chunk in results}
        assert set(by_node) == {"node-1", "node-2"}
        assert by_node["node-1"].document_id == "doc-1"
        assert [entity.name for entity in by_node["node-1"].extraction.entities] == ["acme"]
        assert by_node["node-2"].document_id == "doc-2"

    def test_chunks_the_model_found_nothing_in_are_dropped(self, llm: Callable[..., _FakeModelManager]) -> None:
        llm(_answer())

        results = EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_documents(
            [_document("boilerplate")]
        )

        # An empty subgraph would still cost a row per chunk to store.
        assert results == []

    def test_a_failing_chunk_does_not_abort_the_batch(self, llm: Callable[..., _FakeModelManager]) -> None:
        def _respond(prompt: str) -> object:
            if "poison" in prompt:
                return RuntimeError("the provider rate-limited us")
            return _answer('{"name": "Acme"}')

        llm(_respond)
        documents = [
            _document("poison chunk", doc_id="node-1", document_id="doc-1"),
            _document("healthy chunk", doc_id="node-2", document_id="doc-2"),
        ]

        results = EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_documents(documents)

        # The failed chunk is still searchable through the vector index; the
        # graph is an enhancement layer over it, not a gate on indexing.
        assert [chunk.index_node_id for chunk in results] == ["node-2"]

    def test_extraction_survives_a_missing_application_context(
        self, llm: Callable[..., _FakeModelManager], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        llm(_answer('{"name": "Acme"}'))

        class _NoAppContext:
            def _get_current_object(self) -> object:
                raise RuntimeError("Working outside of application context.")

        monkeypatch.setattr(entity_extractor_module, "current_app", _NoAppContext())

        results: list[ChunkGraph] = EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_documents(
            [_document("Acme ships widgets.")]
        )

        assert [chunk.index_node_id for chunk in results] == ["node-1"]


class TestExtractQueryEntities:
    def test_a_blank_query_never_reaches_the_model(self, llm: Callable[..., _FakeModelManager]) -> None:
        manager = llm('{"entities": ["acme"]}')

        assert EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_query_entities("  ") == []
        assert manager.instance.prompts == []

    def test_mentions_are_normalized_and_deduplicated(self, llm: Callable[..., _FakeModelManager]) -> None:
        manager = llm('{"entities": ["Acme Corp.", "  acme   corp ", "Globex"]}')

        mentions = EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_query_entities(
            "Who runs Acme Corp?"
        )

        # Entity names are stored normalized, so the probe has to be too.
        assert mentions == ["acme corp", "globex"]
        assert "Who runs Acme Corp?" in manager.instance.prompts[0]

    def test_a_failing_model_leaves_retrieval_to_its_lexical_seeds(self, llm: Callable[..., _FakeModelManager]) -> None:
        llm(RuntimeError("the provider is down"))

        # This is a fallback for queries that matched nothing lexically; an
        # exception here would fail a query that was already going to be empty.
        assert EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_query_entities("q") == []

    @pytest.mark.parametrize(
        "answer",
        [
            '"just a sentence"',
            '{"entities": "acme"}',
            "{}",
        ],
    )
    def test_an_answer_without_a_list_of_entities_yields_no_mentions(
        self, llm: Callable[..., _FakeModelManager], answer: str
    ) -> None:
        llm(answer)

        assert EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_query_entities("q") == []

    def test_non_string_and_empty_mentions_are_ignored(self, llm: Callable[..., _FakeModelManager]) -> None:
        llm('{"entities": ["Acme", 42, null, "..."]}')

        mentions = EntityRelationExtractor(tenant_id=TENANT_ID, setting=_setting()).extract_query_entities("q")

        assert mentions == ["acme"]


class TestExtractionBudget:
    def test_the_budget_is_shared_by_every_indexing_task_in_the_process(
        self, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
    ) -> None:
        monkeypatch.setattr(entity_extractor_module, "_extraction_slots", None)
        config_overrides(KNOWLEDGE_GRAPH_EXTRACTION_WORKERS=2)

        slots = entity_extractor_module._acquire_extraction_slot()

        # Per-call thread pools alone would multiply the real concurrency -- and
        # the LLM bill -- by however many celery tasks a worker is running.
        assert entity_extractor_module._acquire_extraction_slot() is slots
        assert slots.acquire(blocking=False)
        assert slots.acquire(blocking=False)
        assert not slots.acquire(blocking=False)
        slots.release()
        slots.release()

    def test_a_budget_created_while_we_waited_for_the_lock_is_reused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(entity_extractor_module, "_extraction_slots", None)
        existing = threading.BoundedSemaphore(1)

        @contextmanager
        def _lock_won_by_another_thread() -> Generator[None, None, None]:
            # The task ahead of us already published the budget; a second one
            # here would double the process's concurrency.
            entity_extractor_module._extraction_slots = existing
            yield

        monkeypatch.setattr(entity_extractor_module, "_slots_lock", _lock_won_by_another_thread())

        assert entity_extractor_module._acquire_extraction_slot() is existing
