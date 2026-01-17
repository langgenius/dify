import re
from operator import itemgetter
from typing import cast


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
                top_k = kwargs.pop("topK", top_k)
                cut = getattr(jieba, "cut", None)
                if self._lcut:
                    tokens = self._lcut(sentence)
                elif callable(cut):
                    tokens = list(cut(sentence))
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
            topK=max_keywords_per_chunk,
        )
        # jieba.analyse.extract_tags returns list[Any] when withFlag is False by default.
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
                results.update({w for w in sub_tokens if w not in list(STOPWORDS)})

        return results
