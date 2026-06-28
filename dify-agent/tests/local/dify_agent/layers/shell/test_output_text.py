from dify_agent.layers.shell.output_text import normalized_output_text, utf8_prefix, utf8_suffix


def test_normalized_output_text_includes_marker_and_log_guidance() -> None:
    assert normalized_output_text(
        "head",
        tail="tail",
        output_path="/tmp/output.log",
        max_output_size_bytes=16,
    ) == (
        "head\n"
        "... (truncated in middle because the max output size is limited to 16 bytes) ...\n"
        "tail\n"
        "(check the /tmp/output.log for full output)"
    )


def test_normalized_output_text_avoids_duplicate_tail_for_short_output() -> None:
    assert normalized_output_text(
        "short output",
        tail="short output",
        output_path="/tmp/output.log",
        max_output_size_bytes=16,
    ) == "short output"


def test_normalized_output_text_can_force_middle_truncation_when_head_matches_tail() -> None:
    assert normalized_output_text(
        "repeat",
        tail="repeat",
        output_path="/tmp/output.log",
        max_output_size_bytes=16,
        truncated_in_middle=True,
    ) == (
        "repeat\n"
        "... (truncated in middle because the max output size is limited to 16 bytes) ...\n"
        "repeat\n"
        "(check the /tmp/output.log for full output)"
    )


def test_utf8_helpers_do_not_split_multibyte_characters() -> None:
    text = "A🙂B"

    assert utf8_prefix(text, 1) == "A"
    assert utf8_prefix(text, 2) == "A"
    assert utf8_prefix(text, 5) == "A🙂"
    assert utf8_suffix(text, 1) == "B"
    assert utf8_suffix(text, 2) == "B"
    assert utf8_suffix(text, 5) == "🙂B"


def test_normalized_output_text_omits_log_guidance_without_output_path() -> None:
    assert normalized_output_text(
        "head",
        tail="tail",
        output_path=None,
        max_output_size_bytes=16,
    ) == (
        "head\n"
        "... (truncated in middle because the max output size is limited to 16 bytes) ...\n"
        "tail"
    )


def test_normalized_output_text_can_use_custom_truncation_message() -> None:
    assert normalized_output_text(
        "head",
        tail="tail",
        output_path="/tmp/output.log",
        max_output_size_bytes=16,
        truncation_message="command timed out before full output was captured",
    ) == (
        "head\n"
        "... (command timed out before full output was captured) ...\n"
        "tail\n"
        "(check the /tmp/output.log for full output)"
    )
