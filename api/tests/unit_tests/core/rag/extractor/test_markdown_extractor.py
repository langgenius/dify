from core.rag.extractor.markdown_extractor import MarkdownExtractor


def test_markdown_to_tups():
    markdown = """
this is some text without header

# title 1
this is balabala text

## title 2
this is more specific text.
        """
    extractor = MarkdownExtractor(file_path="dummy_path")
    updated_output = extractor.markdown_to_tups(markdown)
    assert len(updated_output) == 3
    key, header_value = updated_output[0]
    assert key == None
    assert header_value.strip() == "this is some text without header"
    title_1, value = updated_output[1]
    assert title_1.strip() == "title 1"
    assert value.strip() == "this is balabala text"
