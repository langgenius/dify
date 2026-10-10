"""Split inline ``<think>`` reasoning out of model output.

Reasoning models (DeepSeek, Qwen, GLM, ...) wrap chain-of-thought in
``<think>...</think>`` inside the assistant message content. Workflow LLM nodes
already separate that text through the node-level ``reasoning_format`` setting,
and ``graphon.nodes.llm.reasoning`` owns the tag parsing itself.

Easy-UI applications (chat, completion and agent) have no such setting: the
provider output is streamed straight into the user-visible answer. This module
adds the splitter used by the easy-UI task pipeline so the answer stays clean and
the reasoning is emitted on its own channel.
"""

from graphon.nodes.llm.reasoning import ThinkStreamFilter, split_reasoning

# DeepSeek's official plugin concatenates this marker with the reasoning text to
# let its own parser recover it later. It is an implementation detail of that
# plugin and must not reach clients.
_PROVIDER_MARKER = "<!--dify-deepseek-reasoning-->"

# Piece kinds returned by ``ThinkStreamFilter``.
TEXT = "text"
REASONING = "reasoning"

ThinkPiece = tuple[str, str]


def strip_provider_marker(text: str) -> str:
    """Remove the DeepSeek plugin's internal reasoning marker from ``text``."""
    return text.replace(_PROVIDER_MARKER, "")


class ThinkSplitter:
    """Chunk-boundary-safe splitter for streamed model output.

    Tags may be split across chunks (``"<thi"`` then ``"nk>"``), so callers must
    feed every delta in order and call :meth:`finalize` when the stream ends.
    """

    def __init__(self) -> None:
        self._filter = ThinkStreamFilter()

    def feed(self, text: str) -> list[ThinkPiece]:
        """Return ordered ``(kind, text)`` pieces produced by this delta."""
        return [(piece.kind, strip_provider_marker(piece.chunk)) for piece in self._filter.feed(text)]

    def finalize(self) -> list[ThinkPiece]:
        """Return whatever is still buffered once no further delta will arrive."""
        return [(piece.kind, strip_provider_marker(piece.chunk)) for piece in self._filter.finalize()]


def split_think(text: str) -> tuple[str, str]:
    """Split a buffered model result into ``(answer, reasoning)``."""
    answer, reasoning = split_reasoning(text, "separated")
    return strip_provider_marker(answer), strip_provider_marker(reasoning or "")
