"""Inspector pub/sub fanout for live workflow run updates (Stage 4 §8.5).

The Node Output Inspector exposes a Server-Sent Events stream alongside its
three REST endpoints so the frontend can render per-output progress without
DB polling. This module owns the redis pub/sub channel that connects the two
sides:

* :func:`publish_node_changed` / :func:`publish_workflow_completed` —
  invoked by :class:`core.app.workflow.layers.persistence.WorkflowPersistenceLayer`
  at the very end of each handler, after the DB write has already
  succeeded. Publish failures are swallowed so the engine never trips on a
  flaky redis connection.
* :func:`subscribe` — async iterator the SSE endpoint consumes.

Channel layout
--------------
``dify:inspector:workflow_run:{workflow_run_id}``

One channel per workflow run; the SSE endpoint subscribes for the lifetime of
the run and unsubscribes on the terminal event. Multiple clients can attach
to the same run safely — redis pub/sub fans every message out to every
listener.

The message envelope intentionally carries only the *delta* needed to invalidate
a slice of the inspector view; the SSE handler re-reads the canonical
``WorkflowNodeExecutionModel`` row from the DB so we never serialize stale
state across the wire. This means messages stay tiny (~150 bytes) and the
inspector view stays consistent even if a publisher races persistence.

Decision D-5: the on-wire SSE envelope ``{event, data, id}`` is shared with
the babysit chat stream; this module only emits the *internal* pub/sub
message — the SSE controller turns it into the public envelope.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from dataclasses import asdict, dataclass
from typing import Final, Literal

from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Channel naming
# ──────────────────────────────────────────────────────────────────────────────


_CHANNEL_PREFIX: Final = "dify:inspector:workflow_run"


def channel_for(workflow_run_id: str) -> str:
    """Return the pub/sub channel name for ``workflow_run_id``.

    Kept as a module-level helper so tests can pin the channel without
    reaching into the publish/subscribe code paths.
    """
    return f"{_CHANNEL_PREFIX}:{workflow_run_id}"


# ──────────────────────────────────────────────────────────────────────────────
# Message envelope
# ──────────────────────────────────────────────────────────────────────────────

#: Tags discriminating the wire-level message kinds. Kept narrow so the SSE
#: controller can pattern-match exhaustively.
InspectorMessageKind = Literal["node_changed", "workflow_completed"]


@dataclass(frozen=True, slots=True)
class InspectorMessage:
    """Minimal delta carried across the pub/sub channel.

    ``node_id`` is set only for ``node_changed`` messages; ``status`` is the
    coarse string status straight from the persistence layer (``"running"`` /
    ``"succeeded"`` / ``"failed"`` for nodes, plus ``"succeeded"`` /
    ``"failed"`` / ``"partial_succeeded"`` / ``"stopped"`` for workflow runs).
    """

    kind: InspectorMessageKind
    workflow_run_id: str
    node_id: str | None = None
    status: str | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_json(cls, blob: str) -> InspectorMessage | None:
        """Decode a payload, returning ``None`` for any shape we can't trust."""
        try:
            decoded = json.loads(blob)
        except (json.JSONDecodeError, TypeError):
            return None
        if not isinstance(decoded, dict):
            return None
        kind = decoded.get("kind")
        if kind not in ("node_changed", "workflow_completed"):
            return None
        workflow_run_id = decoded.get("workflow_run_id")
        if not isinstance(workflow_run_id, str) or not workflow_run_id:
            return None
        node_id = decoded.get("node_id")
        if node_id is not None and not isinstance(node_id, str):
            return None
        status = decoded.get("status")
        if status is not None and not isinstance(status, str):
            return None
        return cls(kind=kind, workflow_run_id=workflow_run_id, node_id=node_id, status=status)


# ──────────────────────────────────────────────────────────────────────────────
# Publisher (called from the persistence layer)
# ──────────────────────────────────────────────────────────────────────────────


def _publish(message: InspectorMessage) -> None:
    """Best-effort fire-and-forget publish.

    Persistence runs inside the workflow engine thread; we never want a redis
    glitch to break the workflow. Any exception is logged at debug level so
    operators still see them when they grep, but the engine keeps running.
    """
    try:
        redis_client.publish(channel_for(message.workflow_run_id), message.to_json())
    except Exception:
        logger.debug("InspectorEventPublisher: publish failed for %s", message.workflow_run_id, exc_info=True)


def publish_node_changed(*, workflow_run_id: str, node_id: str, status: str) -> None:
    """Announce that one node's execution row just changed.

    The SSE handler will recompute the node slice from the DB on receipt.
    """
    _publish(InspectorMessage(kind="node_changed", workflow_run_id=workflow_run_id, node_id=node_id, status=status))


def publish_workflow_completed(*, workflow_run_id: str, status: str) -> None:
    """Announce that the workflow run reached a terminal state.

    The SSE handler emits one last envelope and disconnects.
    """
    _publish(InspectorMessage(kind="workflow_completed", workflow_run_id=workflow_run_id, status=status))


# ──────────────────────────────────────────────────────────────────────────────
# Subscriber (consumed by the SSE controller)
# ──────────────────────────────────────────────────────────────────────────────


def subscribe(workflow_run_id: str, *, timeout_seconds: float = 1.0) -> Iterator[InspectorMessage]:
    """Yield ``InspectorMessage`` instances until the consumer abandons us.

    The loop polls redis with ``timeout_seconds`` so the SSE handler can
    interleave keepalive heartbeats. Yields ``None`` on timeout so the caller
    can decide whether to keep blocking; malformed payloads are silently
    skipped.

    The pub/sub connection is closed when the iterator is garbage-collected
    (the wrapping ``finally`` releases it as soon as the SSE handler exits).
    """
    pubsub = redis_client.pubsub()
    pubsub.subscribe(channel_for(workflow_run_id))
    try:
        while True:
            raw = pubsub.get_message(ignore_subscribe_messages=True, timeout=timeout_seconds)
            if raw is None:
                # Surface a heartbeat tick — caller can keep-alive or check
                # disconnection without blocking redis any longer.
                yield InspectorMessage(kind="node_changed", workflow_run_id=workflow_run_id, node_id=None, status=None)
                continue
            data = raw.get("data") if isinstance(raw, dict) else None
            if isinstance(data, bytes):
                data = data.decode("utf-8", errors="replace")
            if not isinstance(data, str):
                continue
            message = InspectorMessage.from_json(data)
            if message is None:
                continue
            yield message
    finally:
        try:
            pubsub.unsubscribe(channel_for(workflow_run_id))
            pubsub.close()
        except Exception:
            logger.debug(
                "InspectorEventPublisher: pubsub teardown failed for %s",
                workflow_run_id,
                exc_info=True,
            )
