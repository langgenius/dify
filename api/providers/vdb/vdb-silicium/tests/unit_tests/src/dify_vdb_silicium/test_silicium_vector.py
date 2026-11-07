# SPDX-License-Identifier: MIT
"""Zero-Mock unit test suite for the Dify Silicium VectorDB backend (`dify_vdb_silicium`)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Allow standalone execution via runpy.run_path as well as pytest inside api/providers/vdb/vdb-silicium
_THIS_DIR = Path(__file__).resolve().parent
_CANDIDATE_SRC = _THIS_DIR.parents[2] / "src"
if _CANDIDATE_SRC.is_dir() and str(_CANDIDATE_SRC) not in sys.path:
    sys.path.insert(0, str(_CANDIDATE_SRC))

try:
    from dify_vdb_silicium.silicium_vector import (
        _COLLECTION_ARENA,
        _MAX_ENTRIES_PER_TENANT,
        _MAX_TENANT_SCOPES,
        _MAX_VECTOR_DIM,
        Document,
        Embeddings,
        SiliciumConfig,
        SiliciumVector,
        SiliciumVectorFactory,
    )
except ImportError:
    import importlib.util

    _local_vec_path = _THIS_DIR / "dify_silicium_vector.py"
    _spec = importlib.util.spec_from_file_location("dify_vdb_silicium.silicium_vector", _local_vec_path)
    assert _spec is not None
    assert _spec.loader is not None
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules["dify_vdb_silicium.silicium_vector"] = _mod
    _spec.loader.exec_module(_mod)
    _COLLECTION_ARENA = _mod._COLLECTION_ARENA
    _MAX_ENTRIES_PER_TENANT = _mod._MAX_ENTRIES_PER_TENANT
    _MAX_TENANT_SCOPES = _mod._MAX_TENANT_SCOPES
    _MAX_VECTOR_DIM = _mod._MAX_VECTOR_DIM
    Document = _mod.Document
    Embeddings = _mod.Embeddings
    SiliciumConfig = _mod.SiliciumConfig
    SiliciumVector = _mod.SiliciumVector
    SiliciumVectorFactory = _mod.SiliciumVectorFactory


class _RealDatasetStub:
    """Concrete zero-mock dataset stub exposing `id`, `index_struct`, and `index_struct_dict`."""

    def __init__(self, dataset_id: str, index_struct: str | None = None) -> None:
        """Initialize dataset stub with `dataset_id` and optional serialized `index_struct`."""
        self.id: str = dataset_id
        self.index_struct: str | None = index_struct

    @property
    def index_struct_dict(self) -> dict[str, object] | None:
        """Parse and return `index_struct` as a dictionary when present."""
        if not self.index_struct:
            return None
        loaded = json.loads(self.index_struct)
        return loaded if isinstance(loaded, dict) else None


class _RealEmbeddingsStub(Embeddings):
    """Concrete zero-mock embeddings implementation for factory initialization tests."""

    def embed_query(self, text: str) -> list[float]:
        """Return a deterministic 4D float vector for `text`."""
        return [float(len(text)), 1.0, 0.0, 0.0]


def test_silicium_config_validation_and_adversarial_bounds() -> None:
    """Verify valid `SiliciumConfig` normalization and adversarial boundary rejections (`ValueError`)."""
    cfg = SiliciumConfig(dimension=4, metric="COSINE", max_tenant_scopes=64, max_entries_per_tenant=128)
    assert cfg.dimension == 4
    assert cfg.metric == "cosine"
    assert cfg.max_tenant_scopes == 64
    assert cfg.max_entries_per_tenant == 128

    with pytest.raises(ValueError, match="dimension"):
        SiliciumConfig(dimension=0)

    with pytest.raises(ValueError, match="dimension"):
        SiliciumConfig(dimension=-16)

    with pytest.raises(ValueError, match="dimension"):
        SiliciumConfig(dimension=_MAX_VECTOR_DIM + 1)

    with pytest.raises(ValueError, match="metric"):
        SiliciumConfig(dimension=4, metric="hamming_invalid")

    with pytest.raises(ValueError, match="max_tenant_scopes"):
        SiliciumConfig(dimension=4, max_tenant_scopes=_MAX_TENANT_SCOPES + 1)

    with pytest.raises(ValueError, match="max_entries_per_tenant"):
        SiliciumConfig(dimension=4, max_entries_per_tenant=_MAX_ENTRIES_PER_TENANT + 1)


def test_silicium_vector_crud_and_three_metrics() -> None:
    """Verify CRUD lifecycle, `cosine`/`l2`/`ip` metrics, `score_threshold=0.0`, and `document_ids_filter`."""
    _COLLECTION_ARENA.clear()
    for metric in ("cosine", "l2", "ip"):
        vec_store = SiliciumVector(
            collection_name=f"col_{metric}",
            config=SiliciumConfig(dimension=4, metric=metric),
        )
        assert vec_store.get_type() == "silicium"
        assert vec_store.engine_backend in ("silicium_c_abi_simd", "python_portable_fallback")

        docs = [
            Document(page_content="alpha vector node", metadata={"doc_id": "d1", "document_id": "doc-A"}),
            Document(page_content="beta orthogonal node", metadata={"doc_id": "d2", "document_id": "doc-B"}),
        ]
        vec_store.create(docs, [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]])

        assert vec_store.text_exists("d1") is True
        assert vec_store.text_exists("d999") is False
        assert vec_store.get_ids_by_metadata_field("document_id", "doc-A") == ["d1"]

        # Explicit score_threshold=0.0 must be preserved (not coerced via truthiness)
        hits = vec_store.search_by_vector([1.0, 0.0, 0.0, 0.0], top_k=2, score_threshold=0.0)
        assert len(hits) == 2
        assert hits[0].page_content == "alpha vector node"
        assert "score" in hits[0].metadata

        # High threshold filters out orthogonal vector
        strict_hits = vec_store.search_by_vector([1.0, 0.0, 0.0, 0.0], top_k=2, score_threshold=0.95)
        assert len(strict_hits) == 1
        assert strict_hits[0].metadata["doc_id"] == "d1"

        # Filter by document_ids_filter
        filtered_hits = vec_store.search_by_vector(
            [1.0, 0.0, 0.0, 0.0],
            top_k=2,
            score_threshold=0.0,
            document_ids_filter=["doc-B"],
        )
        assert len(filtered_hits) == 1
        assert filtered_hits[0].metadata["doc_id"] == "d2"

        # Full-text BM25/TF search
        ft_hits = vec_store.search_by_full_text("alpha vector", top_k=2)
        assert len(ft_hits) == 1
        assert ft_hits[0].metadata["doc_id"] == "d1"

        vec_store.delete_by_metadata_field("document_id", "doc-B")
        assert vec_store.text_exists("d2") is False

        vec_store.delete_by_ids(["d1"])
        assert vec_store.text_exists("d1") is False

        vec_store.delete()


def test_read_only_operations_never_allocate_or_evict_buckets() -> None:
    """Verify read-only queries (`search_*`, `text_exists`, `delete_by_*`) never evict existing collections."""
    _COLLECTION_ARENA.clear()
    cfg = SiliciumConfig(dimension=4, metric="cosine", max_tenant_scopes=4, max_entries_per_tenant=4)

    for idx in range(4):
        store = SiliciumVector(collection_name=f"tenant_col_{idx}", config=cfg)
        store.add_texts(
            [Document(page_content=f"doc-{idx}", metadata={"doc_id": f"id-{idx}"})],
            [[1.0, 0.0, 0.0, 0.0]],
        )

    assert len(_COLLECTION_ARENA) == 4
    assert "tenant_col_0" in _COLLECTION_ARENA

    # Read-only operations on a non-existent collection must NOT allocate a bucket or evict tenant_col_0
    ghost = SiliciumVector(collection_name="ghost_readonly_col", config=cfg)
    assert ghost.text_exists("id-0") is False
    assert ghost.search_by_vector([1.0, 0.0, 0.0, 0.0], top_k=2) == []
    assert ghost.search_by_full_text("doc", top_k=2) == []
    ghost.delete_by_ids(["id-0"])
    ghost.delete_by_metadata_field("doc_id", "id-0")

    assert "ghost_readonly_col" not in _COLLECTION_ARENA
    assert "tenant_col_0" in _COLLECTION_ARENA

    # Writing to a 5th collection triggers FIFO eviction of tenant_col_0, and per-tenant entries cap at 4
    fifth = SiliciumVector(collection_name="tenant_col_4", config=cfg)
    for entry_idx in range(6):
        fifth.add_texts(
            [Document(page_content=f"item-{entry_idx}", metadata={"doc_id": f"e-{entry_idx}"})],
            [[1.0, 0.0, 0.0, 0.0]],
        )

    assert len(_COLLECTION_ARENA) == 4
    assert "tenant_col_0" not in _COLLECTION_ARENA
    assert fifth.text_exists("e-0") is False
    assert fifth.text_exists("e-5") is True


def test_iterable_embeddings_validation_and_ndjson_zero_copy_bridge() -> None:
    """Verify tuple/generator embedding coercion, empty/mismatch rejections, and 64B NDJSON ingestion."""
    _COLLECTION_ARENA.clear()
    store = SiliciumVector(collection_name="col_ndjson", config=SiliciumConfig(dimension=4))

    # Tuple embeddings work seamlessly
    uuids = store.add_texts(
        [Document(page_content="tuple test", metadata={"doc_id": "t-1"})],
        [(0.5, 0.5, 0.0, 0.0)],  # type: ignore[list-item]
    )
    assert uuids == ["t-1"]

    with pytest.raises(ValueError, match="must not be empty"):
        store.add_texts([Document(page_content="bad", metadata={"doc_id": "t-2"})], [[]])

    with pytest.raises(ValueError, match="must match documents count"):
        store.add_texts(
            [Document(page_content="bad", metadata={"doc_id": "t-3"})],
            [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]],
        )

    ndjson_lines = "\n".join(
        [
            json.dumps({"doc_id": "n-1", "text": "zero copy line one", "embedding": [1.0, 0.0, 0.0, 0.0]}),
            json.dumps({"doc_id": "n-2", "text": "zero copy line two", "embedding": [0.0, 1.0, 0.0, 0.0]}),
        ]
    )
    stats = store.ingest_ndjson_zero_copy(ndjson_lines)
    assert stats["status"] == "PASS"
    assert stats["rows_ingested"] == 2
    assert stats["arena_alignment_bytes"] == 64
    assert store.text_exists("n-1") is True
    assert store.text_exists("n-2") is True


def test_factory_init_vector_resolves_or_generates_collection() -> None:
    """Verify `SiliciumVectorFactory.init_vector` handles both existing and uninitialized `Dataset` objects."""
    factory = SiliciumVectorFactory()
    emb = _RealEmbeddingsStub()

    existing_ds = _RealDatasetStub(
        dataset_id="ds-existing",
        index_struct=json.dumps({"type": "silicium", "vector_store": {"class_prefix": "CUSTOM_PREFIX"}}),
    )
    v1 = factory.init_vector(existing_ds, attributes=[], embeddings=emb, session=None)  # type: ignore[arg-type]
    assert v1.collection_name == "custom_prefix"

    fresh_ds = _RealDatasetStub(dataset_id="ds-fresh")
    v2 = factory.init_vector(fresh_ds, attributes=[], embeddings=emb, session=None)  # type: ignore[arg-type]
    assert v2.collection_name.startswith("vector_index_")
    assert fresh_ds.index_struct is not None


if __name__ == "__main__":
    test_silicium_config_validation_and_adversarial_bounds()
    test_silicium_vector_crud_and_three_metrics()
    test_read_only_operations_never_allocate_or_evict_buckets()
    test_iterable_embeddings_validation_and_ndjson_zero_copy_bridge()
    test_factory_init_vector_resolves_or_generates_collection()
