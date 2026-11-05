import json
from typing import override

import pytest
from sqlalchemy.orm import Session

from core.rag.datasource.keyword.keyword_base import BaseKeyword
from core.rag.models.document import Document
from models import Dataset
from tests.helpers.unit.model_factories import make_dataset


def _dataset() -> Dataset:
    return make_dataset()


class _KeywordThatRaises(BaseKeyword):
    @override
    def create(self, texts: list[Document], session: Session, **kwargs: object) -> BaseKeyword:
        return BaseKeyword.create(self, texts, session, **kwargs)  # intentional: base must raise NotImplementedError

    @override
    def add_texts(self, texts: list[Document], session: Session, **kwargs: object) -> None:
        return BaseKeyword.add_texts(self, texts, session, **kwargs)  # intentional: base must raise NotImplementedError

    @override
    def text_exists(self, id: str, *, session: Session) -> bool:
        return BaseKeyword.text_exists(self, id, session=session)  # intentional: base must raise NotImplementedError

    @override
    def delete_by_ids(self, ids: list[str], session: Session, **kwargs: object) -> None:
        return BaseKeyword.delete_by_ids(
            self, ids, session, **kwargs
        )  # intentional: base must raise NotImplementedError

    @override
    def delete(self, *, session: Session) -> None:
        return BaseKeyword.delete(self, session=session)  # intentional: base must raise NotImplementedError

    @override
    def search(self, query: str, *, session: Session, **kwargs: object) -> list[Document]:
        return BaseKeyword.search(
            self, query, session=session, **kwargs
        )  # intentional: base must raise NotImplementedError


class _KeywordForHelpers(BaseKeyword):
    def __init__(self, dataset: Dataset, existing_ids: set[str] | None = None) -> None:
        super().__init__(dataset)
        self._existing_ids = existing_ids or set()

    @override
    def create(self, texts: list[Document], session: Session, **kwargs: object) -> BaseKeyword:
        return self

    @override
    def add_texts(self, texts: list[Document], session: Session, **kwargs: object) -> None:
        return None

    @override
    def text_exists(self, id: str, *, session: Session) -> bool:
        return id in self._existing_ids

    @override
    def delete_by_ids(self, ids: list[str], session: Session, **kwargs: object) -> None:
        return None

    @override
    def delete(self, *, session: Session) -> None:
        return None

    @override
    def search(self, query: str, *, session: Session, **kwargs: object) -> list[Document]:
        return []


def test_abstract_methods_raise_not_implemented(unbound_session: Session) -> None:
    keyword = _KeywordThatRaises(_dataset())
    session = unbound_session

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


def test_filter_duplicate_texts_removes_existing_doc_ids(unbound_session: Session) -> None:
    keyword = _KeywordForHelpers(_dataset(), existing_ids={"duplicate"})
    # Deliberately no metadata: the JSON round-trip keeps the runtime None while
    # staying inside the repo's no-new-cast / no-Any-import rules.
    no_metadata = json.loads("null")
    texts = [
        Document(page_content="keep", metadata={"doc_id": "keep"}),
        Document(page_content="duplicate", metadata={"doc_id": "duplicate"}),
        Document.model_construct(
            page_content="without-metadata",
            metadata=no_metadata,
        ),
    ]

    filtered = keyword._filter_duplicate_texts(texts, session=unbound_session)

    assert [text.metadata["doc_id"] for text in filtered if text.metadata] == ["keep"]
    assert any(text.metadata is None for text in filtered)


def test_get_uuids_returns_only_docs_with_metadata() -> None:
    keyword = _KeywordForHelpers(_dataset())
    no_metadata = json.loads("null")  # deliberately no metadata
    texts = [
        Document(page_content="doc-1", metadata={"doc_id": "doc-1"}),
        Document(page_content="doc-2", metadata={"doc_id": "doc-2"}),
        Document.model_construct(
            page_content="doc-3",
            metadata=no_metadata,
        ),
    ]

    assert keyword._get_uuids(texts) == ["doc-1", "doc-2"]
