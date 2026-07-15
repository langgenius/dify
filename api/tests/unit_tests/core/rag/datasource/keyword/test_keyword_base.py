from types import SimpleNamespace
from typing import override
from unittest.mock import MagicMock

import pytest

from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.models.document import Document


class _KeywordThatRaises(BaseKeyword):
    @override
    def create(self, texts: list[Document], session, **kwargs):
        return super().create(texts, session, **kwargs)

    @override
    def add_texts(self, texts: list[Document], session, **kwargs):
        return super().add_texts(texts, session, **kwargs)

    @override
    def text_exists(self, id: str, *, session) -> bool:
        return super().text_exists(id, session=session)

    @override
    def delete_by_ids(self, ids: list[str], session, **kwargs):
        return super().delete_by_ids(ids, session, **kwargs)

    @override
    def delete(self, *, session):
        return super().delete(session=session)

    @override
    def search(self, query: str, *, session, **kwargs):
        return super().search(query, session=session, **kwargs)


class _KeywordForHelpers(BaseKeyword):
    def __init__(self, dataset, existing_ids: set[str] | None = None):
        super().__init__(dataset)
        self._existing_ids = existing_ids or set()

    @override
    def create(self, texts: list[Document], session, **kwargs):
        return self

    @override
    def add_texts(self, texts: list[Document], session, **kwargs):
        return None

    @override
    def text_exists(self, id: str, *, session) -> bool:
        return id in self._existing_ids

    @override
    def delete_by_ids(self, ids: list[str], session, **kwargs):
        return None

    @override
    def delete(self, *, session):
        return None

    @override
    def search(self, query: str, *, session, **kwargs):
        return []


def test_abstract_methods_raise_not_implemented():
    keyword = _KeywordThatRaises(SimpleNamespace(id="dataset-1"))
    session = MagicMock()

    with pytest.raises(NotImplementedError):
        keyword.create([], session)

    with pytest.raises(NotImplementedError):
        keyword.add_texts([], session)

    with pytest.raises(NotImplementedError):
        keyword.text_exists("doc-1", session=session)

    with pytest.raises(NotImplementedError):
        keyword.delete_by_ids(["doc-1"], session)

    with pytest.raises(NotImplementedError):
        keyword.delete(session=session)

    with pytest.raises(NotImplementedError):
        keyword.search("query", session=session)


def test_filter_duplicate_texts_removes_existing_doc_ids():
    keyword = _KeywordForHelpers(SimpleNamespace(id="dataset-1"), existing_ids={"duplicate"})
    texts = [
        Document(page_content="keep", metadata={"doc_id": "keep"}),
        Document(page_content="duplicate", metadata={"doc_id": "duplicate"}),
        SimpleNamespace(page_content="without-metadata", metadata=None),
    ]

    filtered = keyword._filter_duplicate_texts(texts, session=MagicMock())

    assert [text.metadata["doc_id"] for text in filtered if text.metadata] == ["keep"]
    assert any(text.metadata is None for text in filtered)


def test_get_uuids_returns_only_docs_with_metadata():
    keyword = _KeywordForHelpers(SimpleNamespace(id="dataset-1"))
    texts = [
        Document(page_content="doc-1", metadata={"doc_id": "doc-1"}),
        Document(page_content="doc-2", metadata={"doc_id": "doc-2"}),
        SimpleNamespace(page_content="doc-3", metadata=None),
    ]

    assert keyword._get_uuids(texts) == ["doc-1", "doc-2"]
