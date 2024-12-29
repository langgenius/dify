import re
from typing import Optional

import MeCab


class JapaneseKeywordTableHandler:
    def __init__(self):
        from core.rag.datasource.keyword.japanese.stopwords import STOPWORDS

        self.tagger = MeCab.Tagger()
        self.stopwords = STOPWORDS

    def extract_keywords(self, text: str, max_keywords_per_chunk: Optional[int] = 10) -> set[str]:
        node = self.tagger.parseToNode(text)
        keywords = set()
        while node:
            word = node.surface
            if word not in self.stopwords:
                keywords.add(word)
            node = node.next
        return self._expand_tokens_with_subtokens(keywords)[:max_keywords_per_chunk]

    def _expand_tokens_with_subtokens(self, tokens: set[str]) -> set[str]:
        results = set()
        for token in tokens:
            results.add(token)
            # Example: Split Kanji compounds
            sub_tokens = re.findall(r"[\u4e00-\u9fff]", token)  # Regex for Kanji
            results.update(sub_tokens)
        return results
