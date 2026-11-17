"""Retrieval methods for built-in vector backends and backends that declare their own."""

from collections.abc import Iterable
from unittest.mock import MagicMock

import pytest

from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from services.knowledge.datasets.retrieval import retrieval_methods

SEMANTIC = ["semantic_search"]
ALL = ["semantic_search", "full_text_search", "hybrid_search"]


def _declaring(declared: Iterable[str] | None) -> MagicMock:
    return MagicMock(return_value=declared)


@pytest.mark.parametrize("vector_type", list(VectorType))
def test_builtin_backends_never_consult_declarations(vector_type: VectorType) -> None:
    lookup = MagicMock(side_effect=AssertionError("built-in backends must not be looked up"))

    for is_mock in (False, True):
        for tidb_fulltext in (False, True):
            result = retrieval_methods(
                vector_type.value, is_mock=is_mock, tidb_fulltext=tidb_fulltext, declared_methods=lookup
            )
            assert result["retrieval_method"] in (SEMANTIC, ALL)
    lookup.assert_not_called()


def test_builtin_special_cases_are_unchanged() -> None:
    lookup = _declaring(SEMANTIC)

    assert retrieval_methods("milvus", declared_methods=lookup)["retrieval_method"] == ALL
    assert retrieval_methods("milvus", is_mock=True, declared_methods=lookup)["retrieval_method"] == SEMANTIC
    assert retrieval_methods("tidb_vector", tidb_fulltext=True, declared_methods=lookup)["retrieval_method"] == ALL
    assert (
        retrieval_methods("tidb_vector", tidb_fulltext=False, declared_methods=lookup)["retrieval_method"] == SEMANTIC
    )
    lookup.assert_not_called()


def test_unknown_backend_without_lookup_is_unsupported() -> None:
    with pytest.raises(ValueError, match="Unsupported vector db type acme\\."):
        retrieval_methods("acme")


def test_backend_without_declaration_is_unsupported() -> None:
    lookup = _declaring(None)

    with pytest.raises(ValueError, match="Unsupported vector db type acme\\."):
        retrieval_methods("acme", declared_methods=lookup)
    lookup.assert_called_once_with("acme")


@pytest.mark.parametrize(
    ("declared", "expected"),
    [
        (["semantic_search"], SEMANTIC),
        (["full_text_search"], ["full_text_search"]),
        (["semantic_search", "full_text_search"], ["semantic_search", "full_text_search"]),
        (["hybrid_search", "full_text_search", "semantic_search"], ALL),
        ((RetrievalMethod.SEMANTIC_SEARCH, RetrievalMethod.SEMANTIC_SEARCH), SEMANTIC),
        ([RetrievalMethod.HYBRID_SEARCH, RetrievalMethod.SEMANTIC_SEARCH, RetrievalMethod.FULL_TEXT_SEARCH], ALL),
    ],
)
def test_declared_methods_are_returned_in_canonical_order(declared: Iterable[str], expected: list[str]) -> None:
    assert retrieval_methods("acme", declared_methods=_declaring(declared)) == {"retrieval_method": expected}


def test_explicit_empty_declaration_is_rejected() -> None:
    with pytest.raises(ValueError, match="'acme' declares no retrieval methods"):
        retrieval_methods("acme", declared_methods=_declaring([]))


@pytest.mark.parametrize("declared", [["keyword_search"], ["semantic_search", "keyword_search"], ["bm25"]])
def test_methods_outside_the_vector_path_are_rejected(declared: list[str]) -> None:
    with pytest.raises(ValueError, match="'acme' declares unsupported retrieval methods"):
        retrieval_methods("acme", declared_methods=_declaring(declared))


@pytest.mark.parametrize("declared", [["hybrid_search"], ["hybrid_search", "semantic_search"]])
def test_hybrid_requires_semantic_and_full_text(declared: list[str]) -> None:
    with pytest.raises(ValueError, match="hybrid search, which also needs semantic and full-text search"):
        retrieval_methods("acme", declared_methods=_declaring(declared))


def test_string_declaration_is_rejected() -> None:
    with pytest.raises(ValueError, match="must declare a list"):
        retrieval_methods("acme", declared_methods=_declaring("semantic_search"))


def test_lookup_errors_are_not_reported_as_unsupported() -> None:
    lookup = MagicMock(side_effect=ModuleNotFoundError("No module named 'acme_sdk'"))

    with pytest.raises(ModuleNotFoundError, match="acme_sdk"):
        retrieval_methods("acme", declared_methods=lookup)
