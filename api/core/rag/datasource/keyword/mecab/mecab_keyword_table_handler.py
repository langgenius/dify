from collections import defaultdict
from operator import itemgetter
from typing import Optional

import MeCab  # type: ignore

from core.rag.datasource.keyword.mecab.stopwords import STOPWORDS


class MeCabKeywordTableHandler:
    """Japanese keyword extraction using MeCab morphological analyzer."""

    def __init__(self, dictionary_path: str = "", user_dictionary_path: str = ""):
        """Initialize MeCab tokenizer.

        Args:
            dictionary_path: Path to custom system dictionary
            user_dictionary_path: Path to user dictionary
        """
        try:
            # Build MeCab argument string
            mecab_args = ["-Ochasen"]  # Use ChaSen format for detailed POS info
            if dictionary_path:
                mecab_args.append(f"-d {dictionary_path}")
            if user_dictionary_path:
                mecab_args.append(f"-u {user_dictionary_path}")

            self.tagger = MeCab.Tagger(" ".join(mecab_args))
            self.tagger.parse("")  # Force initialization to catch dictionary errors

        except RuntimeError as e:
            raise RuntimeError(f"Failed to initialize MeCab: {str(e)}")

        # POS weights for scoring
        self.pos_weights = {
            "名詞": 1.0,  # Nouns
            "動詞": 0.8,  # Verbs
            "形容詞": 0.6,  # Adjectives
            "副詞": 0.4,  # Adverbs
            "連体詞": 0.3,  # Adnominal adjectives
            "感動詞": 0.2,  # Interjections
        }
        self.min_score = 0.3

    def extract_keywords(self, text: str, max_keywords_per_chunk: Optional[int] = 10) -> set[str]:
        """Extract keywords from Japanese text using MeCab.

        Args:
            text: Input text to extract keywords from
            max_keywords_per_chunk: Maximum number of keywords to extract

        Returns:
            Set of extracted keywords
        """
        if not text or not text.strip():
            return set()

        try:
            # Parse text with MeCab
            self.tagger.parse("")  # Clear tagger state
            node = self.tagger.parseToNode(text)

            # Calculate term frequencies and scores
            term_scores: defaultdict[str, float] = defaultdict(float)
            while node:
                features = node.feature.split(",")
                if len(features) > 0:
                    pos = features[0]  # Part of speech
                    pos_subtype = features[1] if len(features) > 1 else ""
                    base_form = features[6] if len(features) > 6 else node.surface

                    # Score the term based on its POS
                    if pos in self.pos_weights and base_form not in STOPWORDS:
                        score = self.pos_weights[pos]
                        # Boost proper nouns and technical terms
                        if pos == "名詞" and pos_subtype in ["固有名詞", "専門用語"]:
                            score *= 1.5
                        if len(base_form) > 1:  # Filter out single characters
                            term_scores[base_form] += score

                node = node.next

            # Get top scoring terms
            sorted_terms = sorted(term_scores.items(), key=itemgetter(1), reverse=True)

            # Filter by minimum score and take top N
            keywords = {term for term, score in sorted_terms if score >= self.min_score}

            if max_keywords_per_chunk:
                keywords = set(list(keywords)[:max_keywords_per_chunk])

            # Expand with compound terms
            expanded_keywords = self._expand_tokens_with_compounds(keywords, text)

            return expanded_keywords

        except Exception as e:
            raise RuntimeError(f"Failed to extract keywords: {str(e)}")

    def _expand_tokens_with_compounds(self, keywords: set[str], text: str) -> set[str]:
        """Expand keywords with compound terms.

        This method looks for adjacent keywords in the original text to capture
        compound terms like '機械学習' (machine learning) or '自然言語処理' (natural language processing).
        """
        results = set(keywords)

        try:
            # Parse again to find compounds
            node = self.tagger.parseToNode(text)
            compound = []
            compound_readings = []  # For handling different forms of the same compound

            while node:
                features = node.feature.split(",")
                if len(features) > 6:
                    base_form = features[6]
                    reading = features[7] if len(features) > 7 else None
                else:
                    base_form = node.surface
                    reading = None

                if base_form in keywords:
                    compound.append(base_form)
                    if reading:
                        compound_readings.append(reading)
                else:
                    if len(compound) > 1:
                        # Add the compound term
                        compound_term = "".join(compound)
                        if len(compound_term) > 1:
                            results.add(compound_term)
                            # If readings are available, add normalized form
                            if compound_readings:
                                normalized_term = "".join(compound_readings)
                                if normalized_term != compound_term:
                                    results.add(normalized_term)
                    compound = []
                    compound_readings = []

                node = node.next

            return results

        except Exception as e:
            # If compound expansion fails, return original keywords
            return keywords
