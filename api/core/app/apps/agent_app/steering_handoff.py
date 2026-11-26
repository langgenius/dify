"""Run-settled barrier for the Agent App steering handoff.

Invariant: a queued steering input may start the next ordinary turn only after
the previous run's session snapshot persistence finished. The Agent App runner
marks the key after its terminal save (or after observing there was nothing to
save); the admitted interrupt request polls it once, synchronously, never as a
background observer. The key lives only as long as a steering binding does.
"""

import time

from extensions.ext_redis import redis_client

_HANDOFF_KEY_PREFIX = "agent-chat-handoff-ready:"
_HANDOFF_TTL_SECONDS = 1800
# A tracked shell job can spend 10 seconds in termination before the snapshot is saved.
_WAIT_TIMEOUT_SECONDS = 30.0
_WAIT_POLL_SECONDS = 0.1


def _handoff_key(task_id: str) -> str:
    return f"{_HANDOFF_KEY_PREFIX}{task_id}"


def mark_agent_chat_handoff_ready(task_id: str) -> None:
    """Record that the task's run finished its session snapshot persistence.

    Postcondition: a waiter observing the key may safely open the next turn;
    the caller must not mark before ``_save_session`` succeeded or when the
    save failed, otherwise the next turn could replay stale inputs.
    """
    redis_client.setex(_handoff_key(task_id), _HANDOFF_TTL_SECONDS, "1")


def wait_for_agent_chat_handoff(task_id: str) -> bool:
    """Block one admitted handoff request until the run-settled mark appears.

    Returns ``True`` once the mark is visible and ``False`` when the bounded
    wait expires; the caller must treat ``False`` as a retryable 503 and never
    start the next turn. Runs on the request thread only — no background poll.
    """
    deadline = time.monotonic() + _WAIT_TIMEOUT_SECONDS
    while not redis_client.get(_handoff_key(task_id)):
        if time.monotonic() >= deadline:
            return False
        time.sleep(_WAIT_POLL_SECONDS)
    return True
