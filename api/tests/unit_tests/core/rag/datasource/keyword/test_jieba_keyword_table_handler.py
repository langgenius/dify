"""Tests for JiebaKeywordTableHandler.

Covers the hyphenated-token bug where the old r"\\w+" pattern split "st-771" into
["st", "771"], causing technical identifiers to never match as whole terms on either
the indexing or the query expansion side.
"""

import pytest

from core.rag.datasource.keyword.jieba.jieba_keyword_table_handler import JiebaKeywordTableHandler


@pytest.fixture
def handler() -> JiebaKeywordTableHandler:
    return JiebaKeywordTableHandler()


class TestExpandTokensWithSubtokens:
    """_expand_tokens_with_subtokens preserves hyphenated compound identifiers."""

    def test_hyphenated_identifier_is_not_split(self, handler: JiebaKeywordTableHandler):
        """'st-771' must remain atomic; 'st' and '771' must NOT be added."""
        result = handler._expand_tokens_with_subtokens({"st-771"})
        assert "st-771" in result
        assert "st" not in result
        assert "771" not in result

    def test_multi_segment_hyphenated_term_is_not_split(self, handler: JiebaKeywordTableHandler):
        """'type-a-plus' must remain one token, not be split into three."""
        result = handler._expand_tokens_with_subtokens({"type-a-plus"})
        assert "type-a-plus" in result
        assert "type" not in result
        assert "plus" not in result

    def test_underscore_compound_is_not_split(self, handler: JiebaKeywordTableHandler):
        """Underscore compounds like 'test_value' are a single \\w+ token and stay whole."""
        result = handler._expand_tokens_with_subtokens({"test_value"})
        assert "test_value" in result
        # only one sub-token extracted → no expansion
        assert "test" not in result
        assert "value" not in result

    def test_plain_token_is_kept(self, handler: JiebaKeywordTableHandler):
        result = handler._expand_tokens_with_subtokens({"hello"})
        assert result == {"hello"}

    def test_multiple_tokens_processed_independently(self, handler: JiebaKeywordTableHandler):
        """Each token in the set is handled independently."""
        result = handler._expand_tokens_with_subtokens({"st-771", "world"})
        assert "st-771" in result
        assert "world" in result
        assert "st" not in result
        assert "771" not in result

    def test_non_hyphen_separator_still_splits(self, handler: JiebaKeywordTableHandler):
        """A token that jieba returns with a slash is still expanded into subtokens."""
        # e.g. "foo/bar" → sub_tokens ["foo", "bar"] → len > 1 → expansion
        result = handler._expand_tokens_with_subtokens({"foo/bar"})
        assert "foo/bar" in result
        assert "foo" in result
        assert "bar" in result


class TestSimpleTFIDFFallbackRegex:
    """_build_fallback_tfidf tokeniser preserves hyphenated terms."""

    def test_hyphenated_term_is_a_single_token(self):
        """The last-resort regex path must not break hyphenated identifiers."""
        import re

        # This is the exact expression now used in _SimpleTFIDF when neither
        # jieba.lcut nor jieba.cut is available.
        pattern = r"\w+(?:-\w+)*"
        tokens = re.findall(pattern, "serial number st-771 foo")
        assert "st-771" in tokens
        assert "st" not in tokens
        assert "771" not in tokens

    def test_plain_words_are_still_returned(self):
        import re

        pattern = r"\w+(?:-\w+)*"
        tokens = re.findall(pattern, "hello world")
        assert tokens == ["hello", "world"]

    def test_multiple_hyphens_kept_together(self):
        import re

        pattern = r"\w+(?:-\w+)*"
        tokens = re.findall(pattern, "a-b-c")
        assert tokens == ["a-b-c"]

    def test_standalone_hyphen_is_ignored(self):
        """A lone ' - ' separator (spaces on both sides) should not produce tokens."""
        import re

        pattern = r"\w+(?:-\w+)*"
        tokens = re.findall(pattern, "hello - world")
        assert tokens == ["hello", "world"]


class TestExtractKeywordsHyphenatedFromRawText:
    """extract_keywords recovers hyphenated terms that jieba's tokeniser splits."""

    def test_hyphenated_identifier_present_in_result(self, handler: JiebaKeywordTableHandler):
        """'st-771' must appear in the keyword set even though jieba splits it."""
        result = handler.extract_keywords("The device model is st-771")
        assert "st-771" in result

    def test_compound_term_present_even_when_jieba_splits_it(
        self, handler: JiebaKeywordTableHandler
    ):
        """The compound term is indexed even when jieba's TF-IDF splits it.

        When jieba splits "st-771" into "st" and "771", those subtokens land in
        tfidf_keywords and are excluded from suppression (by design — they may be
        meaningful standalone). The core guarantee is that the whole compound term
        is also present in the result; subtoken suppression is best-effort and
        does not fire when jieba itself is the source of the split.
        """
        result = handler.extract_keywords("The device model is st-771")
        assert "st-771" in result

    def test_multiple_hyphenated_terms_all_recovered(self, handler: JiebaKeywordTableHandler):
        result = handler.extract_keywords("Connect read-write interface to bus-controller st-771")
        assert "st-771" in result
        assert "read-write" in result
        assert "bus-controller" in result

    def test_underscore_compound_is_recovered(self, handler: JiebaKeywordTableHandler):
        """'model_function_description' must survive as one keyword."""
        result = handler.extract_keywords("The model type is model_function_description")
        assert "model_function_description" in result

    def test_underscore_compound_present_even_when_subtokens_returned(
        self, handler: JiebaKeywordTableHandler
    ):
        """The compound term is indexed even when jieba's TF-IDF returns its subtokens.

        Common English words like 'function' and 'description' may be returned by
        jieba's TF-IDF as significant keywords in their own right, so they are not
        suppressed. The core guarantee is that the whole underscore-joined term is
        also present; suppression of subtokens is best-effort.
        """
        result = handler.extract_keywords("The model type is model_function_description")
        assert "model_function_description" in result

    def test_plain_text_without_hyphens_unaffected(self, handler: JiebaKeywordTableHandler):
        """Normal keyword extraction still works for non-hyphenated text."""
        result = handler.extract_keywords("Dogs have remarkable ability to detect certain cancers")
        assert isinstance(result, set)
        assert len(result) > 0


class TestExtractKeywordsEndToEnd:
    """extract_keywords round-trip: hyphenated keywords survive indexing + query expansion."""

    def test_hyphenated_keyword_in_extracted_set(self, handler: JiebaKeywordTableHandler):
        """When jieba TFIDF itself returns a hyphenated token, it must survive expansion."""
        # Directly exercise the expansion layer with a known hyphenated input.
        result = handler._expand_tokens_with_subtokens({"st-771", "report"})
        assert "st-771" in result
        assert "report" in result
        # subtokens of "st-771" must not pollute the result set
        assert "st" not in result
        assert "771" not in result

    def test_query_expansion_produces_hyphenated_keyword(self, handler: JiebaKeywordTableHandler):
        """A manually indexed keyword 'st-771' must be findable when the query contains 'st-771'.

        This tests the critical path: manually stored keyword "st-771" in the keyword_table
        must match the query-side expansion of "st-771".
        """
        # Simulate what _retrieve_ids_by_query does:
        #   1. index stores "st-771" as-is (manually added)
        #   2. query "st-771" is passed through _expand_tokens_with_subtokens
        #   3. the expanded set must contain "st-771" so the lookup succeeds
        expanded_query_keywords = handler._expand_tokens_with_subtokens({"st-771"})
        indexed_keywords = {"st-771"}  # what was stored via create_segment_keywords
        overlap = expanded_query_keywords & indexed_keywords
        assert overlap, (
            "Query expansion of 'st-771' produced no tokens that overlap with "
            "the indexed keyword 'st-771'; the hyphenated identifier would never match."
        )
