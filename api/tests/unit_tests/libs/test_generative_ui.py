"""Protocol tests exercise every token boundary without a model or renderer."""

from collections.abc import Iterator
from typing import Literal

import pytest

from libs.generative_ui import (
    OpenUIContentBlock,
    OpenUIContentDelta,
    OpenUIStreamParser,
    encode_openui_update,
    extract_openui_prose,
    restore_openui_content,
)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
@pytest.mark.parametrize("chunk_size", [1, 2, 3, 5, 8, 64, 1000])
def test_protocol_separates_prose_and_ui_at_arbitrary_boundaries(newline: str, chunk_size: int) -> None:
    source = f'root = Stack([TextContent("Hello")]);{newline}'
    text = f"Summary{newline}```openui{newline}{source}```{newline}After"
    parser = OpenUIStreamParser("message")
    parts: list[str | OpenUIContentBlock] = []
    for offset in range(0, len(text), chunk_size):
        parts.extend(parser.feed(text[offset : offset + chunk_size]))
    parts.extend(parser.finish("completed"))
    assert "".join(part for part in parts if isinstance(part, str)) == f"Summary{newline}After"
    assert len(parser.blocks) == 1
    assert parser.blocks[0].source == source
    assert parser.blocks[0].status == "completed"
    assert parser.blocks[0].text_offset == len(f"Summary{newline}")
    sequences = [part.sequence for part in parts if isinstance(part, OpenUIContentBlock)]
    assert sequences == sorted(set(sequences))


@pytest.mark.parametrize("status", ["completed", "cancelled", "error"])
def test_incomplete_program_is_retained_outside_text_with_terminal_status(
    status: Literal["completed", "cancelled", "error"],
) -> None:
    parser = OpenUIStreamParser("message")
    parser.feed("Summary\n```openui\nroot = Stack([")
    result = parser.finish(status)
    assert len(result) == 1
    assert parser.blocks[0].source == "root = Stack(["
    assert parser.blocks[0].status == ("error" if status == "completed" else status)
    assert parser.finish("completed") == []


def test_closing_fence_without_trailing_newline_is_complete() -> None:
    parser = OpenUIStreamParser("message")
    parser.feed("```openui\nroot = Stack([]);\n```")
    parser.finish("completed")
    assert parser.blocks[0].source == "root = Stack([]);\n"
    assert parser.blocks[0].status == "completed"


def test_ordinary_code_and_inline_marker_remain_text() -> None:
    text = "Use ```openui inline.\n```python\nprint('x')\n```\nBackticks: ```"
    parser = OpenUIStreamParser("message")
    parts = parser.feed(text) + parser.finish("completed")
    assert "".join(part for part in parts if isinstance(part, str)) == text
    assert parser.blocks == []


@pytest.mark.parametrize("chunk_size", [1, 7, 2048])
@pytest.mark.parametrize(
    "text",
    [
        "Hello, how can I help you?",
        "I can organize and analyze business data, extract key information, and answer questions about your content.",
        "June sales were 1.44 million, up 20% from May.\nEast: 720,000; South: 480,000; North: 240,000.",
    ],
)
def test_enabled_ui_parser_streams_text_only_answers_without_ui_blocks(text: str, chunk_size: int) -> None:
    # Enabled producers use this parser even when the model chooses a text-only answer.
    parser = OpenUIStreamParser("message")
    parts: list[str | OpenUIContentBlock] = []
    for offset in range(0, len(text), chunk_size):
        parts.extend(parser.feed(text[offset : offset + chunk_size]))
    parts.extend(parser.finish("completed"))

    assert all(isinstance(part, str) for part in parts)
    assert "".join(part for part in parts if isinstance(part, str)) == text
    assert parser.blocks == []


def test_multiple_blocks_have_distinct_stable_identities() -> None:
    parser = OpenUIStreamParser("message:node")
    parser.feed("```openui\nfirst\n```\nBetween\n```openui\nsecond\n```\n")
    parser.finish("cancelled")
    assert [block.id for block in parser.blocks] == ["message:node:openui:0", "message:node:openui:1"]
    assert all(block.status == "completed" for block in parser.blocks)
    assert [block.text_offset for block in parser.blocks] == [0, len("Between\n")]


def test_wire_schema_requires_all_serialized_fields() -> None:
    schema = OpenUIContentBlock.model_json_schema()
    assert set(schema["required"]) == set(OpenUIContentBlock.model_fields)
    assert OpenUIContentBlock(id="block").model_dump()["form_state"] == {}


def test_text_processor_envelope_keeps_ui_out_of_replacement_prose() -> None:
    transport = 'Summary\n```openui\nroot = TextContent("redacted");\n```\n'
    assert extract_openui_prose(transport) == "Summary\n"
    assert extract_openui_prose("Summary\n```openui\nroot = TextContent(") == "Summary\n"


@pytest.mark.parametrize("chunk_size", [1, 20, 4096])
def test_stream_deltas_reconstruct_multiple_blocks_with_linear_source_payload(chunk_size: int) -> None:
    source = 'root = Stack([details])\ndetails = Text("' + "Data \u00e9" * 1250 + '")\n'
    text = f"Summary\n```openui\n{source}```\nBetween\n```openui\n{source}```"
    parser = OpenUIStreamParser("message")
    stored: dict[str, OpenUIContentBlock] = {}
    received: dict[str, OpenUIContentBlock] = {}
    source_bytes_sent = 0
    deltas = 0

    def chunks() -> Iterator[str | OpenUIContentBlock]:
        for offset in range(0, len(text), chunk_size):
            yield from parser.feed(text[offset : offset + chunk_size])
        yield from parser.finish("completed")

    for part in chunks():
        if isinstance(part, str):
            continue
        update = encode_openui_update(part, stored.get(part.id))
        stored[part.id] = part
        if isinstance(update, OpenUIContentDelta):
            deltas += 1
            previous = received[update.id]
            assert update.base_sequence == previous.sequence
            assert update.sequence > previous.sequence
            source_bytes_sent += len(update.source_delta.encode())
            received[update.id] = previous.model_copy(
                update={"source": previous.source + update.source_delta, "sequence": update.sequence}
            )
        else:
            source_bytes_sent += len(update.source.encode())
            if update.id in received:
                assert update.status == "completed"
                assert update.source.startswith(received[update.id].source)
            received[update.id] = update

    assert deltas > 0
    assert list(received.values()) == parser.blocks
    assert [block.source for block in received.values()] == [source, source]
    assert all(block.status == "completed" for block in received.values())
    # Incremental content plus final snapshots send each source at most twice,
    # independent of token count. Count UTF-8 bytes, not Python characters.
    assert source_bytes_sent <= 2 * sum(len(block.source.encode()) for block in parser.blocks)


@pytest.mark.parametrize("status", ["completed", "cancelled", "error"])
def test_stream_termination_always_contains_a_complete_authoritative_snapshot(
    status: Literal["completed", "cancelled", "error"],
) -> None:
    parser = OpenUIStreamParser("message")
    parser.feed('```openui\nroot = Stack([Text("Hello")])\n```')
    previous = parser.blocks[0]

    parser.finish(status)
    update = encode_openui_update(parser.blocks[0], previous)

    assert isinstance(update, OpenUIContentBlock)
    assert update.source == previous.source
    assert update.status == status
    assert update.sequence > previous.sequence


def test_authoritative_replay_replaces_live_source_before_resuming_deltas() -> None:
    live = OpenUIContentBlock(id="block", source='root = Text("Draft")', sequence=5)
    replay = live.model_copy(update={"source": "root = Stack([", "sequence": 6})
    assert encode_openui_update(replay, live) == replay

    appended = replay.model_copy(update={"source": replay.source + "title])", "sequence": 8})
    delta = encode_openui_update(appended, replay)
    assert delta == OpenUIContentDelta(id="block", sequence=8, base_sequence=6, source_delta="title])")


@pytest.mark.parametrize("chunk_size", [1, 7, 2048])
def test_offsets_retain_interleaved_unicode_prose_and_adjacent_blocks(chunk_size: int) -> None:
    first = 'root = Stack([Text("first")])\n'
    second = 'root = Stack([Text("second")])\n'
    text = f"Summary \U00020000\n```openui\n{first}```\nNext\n```openui\n{second}```\n```openui\n{first}```\nEnd"
    parser = OpenUIStreamParser("message")
    parts: list[str | OpenUIContentBlock] = []
    for offset in range(0, len(text), chunk_size):
        parts.extend(parser.feed(text[offset : offset + chunk_size]))
    parts.extend(parser.finish("completed"))

    prose = "".join(part for part in parts if isinstance(part, str))
    assert prose == "Summary \U00020000\nNext\nEnd"
    assert [block.text_offset for block in parser.blocks] == [10, 15, 15]
    restored = restore_openui_content(prose, parser.blocks)
    assert restored.index("Summary") < restored.index('Text("first")') < restored.index("Next")
    assert restored.index("Next") < restored.index('Text("second")') < restored.rindex('Text("first")')
    assert restored.rindex('Text("first")') < restored.index("End")


def test_changed_offset_in_authoritative_replay_requires_snapshot() -> None:
    live = OpenUIContentBlock(id="block", source="root = Stack([", sequence=2, text_offset=3)
    replay = live.model_copy(update={"source": 'root = Stack([Text("Final")])', "sequence": 3, "text_offset": 8})
    assert encode_openui_update(replay, live) == replay


def test_memory_projection_does_not_include_form_drafts_or_protocol_metadata() -> None:
    source = 'root = Stack([Table("Regions", ["Region", "Sales"], [["East", "72"]])])'
    block = OpenUIContentBlock(
        id="block-secret-id", source=source, status="completed", text_offset=7, form_state={"draft": "private text"}
    )
    assert restore_openui_content("HighestNext", [block]) == f"Highest\n```openui\n{source}\n```\nNext"
