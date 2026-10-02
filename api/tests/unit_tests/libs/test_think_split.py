from libs.think_split import REASONING, TEXT, ThinkSplitter, split_think


class TestSplitThink:
    def test_extracts_complete_reasoning_block(self):
        assert split_think("<think>reasoning</think>answer") == ("answer", "reasoning")

    def test_returns_untouched_text_without_reasoning(self):
        assert split_think("answer") == ("answer", "")

    def test_removes_provider_reasoning_marker(self):
        answer, reasoning = split_think("<think>\n<!--dify-deepseek-reasoning-->reasoning\n</think>answer")

        assert answer == "answer"
        assert "dify-deepseek-reasoning" not in reasoning
        assert "reasoning" in reasoning


class TestThinkSplitter:
    def test_splits_single_chunk_into_reasoning_and_text(self):
        splitter = ThinkSplitter()

        assert splitter.feed("<think>reasoning</think>answer") == [
            (REASONING, "reasoning"),
            (TEXT, "answer"),
        ]

    def test_keeps_tag_split_across_chunks_out_of_text(self):
        splitter = ThinkSplitter()

        assert splitter.feed("<thi") == []
        assert splitter.feed("nk>reasoning</thi") == [(REASONING, "reasoning")]
        assert splitter.feed("nk>answer") == [(TEXT, "answer")]

    def test_finalize_drops_unclosed_reasoning_block(self):
        splitter = ThinkSplitter()

        assert splitter.feed("<think>reasoning") == [(REASONING, "reasoning")]
        assert splitter.finalize() == []

    def test_finalize_releases_incomplete_text_tag(self):
        splitter = ThinkSplitter()

        assert splitter.feed("answer<thi") == [(TEXT, "answer")]
        assert splitter.finalize() == [(TEXT, "<thi")]
