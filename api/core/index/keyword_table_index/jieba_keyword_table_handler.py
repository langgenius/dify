import re
from typing import Set

import jieba
from jieba.analyse import default_tfidf

from core.index.keyword_table_index.stopwords import STOPWORDS


class JiebaKeywordTableHandler:

    def __init__(self):
        default_tfidf.stop_words = STOPWORDS

    def extract_keywords(self, text: str, max_keywords_per_chunk: int = 10) -> Set[str]:
        """Extract keywords with JIEBA tfidf."""
        keywords = jieba.analyse.extract_tags(
            sentence=text,
            topK=max_keywords_per_chunk,
        )

        return set(self._expand_tokens_with_subtokens(keywords))

    def _expand_tokens_with_subtokens(self, tokens: Set[str]) -> Set[str]:
        """Get subtokens from a list of tokens., filtering for stopwords."""
        results = set()
        for token in tokens:
            results.add(token)
            sub_tokens = re.findall(r"\w+", token)
            if len(sub_tokens) > 1:
                results.update({w for w in sub_tokens if w not in list(STOPWORDS)})

        return results