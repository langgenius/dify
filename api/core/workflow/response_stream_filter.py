"""Dify response stream filter.

Extends graphon's ``ResponseStreamFilter`` with the fallback for
non-streamed variables (langgenius/dify#46034, same underlying failure as
#44141).

Upstream graphon (pinned rev ``4fa2214``) treats a lone empty final chunk
(``chunk=""``, ``is_final=True``) as the complete content of a variable
segment: ``_process_variable_segment`` only falls back to the variable pool
when the segment produced no stream events at all. A non-streamed variable
(e.g. a Workflow-as-Tool output with ``stream=false``) arrives as exactly
one such empty final marker, so the pool fallback is skipped, the Answer
node streams nothing for that segment, and the chat-messages SSE response
is empty even though the workflow run record holds the correct value.

This subclass keeps graphon's behavior except for that one case: when a
closed variable stream emitted no content, the value is read from the
variable pool and emitted as the segment's chunk. Streamed variables and
genuinely empty values are unaffected.
"""

from typing import override

from graphon.engine.filter import ResponseStreamFilter
from graphon.engine_events import NodeRunStreamChunkEvent
from graphon.nodes.base.template import VariableSegment


class DifyResponseStreamFilter(ResponseStreamFilter):
    """Response stream filter with the non-streamed variable fallback.

    Preconditions: the filter is initialized (``initialize`` has run) and
    the segment belongs to the active response session's template, same as
    the upstream method.

    Postconditions: identical to ``ResponseStreamFilter`` except that a
    variable segment whose closed stream carried no content additionally
    emits one chunk event holding the variable pool value (when the pool
    holds a non-empty value for the selector). The session still completes
    exactly when upstream would complete it.
    """

    @override
    def _process_variable_segment(self, segment: VariableSegment) -> tuple[list[NodeRunStreamChunkEvent], bool]:
        """Complete a variable segment, falling back to the pool value when nothing streamed.

        Preconditions:
            - The parent has classified the segment the same way it would on its own;
              this override only adds the pool-value fallback on top of its result.
            - The segment's variable value is already present in the variable pool
              (the producing node completed before this segment is processed).

        Postconditions:
            - If the segment completed and no content was ever streamed for its
              selector, exactly one extra chunk carrying the pool value is appended.
            - If any content was streamed for the selector, the result is unchanged.

        The parent processes a segment across several calls: each call pops and
        returns only the events buffered since the previous call, and the segment
        completes on the call that sees the stream close. A variable that streamed
        content therefore looks empty on its completing call, so this method must
        consult the full buffered history for the selector instead of only the
        events returned by this call. The buffer keeps every event it ever received
        (``pop`` only advances a read position), so that history is authoritative.

        The fallback also runs only for a stream that actually closed. When the
        stream is still open and nothing has streamed yet, the parent already
        emits the pool value itself; appending here would duplicate it. A
        completed segment is never processed again (``_try_flush`` advances past
        it once ``is_complete`` is True), so the fallback fires at most once.
        """
        events, is_complete = super()._process_variable_segment(segment)
        if not is_complete or not events:
            return events, is_complete

        if not self._stream_buffers.is_closed(segment.selector):
            return events, is_complete

        buffered_events = self._stream_buffers.events.get(tuple(segment.selector), [])
        if any(event.chunk for event in buffered_events):
            return events, is_complete

        value = self._bound_runtime_state.variable_pool.get(segment.selector)
        if value is None or not value.markdown:
            return events, is_complete

        source_selector_prefix = segment.selector[0] if segment.selector else ""
        is_special_selector = source_selector_prefix not in self._bound_graph.nodes
        if self._active_session and is_special_selector:
            output_node_id = self._active_session.node_id
        else:
            output_node_id = source_selector_prefix
        is_last_segment = bool(
            self._active_session and self._active_session.index == len(self._active_session.template.segments) - 1,
        )
        events.append(
            self._create_stream_chunk_event(
                node_id=output_node_id,
                execution_id=self._get_or_create_execution_id(output_node_id),
                selector=segment.selector,
                chunk=value.markdown,
                is_final=is_last_segment,
            )
        )
        return events, is_complete
