import logging
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

from configs import dify_config
from core.moderation.base import ModerationAction, ModerationOutputsResult
from core.moderation.factory import ModerationFactory

logger = logging.getLogger(__name__)


class ModerationRule(BaseModel):
    type: str
    config: dict[str, Any]


class OutputModeration(BaseModel):
    """Own sequential app output checks on the response consumer, without a worker or locks.

    Stream checks inspect only new segments; completion checks only an unchecked
    tail. Keyword/API replacement behavior remains independent of platform model
    moderation. Evaluation failures are terminal and never retried by completion.
    """

    tenant_id: str
    app_id: str
    rule: ModerationRule
    buffer: str = ""
    final_output: str | None = None
    output_evaluator: Callable[[str], ModerationOutputsResult | None] | None = Field(
        default=None,
        exclude=True,
        repr=False,
        description="Injected app use case; None retains the independent legacy backend",
    )
    model_config = ConfigDict(arbitrary_types_allowed=True)
    _answer: str = PrivateAttr(default="")
    _checked_length: int = PrivateAttr(default=0)
    _streamed: bool = PrivateAttr(default=False)
    _finished: bool = PrivateAttr(default=False)
    _error: Exception | None = PrivateAttr(default=None)

    def should_direct_output(self) -> bool:
        """Return whether a checked segment replaced the entire answer and stopped further evaluation."""
        return self.final_output is not None

    def get_final_output(self) -> str:
        """Return the direct reply, or an empty string before any direct replacement."""
        return self.final_output or ""

    def append_new_token(self, token: str, *, prefix: str = "") -> str | None:
        """Inspect new stream text at the threshold and return a full replacement only when flagged.

        The response consumer is the sole caller. A prefix seeds an existing
        response after resumption. Stopped output is ignored; failed checks raise
        the original latched error without backend retry.
        """
        if self._error is not None:
            raise self._error
        if self._finished or self.should_direct_output():
            return None
        if not self._streamed:
            self._streamed = True
            self.buffer = prefix
            self._answer = prefix
            self._checked_length = len(prefix)
        self.buffer += token
        self._answer += token
        pending = self.buffer[self._checked_length :]
        if len(pending) >= dify_config.MODERATION_BUFFER_SIZE:
            return self._check_pending(pending)
        return None

    def _check_pending(self, text: str) -> str | None:
        """Check one nonempty new segment, retaining its replacement and advancing only after success."""
        result = self.moderation(self.tenant_id, self.app_id, text)
        self._checked_length += len(text)
        if result is None or not result.flagged:
            return None
        if result.action == ModerationAction.DIRECT_OUTPUT:
            self.final_output = result.preset_response
            self._answer = result.preset_response
        else:
            self._answer = self._answer[: -len(text)] + result.text
        return self._answer

    def moderation_completion(self, completion: str) -> tuple[str, bool]:
        """Finish on the response consumer without rechecking already processed stream content.

        Blocking results use independent non-stream segments. A changed final
        result is new content and must be checked; unchanged streams check only
        their remaining tail. Repeated completion never performs moderation I/O.
        """
        if self._error is not None:
            raise self._error
        if self.should_direct_output():
            return self.get_final_output(), True
        if self._finished:
            return self._answer, self._answer != completion
        if self._streamed and completion not in {self.buffer, self._answer}:
            if completion.startswith(self.buffer):
                suffix = completion[len(self.buffer) :]
                self.buffer += suffix
                self._answer += suffix
            else:
                self._streamed = False
        if self._streamed:
            pending = self.buffer[self._checked_length :]
            replacement = self._check_pending(pending) if pending else None
            flagged = replacement is not None
        else:
            self.buffer = completion
            self._answer = ""
            self._checked_length = 0
            size = dify_config.MODERATION_NON_STREAM_SEGMENT_SIZE
            flagged = False
            while self._checked_length < len(completion) and not self.should_direct_output():
                segment = completion[self._checked_length : self._checked_length + size]
                self._answer += segment
                replacement = self._check_pending(segment)
                flagged = flagged or replacement is not None
        self._finished = True
        return self._answer, flagged or self._answer != completion

    def moderation(self, tenant_id: str, app_id: str, moderation_buffer: str) -> ModerationOutputsResult | None:
        """Evaluate once on the response consumer; injected failures stay terminal without exposing diagnostics."""
        if self._error is not None:
            raise self._error
        if self.output_evaluator is not None:
            try:
                return self.output_evaluator(moderation_buffer)
            except Exception as error:
                self._error = error
                raise
        try:
            backend = ModerationFactory(self.rule.type, app_id, tenant_id, self.rule.config)
            return backend.moderation_for_outputs(moderation_buffer)
        except Exception:
            logger.exception("Moderation Output error, app_id: %s", app_id)
        return None
