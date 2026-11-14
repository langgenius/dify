"""Keep the garbage collector away from the objects a server process holds for its whole life."""

import gc
import logging

from configs import dify_config

logger = logging.getLogger(__name__)


def freeze_startup_objects() -> None:
    """Take everything alive at the end of startup out of the collector's sight.

    Once loaded, a server process holds about a million objects that never die: modules, classes,
    functions, ORM mappers, schema validators. A full collection walks all of them every time,
    although only state created by requests since the last one can have become garbage. The state
    of a request that lasts seconds, a streamed answer for one, outlives the two younger generations
    and is released by a full collection, so the cost comes back with the traffic.

    Frozen objects stay usable and are still released by reference counting. What is given up is the
    collection of reference cycles among them, which for objects that live as long as the process
    never comes.

    Call it once, when the process has loaded everything it will serve with and before it serves.
    """
    if not dify_config.GC_FREEZE_AFTER_STARTUP:
        return
    # Collect first so that garbage left over from loading is released rather than frozen.
    gc.collect()
    gc.freeze()
    logger.info(
        "Froze %d objects alive at startup; full garbage collections no longer scan them", gc.get_freeze_count()
    )
