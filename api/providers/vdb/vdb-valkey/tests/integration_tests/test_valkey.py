"""Integration tests for the Valkey vector store backend.

Requires a running Valkey instance with the valkey-search module loaded
on localhost:6379 (standard port). Start one with:

    docker run -d --name valkey-search -p 6379:6379 valkey/valkey-bundle:9.1.0-rc1

(Requires valkey-search module >= 1.2.0, included in valkey-bundle 9.1.0-rc1+.)
"""

from __future__ import annotations

import os
import uuid

import pytest
from dify_vdb_valkey.valkey_vector import ValkeyVector, ValkeyVectorConfig, VectorType

from core.rag.models.document import Document

EMBEDDING_DIM = 128


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _cfg() -> ValkeyVectorConfig:
    return ValkeyVectorConfig(
        host=os.environ.get("VALKEY_HOST", "localhost"),
        port=int(os.environ.get("VALKEY_PORT", "6379")),
        password=os.environ.get("VALKEY_PASSWORD", ""),
        db=int(os.environ.get("VALKEY_DB", "0")),
        use_ssl=False,
    )


def _embedding(seed: float = 1.001) -> list[float]:
    """Deterministic 128-d embedding. Avoids zero vectors by adding 1 to the index."""
    return [seed * (i + 1) for i in range(EMBEDDING_DIM)]


def _doc(doc_id: str, content: str, dataset_id: str) -> Document:
    return Document(
        page_content=content,
        metadata={
            "doc_id": doc_id,
            "doc_hash": doc_id,
            "document_id": doc_id,
            "dataset_id": dataset_id,
        },
    )


@pytest.fixture
def vv(setup_mock_redis):
    """Yield a fresh ValkeyVector with a unique collection, clean up after."""
    group_id = str(uuid.uuid4())
    collection = f"test_{uuid.uuid4().hex[:12]}"
    v = ValkeyVector(collection_name=collection, group_id=group_id, config=_cfg())
    yield v
    # Teardown: delete all docs and drop the index
    try:
        v.delete()
    except Exception:  # noqa: S110
        pass
    try:
        from glide.async_commands.server_modules import ft

        v._run(ft.dropindex(v._client, v._index_name()))
    except Exception:  # noqa: S110
        pass


# ---------------------------------------------------------------------------
# get_type / to_index_struct
# ---------------------------------------------------------------------------


class TestBasicProperties:
    def test_get_type(self, vv: ValkeyVector):
        assert vv.get_type() == VectorType.VALKEY

    def test_to_index_struct(self, vv: ValkeyVector):
        s = vv.to_index_struct()
        assert s["type"] == VectorType.VALKEY
        assert s["vector_store"]["class_prefix"] == vv.collection_name


# ---------------------------------------------------------------------------
# create
# ---------------------------------------------------------------------------


class TestCreate:
    def test_create_inserts_documents(self, vv: ValkeyVector):
        doc_id = str(uuid.uuid4())
        docs = [_doc(doc_id, "hello world", vv._group_id)]
        vv.create(docs, [_embedding()])

        assert vv.text_exists(doc_id)

    def test_create_with_empty_list_is_noop(self, vv: ValkeyVector):
        """create([]) must not create an index or raise."""
        vv.create([], [])
        assert not vv._index_exists()

    def test_create_is_idempotent(self, vv: ValkeyVector):
        """Calling create twice must not fail (index already exists)."""
        doc1 = _doc(str(uuid.uuid4()), "first", vv._group_id)
        doc2 = _doc(str(uuid.uuid4()), "second", vv._group_id)
        vv.create([doc1], [_embedding(1.0)])
        vv.create([doc2], [_embedding(2.0)])

        assert vv.text_exists(doc1.metadata["doc_id"])
        assert vv.text_exists(doc2.metadata["doc_id"])


# ---------------------------------------------------------------------------
# add_texts
# ---------------------------------------------------------------------------


class TestAddTexts:
    def test_returns_doc_ids(self, vv: ValkeyVector):
        d1, d2 = str(uuid.uuid4()), str(uuid.uuid4())
        docs = [_doc(d1, "a", vv._group_id), _doc(d2, "b", vv._group_id)]
        vv.create([docs[0]], [_embedding()])  # ensure index exists
        ids = vv.add_texts(docs, [_embedding(), _embedding(2.0)])
        assert ids == [d1, d2]

    def test_batch_add_100_documents(self, vv: ValkeyVector):
        """Verify bulk insert works."""
        doc_ids = [str(uuid.uuid4()) for _ in range(100)]
        docs = [_doc(did, f"content-{i}", vv._group_id) for i, did in enumerate(doc_ids)]
        vv.create([docs[0]], [_embedding()])
        vv.add_texts(docs, [_embedding(float(i)) for i in range(100)])
        # Spot-check a few
        assert vv.text_exists(doc_ids[0])
        assert vv.text_exists(doc_ids[50])
        assert vv.text_exists(doc_ids[99])


# ---------------------------------------------------------------------------
# text_exists
# ---------------------------------------------------------------------------


class TestTextExists:
    def test_exists_true(self, vv: ValkeyVector):
        doc_id = str(uuid.uuid4())
        vv.create([_doc(doc_id, "exists", vv._group_id)], [_embedding()])
        assert vv.text_exists(doc_id) is True

    def test_exists_false_for_missing(self, vv: ValkeyVector):
        assert vv.text_exists("nonexistent-id") is False


# ---------------------------------------------------------------------------
# delete_by_ids
# ---------------------------------------------------------------------------


class TestDeleteByIds:
    def test_deletes_specific_documents(self, vv: ValkeyVector):
        d1, d2 = str(uuid.uuid4()), str(uuid.uuid4())
        vv.create(
            [_doc(d1, "keep", vv._group_id), _doc(d2, "remove", vv._group_id)],
            [_embedding(), _embedding(2.0)],
        )
        vv.delete_by_ids([d2])
        assert vv.text_exists(d1) is True
        assert vv.text_exists(d2) is False

    def test_delete_nonexistent_id_is_noop(self, vv: ValkeyVector):
        """Deleting an ID that doesn't exist must not raise."""
        vv.delete_by_ids(["does-not-exist"])

    def test_delete_empty_list_is_noop(self, vv: ValkeyVector):
        vv.delete_by_ids([])


# ---------------------------------------------------------------------------
# delete_by_metadata_field
# ---------------------------------------------------------------------------


class TestDeleteByMetadataField:
    def test_delete_by_document_id(self, vv: ValkeyVector):
        d1, d2 = str(uuid.uuid4()), str(uuid.uuid4())
        vv.create(
            [_doc(d1, "doc one", vv._group_id), _doc(d2, "doc two", vv._group_id)],
            [_embedding(), _embedding(2.0)],
        )
        vv.delete_by_metadata_field("document_id", d1)
        assert vv.text_exists(d1) is False
        assert vv.text_exists(d2) is True

    def test_delete_by_doc_id(self, vv: ValkeyVector):
        d1 = str(uuid.uuid4())
        vv.create([_doc(d1, "target", vv._group_id)], [_embedding()])
        vv.delete_by_metadata_field("doc_id", d1)
        assert vv.text_exists(d1) is False


# ---------------------------------------------------------------------------
# delete (group-level)
# ---------------------------------------------------------------------------


class TestDelete:
    def test_deletes_all_group_documents(self, vv: ValkeyVector):
        ids = [str(uuid.uuid4()) for _ in range(5)]
        docs = [_doc(did, f"text-{i}", vv._group_id) for i, did in enumerate(ids)]
        vv.create(docs, [_embedding(float(i)) for i in range(5)])
        for did in ids:
            assert vv.text_exists(did)

        vv.delete()
        for did in ids:
            assert vv.text_exists(did) is False

    def test_delete_does_not_affect_other_groups(self, vv: ValkeyVector):
        """Documents from a different group_id must survive."""
        other_group = str(uuid.uuid4())
        d_own = str(uuid.uuid4())
        d_other = str(uuid.uuid4())

        # Insert doc for vv's group
        vv.create([_doc(d_own, "own group", vv._group_id)], [_embedding()])

        # Insert doc for a different group into the same collection
        other_doc = Document(
            page_content="other group",
            metadata={"doc_id": d_other, "doc_hash": d_other, "document_id": d_other, "dataset_id": other_group},
        )
        field_pairs = [
            "vector",
            _embedding(3.0),
            "page_content",
            "other group",
            "metadata",
            '{"doc_id":"' + d_other + '"}',
            "group_id",
            other_group,
            "doc_id",
            d_other,
            "document_id",
            d_other,
        ]
        import struct

        vec_bytes = struct.pack(f"<{EMBEDDING_DIM}f", *_embedding(3.0))
        field_pairs[1] = vec_bytes
        vv._run(vv._client.custom_command(["HSET", f"{vv._prefix}{d_other}", *field_pairs]))

        vv.delete()  # only deletes vv._group_id

        assert vv.text_exists(d_own) is False
        assert vv.text_exists(d_other) is True  # other group survives


# ---------------------------------------------------------------------------
# search_by_vector
# ---------------------------------------------------------------------------


class TestSearchByVector:
    def test_returns_matching_document(self, vv: ValkeyVector):
        doc_id = str(uuid.uuid4())
        emb = _embedding()
        vv.create([_doc(doc_id, "vector search target", vv._group_id)], [emb])

        hits = vv.search_by_vector(emb, top_k=1)
        assert len(hits) == 1
        assert hits[0].metadata["doc_id"] == doc_id
        assert "score" in hits[0].metadata

    def test_respects_top_k(self, vv: ValkeyVector):
        ids = [str(uuid.uuid4()) for _ in range(5)]
        docs = [_doc(did, f"doc-{i}", vv._group_id) for i, did in enumerate(ids)]
        vv.create(docs, [_embedding(float(i + 1)) for i in range(5)])

        hits = vv.search_by_vector(_embedding(1.0), top_k=2)
        assert len(hits) <= 2

    def test_score_threshold_filters_low_similarity(self, vv: ValkeyVector):
        doc_id = str(uuid.uuid4())
        vv.create([_doc(doc_id, "threshold test", vv._group_id)], [_embedding()])

        # Threshold of 1.0 means only exact match (distance=0) passes
        hits = vv.search_by_vector(_embedding(), score_threshold=1.0, top_k=4)
        # The same vector should have distance ~0, score ~1.0
        assert len(hits) >= 1

    def test_score_threshold_excludes_all(self, vv: ValkeyVector):
        doc_id = str(uuid.uuid4())
        # Create a vector pointing in a very different direction
        opposite = [(-1.0) ** i * (i + 1) for i in range(EMBEDDING_DIM)]
        vv.create([_doc(doc_id, "far away", vv._group_id)], [opposite])

        # Query with a uniform-direction vector; high threshold should exclude
        query = [float(i) for i in range(EMBEDDING_DIM)]
        hits = vv.search_by_vector(query, score_threshold=0.99, top_k=4)
        assert len(hits) == 0

    def test_empty_collection_returns_empty(self, vv: ValkeyVector):
        """Searching before any documents are inserted."""
        # Create index with a dummy doc then delete it
        doc_id = str(uuid.uuid4())
        vv.create([_doc(doc_id, "temp", vv._group_id)], [_embedding()])
        vv.delete_by_ids([doc_id])

        hits = vv.search_by_vector(_embedding(), top_k=4)
        assert len(hits) == 0

    def test_results_contain_page_content_and_metadata(self, vv: ValkeyVector):
        doc_id = str(uuid.uuid4())
        vv.create([_doc(doc_id, "content check", vv._group_id)], [_embedding()])

        hits = vv.search_by_vector(_embedding(), top_k=1)
        assert hits[0].page_content == "content check"
        assert hits[0].metadata["doc_id"] == doc_id
        assert isinstance(hits[0].metadata["score"], float)

    def test_results_sorted_by_score_descending(self, vv: ValkeyVector):
        """Closer vectors should rank higher."""
        d_close = str(uuid.uuid4())
        d_far = str(uuid.uuid4())
        query = _embedding(1.0)
        vv.create(
            [_doc(d_close, "close", vv._group_id), _doc(d_far, "far", vv._group_id)],
            [_embedding(1.0), _embedding(50.0)],
        )

        hits = vv.search_by_vector(query, top_k=2)
        assert len(hits) == 2
        assert hits[0].metadata["score"] >= hits[1].metadata["score"]


# ---------------------------------------------------------------------------
# search_by_full_text
# ---------------------------------------------------------------------------


class TestSearchByFullText:
    def test_single_keyword_match(self, vv: ValkeyVector):
        doc_id = str(uuid.uuid4())
        vv.create([_doc(doc_id, "the quick brown fox", vv._group_id)], [_embedding()])

        hits = vv.search_by_full_text("fox", top_k=10)
        assert len(hits) >= 1
        assert any(h.metadata["doc_id"] == doc_id for h in hits)

    def test_no_match_returns_empty(self, vv: ValkeyVector):
        doc_id = str(uuid.uuid4())
        vv.create([_doc(doc_id, "hello world", vv._group_id)], [_embedding()])

        hits = vv.search_by_full_text("zzzznonexistent", top_k=10)
        assert len(hits) == 0

    def test_empty_query_returns_empty(self, vv: ValkeyVector):
        assert vv.search_by_full_text("", top_k=10) == []
        assert vv.search_by_full_text("   ", top_k=10) == []

    def test_multi_keyword_or_logic(self, vv: ValkeyVector):
        """Multi-word query should match documents containing ANY keyword."""
        d_apple = str(uuid.uuid4())
        d_banana = str(uuid.uuid4())
        d_both = str(uuid.uuid4())

        vv.create(
            [
                _doc(d_apple, "apple pie recipe", vv._group_id),
                _doc(d_banana, "banana smoothie recipe", vv._group_id),
                _doc(d_both, "apple banana fruit salad", vv._group_id),
            ],
            [_embedding(1.0), _embedding(2.0), _embedding(3.0)],
        )

        hits = vv.search_by_full_text("apple banana", top_k=10)
        found_ids = {h.metadata["doc_id"] for h in hits}
        assert d_apple in found_ids
        assert d_banana in found_ids
        assert d_both in found_ids

    def test_deduplication(self, vv: ValkeyVector):
        """A document matching multiple keywords must appear only once."""
        doc_id = str(uuid.uuid4())
        vv.create([_doc(doc_id, "apple banana cherry", vv._group_id)], [_embedding()])

        hits = vv.search_by_full_text("apple banana", top_k=10)
        doc_ids = [h.metadata["doc_id"] for h in hits]
        assert doc_ids.count(doc_id) == 1

    def test_respects_top_k(self, vv: ValkeyVector):
        ids = [str(uuid.uuid4()) for _ in range(5)]
        docs = [_doc(did, f"common keyword text-{i}", vv._group_id) for i, did in enumerate(ids)]
        vv.create(docs, [_embedding(float(i)) for i in range(5)])

        hits = vv.search_by_full_text("common", top_k=2)
        assert len(hits) <= 2

    def test_metadata_preserved(self, vv: ValkeyVector):
        doc_id = str(uuid.uuid4())
        vv.create([_doc(doc_id, "metadata preservation test", vv._group_id)], [_embedding()])

        hits = vv.search_by_full_text("preservation", top_k=1)
        assert len(hits) == 1
        assert hits[0].metadata["doc_id"] == doc_id
        assert hits[0].page_content == "metadata preservation test"


# ---------------------------------------------------------------------------
# get_ids_by_metadata_field (not implemented — should raise)
# ---------------------------------------------------------------------------


class TestGetIdsByMetadataField:
    def test_raises_not_implemented(self, vv: ValkeyVector):
        with pytest.raises(NotImplementedError):
            vv.get_ids_by_metadata_field("key", "value")
