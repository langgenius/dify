from types import SimpleNamespace

import pytest

from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.models.document import Document


class _KeywordThatRaises(BaseKeyword):
    def create(self, texts: list[Document], **kwargs):
        return super().create(texts, **kwargs)

    def add_texts(self, texts: list[Document], **kwargs):
        return super().add_texts(texts, **kwargs)

    def text_exists(self, id: str) -> bool:
        return super().text_exists(id)

    def delete_by_ids(self, ids: list[str]):
        return super().delete_by_ids(ids)

    def delete(self):
        return super().delete()

    def search(self, query: str, **kwargs):
        return super().search(query, **kwargs)


class _KeywordForHelpers(BaseKeyword):
    def __init__(self, dataset, existing_ids: set[str] | None = None):
        super().__init__(dataset)
        self._existing_ids = existing_ids or set()

    def create(self, texts: list[Document], **kwargs):
        return self

    def add_texts(self, texts: list[Document], **kwargs):
        return None

    def text_exists(self, id: str) -> bool:
        return id in self._existing_ids

    def delete_by_ids(self, ids: list[str]):
        return None

    def delete(self):
        return None

    def search(self, query: str, **kwargs):
        return []


def test_abstract_methods_raise_not_implemented():
    keyword = _KeywordThatRaises(SimpleNamespace(id="dataset-1"))

    with pytest.raises(NotImplementedError):
        keyword.create([])

    with pytest.raises(NotImplementedError):
        keyword.add_texts([])

    with pytest.raises(NotImplementedError):
        keyword.text_exists("doc-1")

    with pytest.raises(NotImplementedError):
        keyword.delete_by_ids(["doc-1"])

    with pytest.raises(NotImplementedError):
        keyword.delete()

    with pytest.raises(NotImplementedError):
        keyword.search("query")


def test_filter_duplicate_texts_removes_existing_doc_ids():
    keyword = _KeywordForHelpers(SimpleNamespace(id="dataset-1"), existing_ids={"duplicate"})
    texts = [
        Document(page_content="keep", metadata={"doc_id": "keep"}),
        Document(page_content="duplicate", metadata={"doc_id": "duplicate"}),
        SimpleNamespace(page_content="without-metadata", metadata=None),
    ]

    filtered = keyword._filter_duplicate_texts(texts)

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
