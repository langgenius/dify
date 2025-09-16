import re
from typing import Optional, cast


class _JiebaKeywordTableHandler:
    def __init__(self):
        import jieba.analyse  # type: ignore

        from core.rag.datasource.keyword.jieba.stopwords import STOPWORDS

        # Initialize jieba immediately
        jieba.analyse.default_tfidf.stop_words = STOPWORDS  # type: ignore

        # Pre-load jieba dictionary by running a dummy extraction
        jieba.analyse.extract_tags("init", topK=1)

        # Cache stopwords as a set for O(1) lookups
        self._stopwords_set = set(STOPWORDS)

        # Pre-compile regex for better performance
        self._word_pattern = re.compile(r"\w+")

    def extract_keywords(self, text: str, max_keywords_per_chunk: Optional[int] = 10) -> set[str]:
        """Extract keywords with JIEBA tfidf."""
        import jieba.analyse  # type: ignore

        # Use smaller topK to reduce processing time
        actual_topK = min(max_keywords_per_chunk or 10, 20)

        keywords = jieba.analyse.extract_tags(
            sentence=text,
            topK=actual_topK,
        )
        # jieba.analyse.extract_tags returns list[Any] when withFlag is False by default.
        keywords = cast(list[str], keywords)

        return set(self._expand_tokens_with_subtokens(frozenset(keywords)))

    def _expand_tokens_with_subtokens(self, tokens: frozenset[str]) -> frozenset[str]:
        """Get subtokens from a list of tokens., filtering for stopwords."""
        results = set(tokens)

        for token in tokens:
            sub_tokens = self._word_pattern.findall(token)
            if len(sub_tokens) > 1:
                # Use set intersection for faster filtering
                valid_subtokens = set(sub_tokens) - self._stopwords_set
                results.update(valid_subtokens)

        return frozenset(results)

    def extract_keywords_batch(self, texts: list[str], max_keywords_per_chunk: Optional[int] = 10) -> list[set[str]]:
        """Extract keywords for multiple texts in batch for better performance."""
        import jieba.analyse  # type: ignore

        if not texts:
            return []

        # Use smaller topK to reduce processing time
        actual_topK = min(max_keywords_per_chunk or 10, 20)

        results = []
        for text in texts:
            keywords = jieba.analyse.extract_tags(
                sentence=text,
                topK=actual_topK,
            )
            keywords = cast(list[str], keywords)
            results.append(set(self._expand_tokens_with_subtokens(frozenset(keywords))))

        return results

    def extract_keywords_combined(self, texts: list[str], max_keywords_per_chunk: Optional[int] = 10) -> set[str]:
        """Extract keywords from combined texts for global keyword extraction."""
        import jieba.analyse  # type: ignore

        if not texts:
            return set()

        # Combine all texts
        combined_text = " ".join(texts)

        # Use larger topK for combined text
        actual_topK = min(max_keywords_per_chunk or 10, 50)

        keywords = jieba.analyse.extract_tags(
            sentence=combined_text,
            topK=actual_topK,
        )
        keywords = cast(list[str], keywords)

        return set(self._expand_tokens_with_subtokens(frozenset(keywords)))


# Create module-level singleton instance - initializes immediately when imported
JiebaKeywordTableHandler = _JiebaKeywordTableHandler()
