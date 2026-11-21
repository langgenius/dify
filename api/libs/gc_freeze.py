"""Keep the garbage collector away from the objects a server process holds for its whole life."""

import gc
import logging

from blinker import Signal

from configs import dify_config

logger = logging.getLogger(__name__)

# Process-local startup notifications let optional telemetry observe the explicit startup
# collection without coupling this helper to the exporter. Subscribers belong to the app lifecycle.
startup_gc = Signal()


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

    It does not lower total collector time. CPython starts a full collection only once the objects
    promoted since the last one reach a quarter of the long-lived objects it tracks, and frozen
    objects no longer count, so full collections become more frequent as they become shorter. A
    production canary saw each one take 63% less time and three times as many of them. That is why
    it is off unless GC_FREEZE_AFTER_STARTUP is set: it is for deployments where the longest pause
    matters more than total collector time.

    Call it once, when the process has loaded everything it will serve with and before it serves.
    """
    startup_gc.send(None, phase="start", frozen_objects=0)
    if not dify_config.GC_FREEZE_AFTER_STARTUP:
        startup_gc.send(None, phase="stop", frozen_objects=0)
        return
    # Collect first so that garbage left over from loading is released rather than frozen.
    gc.collect()
    gc.freeze()
    frozen_objects = gc.get_freeze_count()
    startup_gc.send(None, phase="stop", frozen_objects=frozen_objects)
    logger.info("Froze %d objects alive at startup; full garbage collections no longer scan them", frozen_objects)
