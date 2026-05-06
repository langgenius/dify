from types import SimpleNamespace

import pytest

from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.models.document import Document


class _DummyVector(BaseVector):
    def __init__(self, collection_name: str, existing_ids: set[str] | None = None):
        super().__init__(collection_name)
        self._existing_ids = existing_ids or set()

    def get_type(self) -> str:
        return "dummy"

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        return None

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        return None

    def text_exists(self, id: str) -> bool:
        return id in self._existing_ids

    def delete_by_ids(self, ids: list[str]):
        return None

    def delete_by_metadata_field(self, key: str, value: str):
        return None

    def search_by_vector(self, query_vector: list[float], **kwargs):
        return []

    def search_by_full_text(self, query: str, **kwargs):
        return []

    def delete(self):
        return None


@pytest.mark.parametrize(
    ("base_method", "args"),
    [
        (BaseVector.get_type, ()),
        (BaseVector.create, ([], [])),
        (BaseVector.add_texts, ([], [])),
        (BaseVector.text_exists, ("doc-1",)),
        (BaseVector.delete_by_ids, ([],)),
        (BaseVector.get_ids_by_metadata_field, ("doc_id", "doc-1")),
        (BaseVector.delete_by_metadata_field, ("doc_id", "doc-1")),
        (BaseVector.search_by_vector, ([0.1],)),
        (BaseVector.search_by_full_text, ("query",)),
        (BaseVector.delete, ()),
    ],
)
def test_base_vector_default_methods_raise_not_implemented(base_method, args):
    vector = _DummyVector("collection_1")

    with pytest.raises(NotImplementedError):
        base_method(vector, *args)


def test_filter_duplicate_texts_removes_existing_docs():
    vector = _DummyVector("collection_1", existing_ids={"dup"})
    docs = [
        SimpleNamespace(page_content="keep-no-meta", metadata=None),
        Document(page_content="keep-no-doc-id", metadata={"document_id": "d1"}),
        Document(page_content="remove-dup", metadata={"doc_id": "dup"}),
        Document(page_content="keep-unique", metadata={"doc_id": "unique"}),
    ]

    filtered = vector._filter_duplicate_texts(docs)

    assert [d.page_content for d in filtered] == ["keep-no-meta", "keep-no-doc-id", "keep-unique"]


def test_get_uuids_and_collection_name_property():
    vector = _DummyVector("collection_1")
    docs = [
        Document(page_content="a", metadata={"doc_id": "id-1"}),
        SimpleNamespace(page_content="b", metadata=None),
        Document(page_content="c", metadata={"document_id": "d-1"}),
        Document(page_content="d", metadata={"doc_id": "id-2"}),
    ]

    assert vector._get_uuids(docs) == ["id-1", "id-2"]
    assert vector.collection_name == "collection_1"
