import re
from typing import cast

from jieba import analyse  # type: ignore  # module provided by jieba3k

from core.rag.datasource.keyword.jieba.stopwords import STOPWORDS, STOPWORDS_FILE


class JiebaKeywordTableHandler:
    _stopwords_initialized: bool = False

    def __init__(self):
        self._set_stopwords()

    def extract_keywords(self, text: str, max_keywords_per_chunk: int | None = 10) -> set[str]:
        """Extract keywords with JIEBA tfidf."""
        keywords = analyse.extract_tags(
            sentence=text,
            topK=max_keywords_per_chunk,
        )
        # analyse.extract_tags returns list[Any] when withFlag is False by default.
        keywords = cast(list[str], keywords)

        return set(self._expand_tokens_with_subtokens(set(keywords)))

    def _set_stopwords(self):
        if self.__class__._stopwords_initialized:
            return
        analyse.set_stop_words(str(STOPWORDS_FILE))
        # Keep jieba's TF-IDF stopword set aligned with our curated list (newline added in load_stopwords()).
        analyse.default_tfidf.stop_words = set(STOPWORDS)  # type: ignore
        self.__class__._stopwords_initialized = True

    def _expand_tokens_with_subtokens(self, tokens: set[str]) -> set[str]:
        """Get subtokens from a list of tokens, filtering for stopwords."""
        results = set()
        for token in tokens:
            results.add(token)
            sub_tokens = re.findall(r"\w+", token)
            if len(sub_tokens) > 1:
                results.update({w for w in sub_tokens if w not in list(STOPWORDS)})

        return results
