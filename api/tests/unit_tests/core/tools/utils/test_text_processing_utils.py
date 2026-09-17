import pytest

from core.tools.utils.text_processing_utils import strip_reasoning_blocks


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (
            "<think>Let me [consider] the {key} points.</think>\nFinal summary text.",
            "Final summary text.",
        ),
        (
            "<think>unclosed reasoning with [brackets]\nstill going",
            "",
        ),
        (
            "A concise summary of the document.",
            "A concise summary of the document.",
        ),
        (
            "<THOUGHT>inner [brackets]</THOUGHT>Clean answer.",
            "Clean answer.",
        ),
    ],
)
def test_strip_reasoning_blocks(raw: str, expected: str) -> None:
    assert strip_reasoning_blocks(raw) == expected
