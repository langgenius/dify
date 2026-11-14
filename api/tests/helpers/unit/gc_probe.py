"""Exercise startup hooks with an isolated, real garbage collector."""

import os
import subprocess
import sys
import textwrap
from pathlib import Path


def assert_startup_gc_behavior(startup: str, enabled: bool) -> None:
    """Run a startup hook in a child so freezing never changes the test runner's heap."""
    script = startup + textwrap.dedent(
        f"""
        import gc
        import weakref

        class StartupObject:
            pass

        gc.disable()
        startup_object = StartupObject()
        leftover = StartupObject()
        leftover.cycle = leftover
        leftover_ref = weakref.ref(leftover)
        del leftover

        start()

        tracked = any(obj is startup_object for obj in gc.get_objects())
        assert tracked is {not enabled!r}, 'startup objects remain in the cyclic GC scan'
        if {enabled!r}:
            assert leftover_ref() is None, 'startup garbage must be collected before freezing'

        runtime_object = StartupObject()
        runtime_object.cycle = runtime_object
        runtime_ref = weakref.ref(runtime_object)
        del runtime_object
        gc.collect()
        assert runtime_ref() is None, 'request cycles must remain collectable'
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[3],
        env={**os.environ, "GC_FREEZE_ENABLED": str(enabled).lower()},
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr
