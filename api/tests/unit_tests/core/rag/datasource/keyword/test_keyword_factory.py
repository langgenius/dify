import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.keyword.keyword_type import KeyWordType
from core.rag.models.document import Document


def test_get_keyword_factory_returns_jieba_factory(monkeypatch):
    fake_module = types.ModuleType("core.rag.datasource.keyword.jieba.jieba")

    class FakeJieba:
        pass

    fake_module.Jieba = FakeJieba
    monkeypatch.setitem(sys.modules, "core.rag.datasource.keyword.jieba.jieba", fake_module)

    assert Keyword.get_keyword_factory(KeyWordType.JIEBA) is FakeJieba


def test_get_keyword_factory_raises_for_unsupported_type():
    with pytest.raises(ValueError, match="Keyword store unsupported is not supported"):
        Keyword.get_keyword_factory("unsupported")


def test_keyword_initialization_uses_configured_factory(monkeypatch):
    dataset = SimpleNamespace(id="dataset-1")
    fake_processor = MagicMock()

    monkeypatch.setattr("core.rag.datasource.keyword.keyword_factory.dify_config.KEYWORD_STORE", KeyWordType.JIEBA)
    monkeypatch.setattr(Keyword, "get_keyword_factory", staticmethod(lambda keyword_type: lambda _: fake_processor))

    keyword = Keyword(dataset)

    assert keyword._keyword_processor is fake_processor


def test_keyword_methods_forward_to_processor():
    processor = MagicMock()
    processor.text_exists.return_value = True
    processor.search.return_value = [Document(page_content="matched", metadata={"doc_id": "doc-1"})]

    keyword = Keyword.__new__(Keyword)
    keyword._keyword_processor = processor

    docs = [Document(page_content="doc", metadata={"doc_id": "doc-1"})]
    keyword.create(docs, foo="bar")
    keyword.add_texts(docs, batch=True)
    assert keyword.text_exists("doc-1") is True
    keyword.delete_by_ids(["doc-1"])
    keyword.delete()
    assert keyword.search("query", top_k=1) == processor.search.return_value

    processor.create.assert_called_once_with(docs, foo="bar")
    processor.add_texts.assert_called_once_with(docs, batch=True)
    processor.text_exists.assert_called_once_with("doc-1")
    processor.delete_by_ids.assert_called_once_with(["doc-1"])
    processor.delete.assert_called_once()
    processor.search.assert_called_once_with("query", top_k=1)


def test_keyword_getattr_returns_callable_and_raises_for_invalid_attributes():
    class Processor:
        value = 1

        @staticmethod
        def custom():
            return "ok"

    keyword = Keyword.__new__(Keyword)
    keyword._keyword_processor = Processor()

    assert keyword.custom() == "ok"

    with pytest.raises(AttributeError):
        _ = keyword.value

    keyword._keyword_processor = None
    with pytest.raises(AttributeError):
        _ = keyword.missing_method
