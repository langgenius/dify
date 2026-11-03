"""OpenUI message content contracts and incremental model-output separation.

Only explicitly enabled producers use this parser. Fences are a model transport
envelope; stored UI and user-visible prose have separate message channels.
"""

from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

OPENUI_LIBRARY_VERSION = "dify-ui-v1"

type OpenUIContentStatus = Literal["streaming", "completed", "cancelled", "error"]


class GenerativeUIConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False


class OpenUIContentBlock(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        json_schema_extra={
            "required": ["id", "type", "library_version", "source", "status", "sequence", "text_offset", "form_state"]
        },
    )

    id: str
    type: Literal["openui"] = "openui"
    library_version: Literal["dify-ui-v1"] = OPENUI_LIBRARY_VERSION
    source: str = ""
    status: OpenUIContentStatus = "streaming"
    sequence: int = Field(default=0, ge=0)
    text_offset: int = Field(
        default=0,
        ge=0,
        description="Position in the prose answer before this block, measured in Unicode code points.",
    )
    form_state: dict[str, JsonValue] = Field(default_factory=dict)


class OpenUIContentDelta(BaseModel):
    """Append-only transport update; persisted content always uses a full block."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    type: Literal["openui_delta"] = "openui_delta"
    sequence: int = Field(ge=0)
    base_sequence: int = Field(ge=0)
    source_delta: str


def encode_openui_update(
    block: OpenUIContentBlock, previous: OpenUIContentBlock | None
) -> OpenUIContentBlock | OpenUIContentDelta:
    """Send appended source once, with snapshots for initialization and termination.

    ``previous`` is the last emitted block, or None for a new block. Agent final
    replay can replace live source, so non-append updates also need a snapshot.
    """
    if (
        previous is None
        or block.status != "streaming"
        or previous.status != "streaming"
        or block.text_offset != previous.text_offset
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
    if config is None:
        return False
    return GenerativeUIConfig.model_validate(config).enabled


def extract_openui_prose(text: str) -> str:
    """Drop UI programs, including incomplete ones, from transformed model text."""
    parser = OpenUIStreamParser("text")
    return "".join(part for part in [*parser.feed(text), *parser.finish("completed")] if isinstance(part, str))


def restore_openui_content(text: str, blocks: Sequence[OpenUIContentBlock]) -> str:
    """Recombine separate text and UI channels in their original reading order.

    The source is the original assistant content, not user-entered form state.
    Callers select which block statuses belong in their projection.
    """
    parts: list[str] = []
    offset = 0
    for block in sorted(blocks, key=lambda block: block.text_offset):
        parts.extend((text[offset : block.text_offset], f"\n```openui\n{block.source.rstrip()}\n```\n"))
        offset = block.text_offset
    parts.append(text[offset:])
    return "".join(parts)


class OpenUIStreamParser:
    """Separate fenced OpenUI across arbitrary token boundaries.

    A fence must occupy its own line. Partial fence prefixes are held back until
    they are distinguishable from prose/source, so protocol markers never flash
    in a user-visible answer. Snapshots are immutable and ordered per block.
    """

    def __init__(self, identity: str) -> None:
        self._identity = identity
        self._pending = ""
        self._line_start = True
        self._text_offset = 0
        self._active: OpenUIContentBlock | None = None
        self._blocks: list[OpenUIContentBlock] = []

    @property
    def blocks(self) -> list[OpenUIContentBlock]:
        return list(self._blocks)

    def feed(self, text: str) -> list[str | OpenUIContentBlock]:
        self._pending += text
        output: list[str | OpenUIContentBlock] = []
        while self._pending:
            marker = "```" if self._active else "```openui"
            if self._line_start:
                if marker.startswith(self._pending) or self._pending == marker + "\r":
                    break
                if self._pending.startswith(marker + "\n") or self._pending.startswith(marker + "\r\n"):
                    newline_size = 2 if self._pending.startswith(marker + "\r\n") else 1
                    self._pending = self._pending[len(marker) + newline_size :]
                    if self._active:
                        output.append(self._update(status="completed"))
                        self._active = None
                    else:
                        self._active = OpenUIContentBlock(
                            id=f"{self._identity}:openui:{len(self._blocks)}", text_offset=self._text_offset
                        )
                        self._blocks.append(self._active)
                        output.append(self._active)
                    continue
            newline = self._pending.find("\n")
            size = len(self._pending) if newline == -1 else newline + 1
            part, self._pending = self._pending[:size], self._pending[size:]
            self._line_start = newline != -1
            if self._active:
                output.append(self._update(source=self._active.source + part))
            else:
                output.append(part)
                self._text_offset += len(part)
        return self._coalesce(output)

    def finish(self, status: Literal["completed", "cancelled", "error"]) -> list[str | OpenUIContentBlock]:
        output: list[str | OpenUIContentBlock] = []
        if self._active:
            closed = self._line_start and self._pending in {"```", "```\r"}
            source = self._active.source + ("" if closed else self._pending)
            terminal = "completed" if closed and status == "completed" else status
            if not closed and status == "completed":
                terminal = "error"
            output.append(self._update(source=source, status=terminal))
            self._active = None
        elif self._pending:
            output.append(self._pending)
            self._text_offset += len(self._pending)
        self._pending = ""
        return output

    def _update(self, *, source: str | None = None, status: OpenUIContentStatus = "streaming") -> OpenUIContentBlock:
        assert self._active is not None
        self._active = self._active.model_copy(
            update={
                "source": self._active.source if source is None else source,
                "status": status,
                "sequence": self._active.sequence + 1,
            }
        )
        self._blocks[-1] = self._active
        return self._active

    @staticmethod
    def _coalesce(parts: list[str | OpenUIContentBlock]) -> list[str | OpenUIContentBlock]:
        output: list[str | OpenUIContentBlock] = []
        for part in parts:
            if output and isinstance(part, OpenUIContentBlock) and isinstance(output[-1], OpenUIContentBlock):
                if output[-1].id == part.id:
                    output[-1] = part
                    continue
            if output and isinstance(part, str) and isinstance(output[-1], str):
                output[-1] += part
            else:
                output.append(part)
        return output
