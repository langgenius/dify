import sys
import types
from types import SimpleNamespace

import pytest

from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.datasource.keyword.jieba.stopwords import STOPWORDS


class _DummyTFIDF:
    def __init__(self):
        self.stop_words = set()

    @staticmethod
    def extract_tags(sentence: str, top_k: int | None = 20, **kwargs):
        return ["alpha_beta", "during", "gamma"]


def _install_fake_jieba_modules(
    monkeypatch,
    analyse_module: types.ModuleType,
    jieba_attrs: dict[str, object] | None = None,
    tfidf_module: types.ModuleType | None = None,
):
    jieba_module = types.ModuleType("jieba")
    jieba_module.__path__ = []
    if jieba_attrs:
        for key, value in jieba_attrs.items():
            setattr(jieba_module, key, value)

    jieba_module.analyse = analyse_module
    analyse_module.__package__ = "jieba"

    monkeypatch.setitem(sys.modules, "jieba", jieba_module)
    monkeypatch.setitem(sys.modules, "jieba.analyse", analyse_module)
    if tfidf_module is not None:
        monkeypatch.setitem(sys.modules, "jieba.analyse.tfidf", tfidf_module)
    else:
        monkeypatch.delitem(sys.modules, "jieba.analyse.tfidf", raising=False)


def test_init_uses_existing_default_tfidf(monkeypatch: pytest.MonkeyPatch):
    analyse_module = types.ModuleType("jieba.analyse")
    default_tfidf = _DummyTFIDF()
    analyse_module.default_tfidf = default_tfidf

    _install_fake_jieba_modules(monkeypatch, analyse_module)

    handler = JiebaKeywordTableHandler()

    assert handler._tfidf is default_tfidf
    assert handler._tfidf.stop_words == STOPWORDS


def test_load_tfidf_extractor_uses_tfidf_class_and_caches_default(monkeypatch: pytest.MonkeyPatch):
    analyse_module = types.ModuleType("jieba.analyse")
    analyse_module.default_tfidf = None

    class _TFIDFFactory(_DummyTFIDF):
        pass

    analyse_module.TFIDF = _TFIDFFactory
    _install_fake_jieba_modules(monkeypatch, analyse_module)

    handler = JiebaKeywordTableHandler()

    assert isinstance(handler._tfidf, _TFIDFFactory)
    assert analyse_module.default_tfidf is handler._tfidf


def test_load_tfidf_extractor_imports_from_tfidf_submodule(monkeypatch: pytest.MonkeyPatch):
    analyse_module = types.ModuleType("jieba.analyse")
    analyse_module.default_tfidf = None

    tfidf_module = types.ModuleType("jieba.analyse.tfidf")

    class _ImportedTFIDF(_DummyTFIDF):
        pass

    tfidf_module.TFIDF = _ImportedTFIDF
    _install_fake_jieba_modules(monkeypatch, analyse_module, tfidf_module=tfidf_module)

    handler = JiebaKeywordTableHandler()

    assert isinstance(handler._tfidf, _ImportedTFIDF)
    assert analyse_module.default_tfidf is handler._tfidf


def test_load_tfidf_extractor_falls_back_when_tfidf_unavailable(monkeypatch: pytest.MonkeyPatch):
    analyse_module = types.ModuleType("jieba.analyse")
    analyse_module.default_tfidf = None
    _install_fake_jieba_modules(monkeypatch, analyse_module)

    handler = JiebaKeywordTableHandler()
    fallback_keywords = handler._tfidf.extract_tags("one two two and three", topK=1)

    assert fallback_keywords == ["two"]


def test_build_fallback_tfidf_uses_lcut_when_available(monkeypatch: pytest.MonkeyPatch):
    analyse_module = types.ModuleType("jieba.analyse")
    _install_fake_jieba_modules(monkeypatch, analyse_module, jieba_attrs={"lcut": lambda _: ["x", "x", "y"]})

    tfidf = JiebaKeywordTableHandler._build_fallback_tfidf()

    assert tfidf.extract_tags("ignored", topK=1) == ["x"]


def test_build_fallback_tfidf_uses_cut_when_lcut_is_missing(monkeypatch: pytest.MonkeyPatch):
    analyse_module = types.ModuleType("jieba.analyse")
    _install_fake_jieba_modules(
        monkeypatch,
        analyse_module,
        jieba_attrs={"cut": lambda _: iter(["foo", "foo", "bar"])},
    )

    tfidf = JiebaKeywordTableHandler._build_fallback_tfidf()

    assert tfidf.extract_tags("ignored", topK=1) == ["foo"]


def test_extract_keywords_expands_subtokens():
    handler = JiebaKeywordTableHandler.__new__(JiebaKeywordTableHandler)
    handler._tfidf = SimpleNamespace(extract_tags=lambda *_args, **_kwargs: ["alpha-beta", "during", "gamma"])

    keywords = handler.extract_keywords("input text", max_keywords_per_chunk=3)

    assert "alpha-beta" in keywords
    assert "alpha" in keywords
    assert "beta" in keywords
    assert "during" in keywords
    assert "gamma" in keywords


def test_expand_tokens_with_subtokens_filters_stopwords_from_subtokens():
    handler = JiebaKeywordTableHandler.__new__(JiebaKeywordTableHandler)

    expanded = handler._expand_tokens_with_subtokens({"alpha-during-beta"})

    assert "alpha-during-beta" in expanded
    assert "alpha" in expanded
    assert "beta" in expanded
    assert "during" not in expanded
