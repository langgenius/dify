import re
import unicodedata
from collections.abc import Callable
from operator import itemgetter
from typing import cast

# jieba groups only Han characters, ASCII words and a few ASCII symbols. Every other
# character is emitted alone, and TF-IDF drops single-character tokens, so katakana
# words and full-width alphanumerics never became keywords. Protect those runs with
# ASCII placeholders so TF-IDF still ranks them together with the rest of the text.
_MULTILINGUAL_TOKEN_RE = re.compile(
    r"[ァ-ヺー-ヾㇰ-ㇿ]+"  # katakana, ー and iteration marks
    r"|[ｦ-ﾟ]+"  # half-width katakana and sound marks
    r"|[Ａ-Ｚａ-ｚ０-９]+"  # full-width alphanumerics
)
_PLACEHOLDER_PREFIX = "zzdifykeyword"


class JiebaKeywordTableHandler:
    def __init__(self):
        from core.rag.datasource.keyword.jieba.stopwords import STOPWORDS

        tfidf = self._load_tfidf_extractor()
        tfidf.stop_words = STOPWORDS  # type: ignore[attr-defined]
        self._tfidf = tfidf

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

    @staticmethod
    def _protect_multilingual_tokens(text: str) -> tuple[str, dict[str, str]]:
        """Replace katakana and full-width alphanumeric runs with ASCII placeholders.

        Preconditions:
            ``text`` is the chunk or query passed to jieba.

        Postconditions:
            Returns the text to tokenize and a placeholder-to-token map. Runs whose
            NFKC form is shorter than two characters are left untouched because
            TF-IDF drops one-character tokens anyway. Placeholders contain only ASCII
            letters and digits, so jieba keeps each one whole and TF-IDF ranks it by
            the run's frequency. The caller maps results back with the returned map.
        """
        replacements: dict[str, str] = {}
        placeholder_by_token: dict[str, str] = {}
        parts: list[str] = []
        last_end = 0
        for match in _MULTILINGUAL_TOKEN_RE.finditer(text):
            token = unicodedata.normalize("NFKC", match.group()).strip()
            if len(token) >= 2:
                placeholder = placeholder_by_token.get(token)
                if placeholder is None:
                    placeholder = f"{_PLACEHOLDER_PREFIX}{len(placeholder_by_token)}zz"
                    while placeholder in text or placeholder in replacements:
                        placeholder += "z"
                    placeholder_by_token[token] = placeholder
                    replacements[placeholder] = token
                parts.extend((text[last_end : match.start()], f" {placeholder} "))
                last_end = match.end()
        if not replacements:
            return text, {}
        parts.append(text[last_end:])
        return "".join(parts), replacements

    def extract_keywords(self, text: str, max_keywords_per_chunk: int | None = 10) -> set[str]:
        """Extract keywords with JIEBA tfidf."""
        protected_text, replacements = self._protect_multilingual_tokens(text)
        keywords = self._tfidf.extract_tags(
            sentence=protected_text,
            topK=max_keywords_per_chunk or 10,
        )
        # jieba.analyse.extract_tags returns an untyped list when withFlag is False by default.
        keywords = cast(list[str], keywords)
        restored = {replacements.get(keyword, keyword) for keyword in keywords}

        return self._expand_tokens_with_subtokens(restored)

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
