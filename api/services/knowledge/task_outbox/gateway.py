"""Best-effort wake-up for the durable knowledge task dispatcher."""

import logging

from sqlalchemy import event
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
_WAKE_REGISTERED = "knowledge_task_outbox_wake_registered"


def wake_knowledge_task_dispatcher() -> bool:
    """Wake the dispatcher; periodic polling remains the delivery guarantee."""

    try:
        from tasks.knowledge_task_outbox_task import dispatch_knowledge_task_outbox

        dispatch_knowledge_task_outbox.delay()
    except Exception:
        logger.exception("Failed to wake the knowledge task outbox dispatcher")
        return False
    return True


def wake_knowledge_task_dispatcher_after_commit(session: Session) -> None:
    """Register one best-effort wake-up after the caller's transaction commits."""

    if session.info.get(_WAKE_REGISTERED):
        return
    session.info[_WAKE_REGISTERED] = True

    def wake(committed_session: Session) -> None:
        committed_session.info.pop(_WAKE_REGISTERED, None)
        wake_knowledge_task_dispatcher()

    event.listen(session, "after_commit", wake, once=True)
