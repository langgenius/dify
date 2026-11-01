import re
import unicodedata
from collections.abc import Callable, Iterable, Iterator
from operator import itemgetter
from typing import Any, Protocol, cast

# A katakana letter (full- or half-width) followed by letters, the prolonged sound mark "ー",
# iteration marks or half-width voiced sound marks. The middle dot "・" separates words, so it
# ends a run.
_KATAKANA_RUN = re.compile(
    r"[\u30a1-\u30fa\u30ff\u31f0-\u31ff\uff66-\uff6f\uff71-\uff9d]"
    r"[\u30a1-\u30fa\u30fc-\u30ff\u31f0-\u31ff\uff66-\uff9f]*"
)

# Full-width digits and Latin letters ("０-９", "Ａ-Ｚ", "ａ-ｚ") to their ASCII forms.
_FULLWIDTH_ALNUM_TO_ASCII = {
    code: code - 0xFEE0
    for first, last in ((0xFF10, 0xFF19), (0xFF21, 0xFF3A), (0xFF41, 0xFF5A))
    for code in range(first, last + 1)
}


class _Tokenizer(Protocol):
    def cut(self, sentence: str) -> Iterable[str]: ...


class _ScriptRunPreservingTokenizer:
    """
    Wrap a jieba tokenizer so katakana words and full-width letters/digits survive as whole tokens.

    jieba groups only Han characters, ASCII letters/digits and a few ASCII symbols into words and
    emits every other character on its own, and TF-IDF extraction then discards single-character
    tokens. Katakana words such as "パスワード" and full-width terms such as "ＡＷＳ" could therefore
    never become keywords, neither when indexing a document nor when parsing a query.

    Full-width letters/digits are folded to ASCII and each katakana run is emitted as one token,
    NFKC-normalized so that half-width katakana matches its full-width form. Everything else is
    handed to the wrapped tokenizer unchanged. Text without katakana or full-width letters/digits
    reaches it as a single, unmodified call, so its tokens are exactly jieba's. Folding can change
    how neighbouring Han characters are segmented, because jieba's dictionary has mixed words such
    as "U盘": "Ｕ盘" now yields "U盘", where the full-width letter used to be dropped.
    """

    def __init__(self, tokenizer: _Tokenizer):
        self._tokenizer = tokenizer

    def cut(self, sentence: str) -> Iterator[str]:
        sentence = sentence.translate(_FULLWIDTH_ALNUM_TO_ASCII)
        start = 0
        for match in _KATAKANA_RUN.finditer(sentence):
            if match.start() > start:
                yield from self._tokenizer.cut(sentence[start : match.start()])
            yield unicodedata.normalize("NFKC", match.group())
            start = match.end()
        if start < len(sentence):
            yield from self._tokenizer.cut(sentence[start:])


class JiebaKeywordTableHandler:
    def __init__(self):
        from core.rag.datasource.keyword.jieba.stopwords import STOPWORDS

        tfidf = self._load_tfidf_extractor()
        tfidf.stop_words = STOPWORDS  # type: ignore[attr-defined]
        self._preserve_script_runs(tfidf)
        self._tfidf = tfidf

    @staticmethod
    def _preserve_script_runs(tfidf: Any) -> None:
        """
        Route the extractor's tokenization through `_ScriptRunPreservingTokenizer`.

        `tfidf` is usually jieba's shared default extractor (see `_load_tfidf_extractor`), so the
        wrapper is installed once and never stacked. Like the `stop_words` assignment in
        `__init__`, this also applies to `jieba.analyse.extract_tags` elsewhere in the process.
        Extractors without a `tokenizer`, such as the `_SimpleTFIDF` fallback, are left as they are.
        """
        tokenizer = getattr(tfidf, "tokenizer", None)
        if tokenizer is None or isinstance(tokenizer, _ScriptRunPreservingTokenizer):
            return
        tfidf.tokenizer = _ScriptRunPreservingTokenizer(tokenizer)

    def _load_tfidf_extractor(self):
        """
        Load jieba TFIDF extractor with fallback strategy.

        Loading Flow:
        ┌─────────────────────────────────────────────────────────────────────┐
        │                      jieba.analyse.default_tfidf                    │
        │                              exists?                                │
        └─────────────────────────────────────────────────────────────────────┘
                           │                              │
                          YES                            NO
                           │                              │
                           ▼                              ▼
                ┌──────────────────┐       ┌──────────────────────────────────┐
                │  Return default  │       │   jieba.analyse.TFIDF exists?    │
                │      TFIDF       │       └──────────────────────────────────┘
                └──────────────────┘                │                │
                                                   YES              NO
                                                    │                │
                                                    │                ▼
                                                    │   ┌────────────────────────────┐
                                                    │   │  Try import from          │
                                                    │   │  jieba.analyse.tfidf.TFIDF │
                                                    │   └────────────────────────────┘
                                                    │          │            │
                                                    │        SUCCESS      FAILED
                                                    │          │            │
                                                    ▼          ▼            ▼
                                        ┌────────────────────────┐    ┌─────────────────┐
                                        │  Instantiate TFIDF()   │    │  Build fallback │
                                        │  & cache to default    │    │  _SimpleTFIDF   │
                                        └────────────────────────┘    └─────────────────┘
        """
        import jieba.analyse  # type: ignore

        tfidf = getattr(jieba.analyse, "default_tfidf", None)
        if tfidf is not None:
            return tfidf

        tfidf_class = getattr(jieba.analyse, "TFIDF", None)
        if tfidf_class is None:
            try:
                from jieba.analyse.tfidf import TFIDF  # type: ignore

                tfidf_class = TFIDF
            except Exception:
                tfidf_class = None

        if tfidf_class is not None:
            tfidf = tfidf_class()
            jieba.analyse.default_tfidf = tfidf  # type: ignore[attr-defined]
            return tfidf

        return self._build_fallback_tfidf()

    @staticmethod
    def _build_fallback_tfidf():
        """Fallback lightweight TFIDF for environments missing jieba's TFIDF."""
        import jieba  # type: ignore

        from core.rag.datasource.keyword.jieba.stopwords import STOPWORDS

        class _SimpleTFIDF:
            def __init__(self):
                self.stop_words = STOPWORDS
                self._lcut = getattr(jieba, "lcut", None)

            def extract_tags(self, sentence: str, top_k: int | None = 20, **kwargs):
                # Basic frequency-based keyword extraction as a fallback when TF-IDF is unavailable.
                top_k = cast(int | None, kwargs.pop("topK", top_k))
                if top_k is None:
                    top_k = 20
                cut = getattr(jieba, "cut", None)
                if self._lcut:
                    tokens = self._lcut(sentence)
                elif callable(cut):
                    tokens = list(cast(Callable[[str], list[str]], cut)(sentence))
                else:
                    tokens = re.findall(r"\w+", sentence)

                words = [w for w in tokens if w and w not in self.stop_words]
                freq: dict[str, int] = {}
                for w in words:
                    freq[w] = freq.get(w, 0) + 1

                sorted_words = sorted(freq.items(), key=itemgetter(1), reverse=True)
                if top_k is not None:
                    sorted_words = sorted_words[:top_k]

                return [item[0] for item in sorted_words]

        return _SimpleTFIDF()

    def extract_keywords(self, text: str, max_keywords_per_chunk: int | None = 10) -> set[str]:
        """Extract keywords with JIEBA tfidf."""
        keywords = self._tfidf.extract_tags(
            sentence=text,
            topK=max_keywords_per_chunk or 10,
        )
        # jieba.analyse.extract_tags returns an untyped list when withFlag is False by default.
        keywords = cast(list[str], keywords)

        return set(self._expand_tokens_with_subtokens(set(keywords)))

    def _expand_tokens_with_subtokens(self, tokens: set[str]) -> set[str]:
        """Get subtokens from a list of tokens., filtering for stopwords."""
        from core.rag.datasource.keyword.jieba.stopwords import STOPWORDS

        results = set()
        for token in tokens:
            results.add(token)
            sub_tokens = re.findall(r"\w+", token)
            if len(sub_tokens) > 1:
                results.update({w for w in sub_tokens if w not in STOPWORDS})

        return results
