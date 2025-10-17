
from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline


class TestThinkTagFiltering:
    """Test cases for think tag filtering in streaming mode."""

    def create_pipeline_instance(self, show_reasoning: bool = False):
        """Create a minimal pipeline instance for testing."""

        class MockPipeline:
            def __init__(self, show_reasoning: bool):
                self._show_reasoning = show_reasoning
                self._think_buffer = ""
                self._in_think_tag = False

            def _filter_think_tags_streaming(self, delta_text: str) -> str:
                return EasyUIBasedGenerateTaskPipeline._filter_think_tags_streaming(self, delta_text)

        return MockPipeline(show_reasoning)

    def test_simple_text_without_tags(self):
        """Test that regular text passes through unchanged."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        result = pipeline._filter_think_tags_streaming("Hello, world!")
        assert result == "Hello, world!"

    def test_text_with_less_than_sign(self):
        """Test that text with < character is not mistaken for a tag."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        result1 = pipeline._filter_think_tags_streaming("2 < 5 is true")
        result2 = pipeline._filter_think_tags_streaming(" and 3 < 4 too")

        assert result1 == "2 < 5 is true"
        assert result2 == " and 3 < 4 too"

    def test_complete_think_tag_filtering(self):
        """Test filtering of complete think tags in a single chunk."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        text = "Before<think>reasoning process</think>After"
        result = pipeline._filter_think_tags_streaming(text)

        assert result == "BeforeAfter"

    def test_think_tag_split_across_chunks(self):
        """Test filtering when think tag is split across multiple chunks."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        result1 = pipeline._filter_think_tags_streaming("Before<thi")
        result2 = pipeline._filter_think_tags_streaming("nk>reasoning")
        result3 = pipeline._filter_think_tags_streaming("</think>After")

        assert result1 == "Before"
        assert result2 == ""
        assert result3 == "After"

    def test_closing_tag_split_across_chunks(self):
        """Test filtering when closing tag is split across multiple chunks."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        result1 = pipeline._filter_think_tags_streaming("Before<think>reasoning</th")
        result2 = pipeline._filter_think_tags_streaming("ink>After")

        assert result1 == "Before"
        assert result2 == "After"

    def test_false_alarm_less_than_sign(self):
        """Test that standalone < followed by non-tag text works correctly."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        result1 = pipeline._filter_think_tags_streaming("x <")
        result2 = pipeline._filter_think_tags_streaming(" 5")

        assert result1 == "x "
        assert result2 == "< 5"

    def test_multiple_think_tags(self):
        """Test filtering multiple think tags."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        text = "A<think>x</think>B<think>y</think>C"
        result = pipeline._filter_think_tags_streaming(text)

        assert result == "ABC"

    def test_show_reasoning_enabled(self):
        """Test that content is preserved when show_reasoning is enabled."""
        pipeline = self.create_pipeline_instance(show_reasoning=True)

        text = "Before<think>reasoning</think>After"
        result = pipeline._filter_think_tags_streaming(text)

        assert result == text

    def test_case_insensitive_tag_matching(self):
        """Test that tags are matched case-insensitively."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        text = "Before<THINK>reasoning</THINK>After"
        result = pipeline._filter_think_tags_streaming(text)

        assert result == "BeforeAfter"

    def test_partial_tag_at_end_of_chunk(self):
        """Test handling of partial tag at the end of a chunk."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        result1 = pipeline._filter_think_tags_streaming("Text <thi")
        result2 = pipeline._filter_think_tags_streaming("nk>reason</think>")

        assert result1 == "Text "
        assert result2 == ""

    def test_not_a_think_tag(self):
        """Test that similar but different tags are not filtered."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        result1 = pipeline._filter_think_tags_streaming("Text <t")
        result2 = pipeline._filter_think_tags_streaming("est>content")

        assert result1 == "Text "
        assert result2 == "<test>content"

    def test_empty_think_tag(self):
        """Test filtering of empty think tags."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        text = "Before<think></think>After"
        result = pipeline._filter_think_tags_streaming(text)

        assert result == "BeforeAfter"

    def test_think_tag_with_newlines(self):
        """Test filtering of think tags containing newlines."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        text = "Before<think>\nreasoning\nprocess\n</think>After"
        result = pipeline._filter_think_tags_streaming(text)

        assert result == "BeforeAfter"

    def test_streaming_simulation(self):
        """Test realistic streaming scenario with multiple chunks."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        chunks = [
            "The answer is ",
            "<think>Let me ",
            "think about this...",
            "</think>42",
            " is the result.",
        ]

        results = []
        for chunk in chunks:
            result = pipeline._filter_think_tags_streaming(chunk)
            results.append(result)

        assert "".join(results) == "The answer is 42 is the result."

    def test_partial_closing_tag_not_a_tag(self):
        """Test that partial closing tag followed by non-tag text is handled correctly."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        result1 = pipeline._filter_think_tags_streaming("<think>reasoning</")
        result2 = pipeline._filter_think_tags_streaming("other>text")

        assert result1 == ""
        assert result2 == ""

    def test_complex_mixed_content(self):
        """Test complex scenario with mixed content."""
        pipeline = self.create_pipeline_instance(show_reasoning=False)

        chunks = [
            "Math: 2 < 3 and ",
            "<think>calculate",
            "</think>",
            " 5 > 4 is ",
            "true",
        ]

        results = []
        for chunk in chunks:
            result = pipeline._filter_think_tags_streaming(chunk)
            results.append(result)

        assert "".join(results) == "Math: 2 < 3 and  5 > 4 is true"

