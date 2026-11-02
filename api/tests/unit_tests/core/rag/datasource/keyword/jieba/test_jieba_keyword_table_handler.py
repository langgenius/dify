import sys
import types
from collections.abc import Callable
from typing import override

import pytest
from jieba.analyse import TFIDF

from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler
from core.rag.datasource.keyword.jieba.stopwords import STOPWORDS


class _RecordingTFIDF(TFIDF):
    """A real jieba TF-IDF extractor that returns a fixed keyword list.

    Everything but tag extraction is the production class: it builds the same
    IDF table and exposes the ``stop_words`` attribute the handler writes to.
    ``extract_tags`` returns keywords chosen by the test, so the assertions can
    name the expected keywords instead of depending on jieba's dictionary.
    """

    def __init__(self, keywords: list[str], idf_path: str | None = None) -> None:
        super().__init__(idf_path)
        self.keywords = keywords

    @override
    def extract_tags(  # pyrefly: ignore[bad-override] - TFIDF's untyped signature is wider
        self,
        sentence: str,
        topK: int | None = 20,
        withWeight: bool = False,
        allowPOS: tuple[str, ...] = (),
    ) -> list[str]:
        return list(self.keywords)


@pytest.fixture
def fake_jieba(monkeypatch: pytest.MonkeyPatch) -> Callable[..., types.ModuleType]:
    """Install a real ``jieba.analyse`` module object with controllable attributes."""

    def install(
        *,
        default_tfidf: TFIDF | None = None,
        tfidf_class: type[TFIDF] | None = None,
        tfidf_submodule_class: type[TFIDF] | None = None,
    ) -> types.ModuleType:
        # Each assignment supplies what jieba's real analyse package exposes;
        # types.ModuleType declares none of these attributes.
        analyse = types.ModuleType("jieba.analyse")
        if default_tfidf is not None:
            analyse.default_tfidf = default_tfidf  # pyrefly: ignore[missing-attribute]
        if tfidf_class is not None:
            analyse.TFIDF = tfidf_class  # pyrefly: ignore[missing-attribute]
        analyse.__package__ = "jieba"

        jieba_package = types.ModuleType("jieba")
        jieba_package.__path__ = []
        jieba_package.analyse = analyse  # pyrefly: ignore[missing-attribute]

        tfidf_module = types.ModuleType("jieba.analyse.tfidf")
        tfidf_module.TFIDF = tfidf_submodule_class  # pyrefly: ignore[missing-attribute]

        monkeypatch.setitem(sys.modules, "jieba", jieba_package)
        monkeypatch.setitem(sys.modules, "jieba.analyse", analyse)
        monkeypatch.setitem(sys.modules, "jieba.analyse.tfidf", tfidf_module)
        return analyse

    return install


def test_init_uses_existing_default_tfidf(fake_jieba: Callable[..., types.ModuleType]) -> None:
    default_tfidf = _RecordingTFIDF(keywords=[])
    fake_jieba(default_tfidf=default_tfidf)

    handler = JiebaKeywordTableHandler()

    assert handler._tfidf is default_tfidf
    assert handler._tfidf.stop_words == STOPWORDS


def test_init_instantiates_tfidf_class_and_caches_it(fake_jieba: Callable[..., types.ModuleType]) -> None:
    analyse = fake_jieba(tfidf_class=TFIDF)

    handler = JiebaKeywordTableHandler()

    assert isinstance(handler._tfidf, TFIDF)
    assert analyse.default_tfidf is handler._tfidf


def test_init_imports_tfidf_from_submodule_when_class_is_missing(fake_jieba: Callable[..., types.ModuleType]) -> None:
    analyse = fake_jieba(tfidf_submodule_class=TFIDF)

    handler = JiebaKeywordTableHandler()

    assert isinstance(handler._tfidf, TFIDF)
    assert analyse.default_tfidf is handler._tfidf


def test_init_builds_fallback_tfidf_when_jieba_has_none(fake_jieba: Callable[..., types.ModuleType]) -> None:
    # The fake package exposes neither lcut nor cut, which is the fallback's other branch.
    fake_jieba()

    handler = JiebaKeywordTableHandler()

    assert type(handler._tfidf).__name__ == "_SimpleTFIDF"
    assert handler._tfidf.extract_tags("one two two and three", topK=1) == ["two"]


def test_extract_keywords_asks_for_top_k_and_returns_expanded_keywords(
    fake_jieba: Callable[..., types.ModuleType],
) -> None:
    fake_jieba(default_tfidf=_RecordingTFIDF(keywords=["alpha-beta", "during", "gamma"]))

    handler = JiebaKeywordTableHandler()
    keywords = handler.extract_keywords("input text", max_keywords_per_chunk=3)

    assert keywords == {"alpha-beta", "alpha", "beta", "during", "gamma"}


def test_expand_tokens_with_subtokens_filters_stopwords_from_subtokens() -> None:
    handler = JiebaKeywordTableHandler()

    expanded = handler._expand_tokens_with_subtokens({"alpha-during-beta"})

    assert "alpha-during-beta" in expanded
    assert "alpha" in expanded
    assert "beta" in expanded
    assert "during" not in expanded
