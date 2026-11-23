"""OpenUI message content contracts and incremental model-output separation.

Only explicitly enabled producers use this parser. ``<dify_ui>...</dify_ui>`` tags
are a model transport envelope; stored prose and UI segments share an ordered
``parts`` sequence without relying on fragile character offsets.
"""

from collections.abc import Sequence
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter
from pydantic.json_schema import JsonSchemaValue

OPENUI_LIBRARY_VERSION = "dify-ui-v1"
OPENUI_TAG_OPEN = "<dify_ui>"
OPENUI_TAG_CLOSE = "</dify_ui>"


class OpenUIContentStatus(StrEnum):
    STREAMING = "streaming"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ERROR = "error"


class GenerativeUIConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False


def _openui_snapshot_schema(schema: JsonSchemaValue) -> None:
    """Describe complete wire snapshots without publishing construction defaults.

    Preconditions: ``schema`` contains a ``properties`` mapping emitted by Pydantic.
    Postconditions: every property is marked required and default annotations are stripped.
    """
    properties = schema["properties"]
    schema["required"] = list(properties)
    for field_schema in properties.values():
        field_schema.pop("default", None)


class TextContentPart(BaseModel):
    """An ordered prose segment persisted alongside UI blocks in ``metadata.parts``."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        json_schema_extra=_openui_snapshot_schema,
    )

    id: str
    type: Literal["text"] = "text"
    text: str = ""


class OpenUIContentBlock(BaseModel):
    """An immutable snapshot of a single generative UI part."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        json_schema_extra=_openui_snapshot_schema,
    )

    id: str
    type: Literal["openui"] = "openui"
    library_version: Literal["dify-ui-v1"] = OPENUI_LIBRARY_VERSION
    source: str = ""
    status: OpenUIContentStatus = OpenUIContentStatus.STREAMING
    sequence: int = Field(default=0, ge=0)
    form_state: dict[str, JsonValue] = Field(default_factory=dict)


type MessageContentPart = Annotated[TextContentPart | OpenUIContentBlock, Field(discriminator="type")]

_CONTENT_PARTS_ADAPTER: TypeAdapter[list[MessageContentPart]] = TypeAdapter(list[MessageContentPart])


class OpenUIContentDelta(BaseModel):
    """Append-only transport update; persisted content always uses full parts."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    type: Literal["openui_delta"] = "openui_delta"
    sequence: int = Field(ge=0)
    base_sequence: int = Field(ge=0)
    source_delta: str


def parse_content_parts(raw_parts: object) -> list[MessageContentPart]:
    """Validate a persisted or incoming sequence of ordered message content parts.

    Preconditions: ``raw_parts`` is a sequence of JSON-compatible dicts or part models.
    Postconditions: returns a new list of validated ``MessageContentPart`` instances;
    raises ``ValidationError`` if any element violates the part contract.
    """
    return _CONTENT_PARTS_ADAPTER.validate_python(raw_parts)


def append_text_part(parts: list[MessageContentPart], text: str, *, identity: str) -> None:
    """Append prose to the trailing text part or create a new text part in order.

    Preconditions: ``parts`` is a mutable list of ordered message parts and ``identity``
    uniquely scopes generated part IDs within a message.
    Postconditions: empty ``text`` leaves ``parts`` unchanged; non-empty ``text`` is
    appended to the trailing ``TextContentPart`` or inserted as a new trailing part.
    """
    if not text:
        return
    if parts and isinstance(parts[-1], TextContentPart):
        parts[-1] = parts[-1].model_copy(update={"text": parts[-1].text + text})
        return
    parts.append(TextContentPart(id=f"{identity}:text:{len(parts)}", text=text))


def upsert_openui_part(parts: list[MessageContentPart], block: OpenUIContentBlock) -> OpenUIContentBlock | None:
    """Update an existing UI part in place or append a new UI part to ``parts``.

    Preconditions: ``parts`` contains at most one ``OpenUIContentBlock`` per ``id``.
    Postconditions: ``parts`` contains ``block`` at its original position (if previously
    present) or at the end (if new); returns the prior snapshot or ``None``.
    """
    for index, current in enumerate(parts):
        if isinstance(current, OpenUIContentBlock) and current.id == block.id:
            parts[index] = block
            return current
    parts.append(block)
    return None


def openui_blocks(parts: Sequence[MessageContentPart]) -> list[OpenUIContentBlock]:
    """Return all ``OpenUIContentBlock`` items from ``parts`` in reading order."""
    return [part for part in parts if isinstance(part, OpenUIContentBlock)]


def has_openui_parts(parts: Sequence[MessageContentPart]) -> bool:
    """Return whether ``parts`` contains at least one ``OpenUIContentBlock``."""
    return any(isinstance(part, OpenUIContentBlock) for part in parts)


def extract_parts_text(parts: Sequence[MessageContentPart]) -> str:
    """Project an ordered ``parts`` sequence into plain prose text."""
    return "".join(part.text for part in parts if isinstance(part, TextContentPart))


def encode_openui_update(
    block: OpenUIContentBlock, previous: OpenUIContentBlock | None
) -> OpenUIContentBlock | OpenUIContentDelta:
    """Send appended source once, with snapshots for initialization, replay, and termination.

    Preconditions: ``previous`` is the last emitted snapshot for ``block.id`` or ``None``.
    Postconditions: emits an ``OpenUIContentDelta`` only when both snapshots are streaming
    and ``block.source`` strictly extends ``previous.source``; otherwise emits ``block``.
    """
    if (
        previous is None
        or block.status != OpenUIContentStatus.STREAMING
        or previous.status != OpenUIContentStatus.STREAMING
        or not block.source.startswith(previous.source)
    ):
        return block
    return OpenUIContentDelta(
        id=block.id,
        sequence=block.sequence,
        base_sequence=previous.sequence,
        source_delta=block.source[len(previous.source) :],
    )


def generative_ui_enabled(config: object) -> bool:
    """Return whether a feature config explicitly enables Generative UI."""
    if config is None:
        return False
    return GenerativeUIConfig.model_validate(config).enabled


def extract_openui_prose(text: str) -> str:
    """Drop ``<dify_ui>...</dify_ui>`` programs, including incomplete ones, from model text.

    Preconditions: ``text`` is raw model output or moderation replacement text.
    Postconditions: returns concatenated plain prose with all UI blocks removed.
    """
    parser = OpenUIStreamParser("text")
    return "".join(
        part for part in [*parser.feed(text), *parser.finish(OpenUIContentStatus.COMPLETED)] if isinstance(part, str)
    )


def restore_openui_parts(parts: Sequence[MessageContentPart]) -> str:
    """Recombine ordered prose and completed UI parts in their original reading order.

    Preconditions: ``parts`` is an ordered sequence of ``MessageContentPart`` items.
    Postconditions: completed UI blocks are emitted inside ``<dify_ui>...</dify_ui>``
    tags without user-entered ``form_state``; incomplete/cancelled/error blocks are omitted.
    """
    segments: list[str] = []
    for part in parts:
        if isinstance(part, TextContentPart):
            segments.append(part.text)
        elif part.status == OpenUIContentStatus.COMPLETED:
            segments.append(f"\n{OPENUI_TAG_OPEN}\n{part.source.rstrip()}\n{OPENUI_TAG_CLOSE}\n")
    return "".join(segments)


def _suffix_prefix_length(text: str, marker: str) -> int:
    """Return the longest suffix length of ``text`` that is a proper prefix of ``marker``.

    Preconditions: ``marker`` is non-empty.
    Postconditions: returns ``k`` in ``0 <= k < len(marker)`` such that
    ``text.endswith(marker[:k])`` and no larger ``k`` satisfies that condition.
    """
    max_len = min(len(text), len(marker) - 1)
    for length in range(max_len, 0, -1):
        if text.endswith(marker[:length]):
            return length
    return 0


class OpenUIStreamParser:
    """Separate ``<dify_ui>...</dify_ui>`` blocks across arbitrary token boundaries.

    Invariant: partial prefixes of ``<dify_ui>`` (at line start in prose mode) and
    ``</dify_ui>`` (anywhere inside an active UI block) are buffered in ``_pending``
    until disambiguated, so protocol tags never flicker in user-visible prose or UI
    source. Snapshots are immutable and strictly ordered per block.
    """

    def __init__(self, identity: str) -> None:
        self._identity = identity
        self._pending = ""
        self._line_start = True
        self._consume_closing_newline = False
        self._active: OpenUIContentBlock | None = None
        self._blocks: list[OpenUIContentBlock] = []
        self._parts: list[MessageContentPart] = []

    @property
    def blocks(self) -> list[OpenUIContentBlock]:
        return list(self._blocks)

    @property
    def parts(self) -> list[MessageContentPart]:
        return list(self._parts)

    def feed(self, text: str) -> list[str | OpenUIContentBlock]:
        """Consume the next model text chunk and emit safe prose and UI snapshots.

        Preconditions: ``text`` is an arbitrary UTF-8 string slice from the model stream.
        Postconditions: returns coalesced prose strings and updated ``OpenUIContentBlock``
        snapshots; any ambiguous tag prefix remains buffered in ``_pending``.
        """
        self._pending += text
        output: list[str | OpenUIContentBlock] = []
        can_advance = bool(self._pending)
        while can_advance:
            if self._active is not None:
                can_advance = self._advance_ui(output)
            elif self._consume_closing_newline:
                can_advance = self._advance_closing_newline()
            else:
                can_advance = self._advance_prose(output)
        return self._coalesce(output)

    def finish(self, status: OpenUIContentStatus) -> list[str | OpenUIContentBlock]:
        """Flush buffered prose or close an unfinished UI block with a terminal status.

        Preconditions: ``status`` is a terminal ``OpenUIContentStatus`` (or caller status).
        Postconditions: clears ``_pending`` and ``_active`` so subsequent calls return ``[]``.
        Completing a stream with an unclosed ``<dify_ui>`` block records ``ERROR``.
        """
        output: list[str | OpenUIContentBlock] = []
        if self._active is not None:
            terminal = OpenUIContentStatus.ERROR if status == OpenUIContentStatus.COMPLETED else status
            updated = self._update(source=self._active.source + self._pending, status=terminal)
            output.append(updated)
            self._active = None
        elif self._consume_closing_newline:
            self._consume_closing_newline = False
            if self._pending and self._pending not in {"\r", "\n", "\r\n"}:
                append_text_part(self._parts, self._pending, identity=self._identity)
                output.append(self._pending)
        elif self._pending:
            append_text_part(self._parts, self._pending, identity=self._identity)
            output.append(self._pending)
        self._pending = ""
        return output

    def _advance_ui(self, output: list[str | OpenUIContentBlock]) -> bool:
        assert self._active is not None
        close_index = self._pending.find(OPENUI_TAG_CLOSE)
        if close_index != -1:
            before_close = self._pending[:close_index]
            self._pending = self._pending[close_index + len(OPENUI_TAG_CLOSE) :]
            updated = self._update(
                source=self._active.source + before_close,
                status=OpenUIContentStatus.COMPLETED,
            )
            output.append(updated)
            self._active = None
            self._consume_closing_newline = True
            self._line_start = True
            return bool(self._pending)

        hold = _suffix_prefix_length(self._pending, OPENUI_TAG_CLOSE)
        flush_len = len(self._pending) - hold
        if flush_len > 0:
            part = self._pending[:flush_len]
            self._pending = self._pending[flush_len:]
            output.append(self._update(source=self._active.source + part))
        return False

    def _advance_closing_newline(self) -> bool:
        if self._pending == "\r":
            return False
        if self._pending.startswith("\r\n"):
            self._pending = self._pending[2:]
            self._line_start = True
        elif self._pending.startswith("\n"):
            self._pending = self._pending[1:]
            self._line_start = True
        self._consume_closing_newline = False
        return bool(self._pending)

    def _advance_prose(self, output: list[str | OpenUIContentBlock]) -> bool:
        if self._line_start and (OPENUI_TAG_OPEN.startswith(self._pending) or self._pending == OPENUI_TAG_OPEN + "\r"):
            return False
        if self._line_start and (
            self._pending.startswith(OPENUI_TAG_OPEN + "\n") or self._pending.startswith(OPENUI_TAG_OPEN + "\r\n")
        ):
            newline_size = 2 if self._pending.startswith(OPENUI_TAG_OPEN + "\r\n") else 1
            self._pending = self._pending[len(OPENUI_TAG_OPEN) + newline_size :]
            self._active = OpenUIContentBlock(id=f"{self._identity}:openui:{len(self._blocks)}")
            self._blocks.append(self._active)
            self._parts.append(self._active)
            output.append(self._active)
            return bool(self._pending)

        newline = self._pending.find("\n")
        size = len(self._pending) if newline == -1 else newline + 1
        part, self._pending = self._pending[:size], self._pending[size:]
        self._line_start = newline != -1
        append_text_part(self._parts, part, identity=self._identity)
        output.append(part)
        return bool(self._pending)

    def _update(
        self, *, source: str | None = None, status: OpenUIContentStatus = OpenUIContentStatus.STREAMING
    ) -> OpenUIContentBlock:
        assert self._active is not None
        self._active = self._active.model_copy(
            update={
                "source": self._active.source if source is None else source,
                "status": status,
                "sequence": self._active.sequence + 1,
            }
        )
        self._blocks[-1] = self._active
        upsert_openui_part(self._parts, self._active)
        return self._active

    @staticmethod
    def _coalesce(parts: list[str | OpenUIContentBlock]) -> list[str | OpenUIContentBlock]:
        output: list[str | OpenUIContentBlock] = []
        for part in parts:
            if (
                output
                and isinstance(part, OpenUIContentBlock)
                and isinstance(output[-1], OpenUIContentBlock)
                and output[-1].id == part.id
            ):
                output[-1] = part
            elif output and isinstance(part, str) and isinstance(output[-1], str):
                output[-1] += part
            else:
                output.append(part)
        return output
