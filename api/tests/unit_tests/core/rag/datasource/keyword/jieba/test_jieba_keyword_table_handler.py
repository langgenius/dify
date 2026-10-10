import re
import sys
import types
from collections.abc import Iterator
from types import SimpleNamespace

import pytest

from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import (
    JiebaKeywordTableHandler,
    _ScriptRunPreservingTokenizer,
    _Tokenizer,
)
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


class _RecordingTokenizer:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def cut(self, sentence: str) -> Iterator[str]:
        self.calls.append(sentence)
        return iter([sentence])


class _JiebaLikeTokenizer:
    """
    Stand-in for `jieba.dt` with the behaviour this fix works around: runs of Han characters and
    ASCII letters/digits stay together, and every other character is emitted on its own.

    Real jieba also splits Han runs into dictionary words. The suite does not load it: importing
    jieba under the suite's branch coverage takes minutes.
    """

    _TOKEN = re.compile(r"[\u4e00-\u9fd5a-zA-Z0-9]+|.", re.DOTALL)

    def cut(self, sentence: str) -> Iterator[str]:
        return iter(self._TOKEN.findall(sentence))


class _TokenizingTFIDF(_DummyTFIDF):
    """Mirrors jieba's `TFIDF.extract_tags`: tokens from `self.tokenizer` minus 1-character tokens and stopwords."""

    def __init__(self, tokenizer: _Tokenizer) -> None:
        super().__init__()
        self.tokenizer = tokenizer

    def extract_tags(self, sentence: str, **kwargs: int) -> list[str]:
        words = [
            word
            for word in self.tokenizer.cut(sentence)
            if len(word.strip()) >= 2 and word.lower() not in self.stop_words
        ]
        return list(dict.fromkeys(words))[: kwargs.get("topK", 20)]


def _install_jieba_like_tfidf(monkeypatch: pytest.MonkeyPatch) -> None:
    analyse_module = types.ModuleType("jieba.analyse")
    analyse_module.default_tfidf = _TokenizingTFIDF(_JiebaLikeTokenizer())
    _install_fake_jieba_modules(monkeypatch, analyse_module)


def test_script_run_preserving_tokenizer_emits_katakana_runs_and_forwards_the_rest() -> None:
    recorder = _RecordingTokenizer()

    tokens = list(_ScriptRunPreservingTokenizer(recorder).cut("設定のﾊﾟｽﾜｰﾄﾞ・リセット（ＥＣ２）"))

    # half-width katakana is NFKC-normalized, "・" splits words, full-width letters/digits become ASCII
    assert tokens == ["設定の", "パスワード", "・", "リセット", "（EC2）"]
    assert recorder.calls == ["設定の", "・", "（EC2）"]


def test_script_run_preserving_tokenizer_forwards_text_without_katakana_or_fullwidth_in_one_call() -> None:
    recorder = _RecordingTokenizer()
    text = "带薪休假的申请，请通过 HR-system 提交。"

    tokens = list(_ScriptRunPreservingTokenizer(recorder).cut(text))

    assert tokens == [text]
    assert recorder.calls == [text]


def test_script_run_preserving_tokenizer_folds_fullwidth_letters_in_chinese_text() -> None:
    recorder = _RecordingTokenizer()

    tokens = list(_ScriptRunPreservingTokenizer(recorder).cut("Ａ股市场"))

    # jieba then segments "A股市场" into "A股" and "市场"; before, the full-width "Ａ" was dropped
    assert tokens == ["A股市场"]
    assert recorder.calls == ["A股市场"]


def test_init_wraps_default_tfidf_tokenizer_once(monkeypatch: pytest.MonkeyPatch) -> None:
    analyse_module = types.ModuleType("jieba.analyse")
    base_tokenizer = _RecordingTokenizer()
    default_tfidf = _TokenizingTFIDF(base_tokenizer)
    analyse_module.default_tfidf = default_tfidf
    _install_fake_jieba_modules(monkeypatch, analyse_module)

    JiebaKeywordTableHandler()
    handler = JiebaKeywordTableHandler()

    assert handler._tfidf is default_tfidf
    assert isinstance(default_tfidf.tokenizer, _ScriptRunPreservingTokenizer)
    assert default_tfidf.tokenizer._tokenizer is base_tokenizer


def test_extract_keywords_keeps_katakana_words(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_jieba_like_tfidf(monkeypatch)
    handler = JiebaKeywordTableHandler()

    keywords = handler.extract_keywords("パスワードをリセットするには、ログイン画面のリンクをクリックしてください。")

    assert {"パスワード", "リセット", "ログイン", "リンク", "クリック", "画面"} <= keywords


def test_extract_keywords_folds_fullwidth_letters_and_digits_to_ascii(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_jieba_like_tfidf(monkeypatch)
    handler = JiebaKeywordTableHandler()

    keywords = handler.extract_keywords("ＡＷＳのＥＣ２インスタンスを再起動する手順")

    assert {"AWS", "EC2", "インスタンス"} <= keywords


def test_extract_keywords_matches_japanese_query_to_document_keywords(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_jieba_like_tfidf(monkeypatch)
    handler = JiebaKeywordTableHandler()

    document_keywords = handler.extract_keywords(
        "パスワードをリセットするには、ログイン画面のリンクをクリックしてください。"
    )
    query_keywords = handler.extract_keywords("ﾊﾟｽﾜｰﾄﾞのリセット方法")

    assert query_keywords & document_keywords == {"パスワード", "リセット"}
