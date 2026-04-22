"""Unit tests for the Valkey vector store backend.

Only pure functions are tested here — serialisation, parsing, escaping,
distance conversion, and config.  No mocks, no monkeypatching.
"""

from __future__ import annotations

import json
import struct

import pytest

# Pure helpers are importable without the glide C extension because they
# have no dependency on glide at module level.
from dify_vdb_valkey.valkey_vector import (
    ValkeyVectorConfig,
    _bytes_to_float_vector,
    _distance_to_similarity,
    _escape_tag,
    _escape_text,
    _float_vector_to_bytes,
    _parse_dict_keys,
    _parse_full_text_results,
    _parse_vector_search_results,
    _to_str,
)
from pydantic import ValidationError

# ===================================================================
# Float vector serialisation
# ===================================================================


class TestFloatVectorSerialization:
    def test_roundtrip_single(self):
        assert _bytes_to_float_vector(_float_vector_to_bytes([1.0])) == pytest.approx([1.0])

    def test_roundtrip_multiple(self):
        orig = [0.0, 1.5, -3.14, 100.0, 0.001]
        assert _bytes_to_float_vector(_float_vector_to_bytes(orig)) == pytest.approx(orig, rel=1e-5)

    def test_empty(self):
        assert _float_vector_to_bytes([]) == b""
        assert _bytes_to_float_vector(b"") == []

    def test_little_endian_float32(self):
        assert _float_vector_to_bytes([1.0]) == struct.pack("<f", 1.0)


# ===================================================================
# _to_str
# ===================================================================


class TestToStr:
    def test_bytes(self):
        assert _to_str(b"hello") == "hello"

    def test_str(self):
        assert _to_str("hello") == "hello"

    def test_none(self):
        assert _to_str(None) == ""

    def test_int(self):
        assert _to_str(42) == "42"

    def test_utf8(self):
        assert _to_str("café".encode()) == "café"


# ===================================================================
# Escaping
# ===================================================================


class TestEscapeTag:
    def test_plain(self):
        assert _escape_tag("simple") == "simple"

    def test_hyphens(self):
        assert _escape_tag("a-b-c") == r"a\-b\-c"

    def test_special(self):
        e = _escape_tag("a.b*c?")
        assert r"\." in e
        assert r"\*" in e
        assert r"\?" in e


class TestEscapeText:
    def test_plain(self):
        assert _escape_text("hello") == "hello"

    def test_at(self):
        assert _escape_text("@x") == r"\@x"

    def test_parens(self):
        assert _escape_text("(x)") == r"\(x\)"


# ===================================================================
# Distance → similarity conversion
# ===================================================================


class TestDistanceToSimilarity:
    def test_cosine_zero(self):
        assert _distance_to_similarity(0.0, "COSINE") == pytest.approx(1.0)

    def test_cosine_max(self):
        assert _distance_to_similarity(2.0, "COSINE") == pytest.approx(0.0)

    def test_cosine_mid(self):
        assert _distance_to_similarity(0.4, "COSINE") == pytest.approx(0.8)

    def test_l2_zero(self):
        assert _distance_to_similarity(0.0, "L2") == pytest.approx(1.0)

    def test_l2_positive(self):
        assert _distance_to_similarity(1.0, "L2") == pytest.approx(0.5)

    def test_ip(self):
        assert _distance_to_similarity(0.1, "IP") == pytest.approx(0.9)

    def test_case_insensitive(self):
        assert _distance_to_similarity(0.4, "cosine") == pytest.approx(0.8)

    def test_invalid_metric_raises(self):
        with pytest.raises(ValueError, match="Unsupported distance metric"):
            _distance_to_similarity(0.5, "HAMMING")


# ===================================================================
# Response parsers (glide dict format)
# ===================================================================


class TestParseDictKeys:
    def test_none_and_empty(self):
        assert _parse_dict_keys(None) == []
        assert _parse_dict_keys([]) == []

    def test_empty_dict(self):
        assert _parse_dict_keys([0, {}]) == []

    def test_keys(self):
        assert _parse_dict_keys([2, {b"k1": {}, b"k2": {}}]) == ["k1", "k2"]


class TestParseVectorSearchResults:
    def test_none_and_empty(self):
        assert _parse_vector_search_results(None, 0.0, "COSINE") == []
        assert _parse_vector_search_results([], 0.0, "COSINE") == []

    def test_single(self):
        meta = json.dumps({"doc_id": "d1"}).encode()
        r = [1, {b"k1": {b"__vector_score": b"0.2", b"page_content": b"hi", b"metadata": meta}}]
        docs = _parse_vector_search_results(r, 0.0, "COSINE")
        assert len(docs) == 1
        assert docs[0].page_content == "hi"
        # COSINE distance 0.2 → similarity = 1 - 0.2/2 = 0.9
        assert docs[0].metadata["score"] == pytest.approx(0.9)

    def test_threshold_filters(self):
        meta = json.dumps({"doc_id": "d1"}).encode()
        # COSINE distance 1.0 → similarity = 0.5
        r = [1, {b"k1": {b"__vector_score": b"1.0", b"page_content": b"t", b"metadata": meta}}]
        assert len(_parse_vector_search_results(r, 0.6, "COSINE")) == 0
        assert len(_parse_vector_search_results(r, 0.4, "COSINE")) == 1

    def test_sorted_descending(self):
        m1 = json.dumps({"doc_id": "d1"}).encode()
        m2 = json.dumps({"doc_id": "d2"}).encode()
        r = [
            2,
            {
                b"k1": {b"__vector_score": b"0.6", b"page_content": b"a", b"metadata": m1},
                b"k2": {b"__vector_score": b"0.2", b"page_content": b"b", b"metadata": m2},
            },
        ]
        docs = _parse_vector_search_results(r, 0.0, "COSINE")
        assert docs[0].metadata["doc_id"] == "d2"
        assert docs[1].metadata["doc_id"] == "d1"

    def test_non_dict_entries(self):
        assert _parse_vector_search_results([1, "bad"], 0.0, "COSINE") == []

    def test_missing_score_skipped(self):
        meta = json.dumps({"doc_id": "d1"}).encode()
        r = [1, {b"k1": {b"page_content": b"no score", b"metadata": meta}}]
        assert _parse_vector_search_results(r, 0.0, "COSINE") == []

    def test_l2_metric(self):
        meta = json.dumps({"doc_id": "d1"}).encode()
        r = [1, {b"k1": {b"__vector_score": b"1.0", b"page_content": b"t", b"metadata": meta}}]
        docs = _parse_vector_search_results(r, 0.0, "L2")
        assert docs[0].metadata["score"] == pytest.approx(0.5)


class TestParseFullTextResults:
    def test_none_and_empty(self):
        assert _parse_full_text_results(None) == []
        assert _parse_full_text_results([]) == []

    def test_single(self):
        meta = json.dumps({"doc_id": "d1"}).encode()
        r = [1, {b"doc:col:d1": {b"page_content": b"hi", b"metadata": meta}}]
        pairs = _parse_full_text_results(r)
        assert len(pairs) == 1
        assert pairs[0][0] == "doc:col:d1"
        assert pairs[0][1].metadata["doc_id"] == "d1"


# ===================================================================
# Config
# ===================================================================


class TestValkeyVectorConfig:
    def test_defaults(self):
        c = ValkeyVectorConfig()
        assert c.host == "localhost"
        assert c.port == 6379
        assert c.password == ""
        assert c.db == 0
        assert c.use_ssl is False
        assert c.distance_metric == "COSINE"

    def test_custom(self):
        c = ValkeyVectorConfig(
            host="h",
            port=6380,
            password="p",
            db=2,
            use_ssl=True,
            distance_metric="L2",
        )
        assert c.host == "h"
        assert c.port == 6380
        assert c.distance_metric == "L2"

    def test_invalid_distance_metric_rejected(self):
        with pytest.raises(ValidationError):
            ValkeyVectorConfig(distance_metric="HAMMING")  # type: ignore[arg-type]
