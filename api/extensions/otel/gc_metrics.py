"""OTel's native GC counters plus low-overhead cyclic-collection duration samples."""

import gc
from collections import deque
from collections.abc import Callable, Iterable
from threading import Lock
from time import perf_counter_ns

from opentelemetry.instrumentation.system_metrics import SystemMetricsInstrumentor
from opentelemetry.metrics import CallbackOptions, MeterProvider, Observation

from libs.gc_freeze import startup_gc


def init_gc_metrics(meter_provider: MeterProvider) -> Callable[[], None]:
    """Install GC telemetry on the existing provider and return its cleanup callback.

    CPython's GIL protects sample appends. SDK collection drains one bounded buffer per
    generation, so frequent young collections cannot evict full-collection samples;
    recording directly inside GC could reenter an aggregation lock held by the SDK.
    No extra publisher thread, exporter, heap walk or manual collection is introduced.
    """
    native = SystemMetricsInstrumentor(
        config={
            "cpython.gc.collections": None,
            "cpython.gc.collected_objects": None,
            "cpython.gc.uncollectable_objects": None,
        }
    )
    owns_native = not native.is_instrumented_by_opentelemetry
    if owns_native:
        native.instrument(meter_provider=meter_provider)
    meter = meter_provider.get_meter("dify.runtime.gc")
    duration = meter.create_histogram(
        "dify.gc.duration",
        unit="s",
        description="Elapsed cyclic-GC collection time",
        explicit_bucket_boundaries_advisory=(0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5),
    )
    starts: dict[int, int] = {}
    generations = range(len(gc.get_threshold()))
    samples: tuple[deque[tuple[int, float, str]], ...] = tuple(deque(maxlen=4096) for _ in generations)
    sequence = [0 for _ in generations]
    published = [0 for _ in generations]
    dropped = [0 for _ in generations]
    current_phase = "runtime"
    startup_frozen_objects: int | None = None
    publish_lock = Lock()
    closed = False

    def on_gc(event: str, info: dict[str, int]) -> None:
        """Timestamp GC events and append samples without SDK calls, locks, logging or I/O."""
        generation = info["generation"]
        if event == "start":
            starts[generation] = perf_counter_ns()
            return
        started = starts.pop(generation, None)
        if started is not None:
            sequence[generation] += 1
            samples[generation].append(
                (sequence[generation], (perf_counter_ns() - started) / 1_000_000_000, current_phase)
            )

    def publish(_options: CallbackOptions) -> Iterable[Observation]:
        """Publish before the SDK snapshots histograms; bound work even if publication triggers GC."""
        with publish_lock:
            for generation, pending in enumerate(samples):
                for _ in range(len(pending)):
                    current, seconds, stage = pending.popleft()
                    dropped[generation] += current - published[generation] - 1
                    published[generation] = current
                    duration.record(seconds, {"generation": str(generation), "phase": stage})
            return tuple(Observation(count, {"generation": str(i)}) for i, count in enumerate(dropped))

    def on_startup(_sender: object, *, phase: str, frozen_objects: int) -> None:
        """Cache the startup snapshot so metric collection never traverses frozen objects."""
        nonlocal current_phase, startup_frozen_objects
        current_phase = "startup" if phase == "start" else "runtime"
        if phase == "stop":
            startup_frozen_objects = frozen_objects

    def observe_frozen(_: CallbackOptions) -> Iterable[Observation]:
        return (Observation(startup_frozen_objects),) if startup_frozen_objects is not None else ()

    meter.create_observable_counter("dify.gc.duration_samples_dropped", callbacks=(publish,), unit="{sample}")
    for name, read in (("count", gc.get_count), ("threshold", gc.get_threshold)):

        def observe(_: CallbackOptions, read: Callable[[], tuple[int, int, int]] = read) -> Iterable[Observation]:
            return tuple(Observation(value, {"generation": str(i)}) for i, value in enumerate(read()))

        meter.create_observable_gauge(f"cpython.gc.{name}", callbacks=(observe,))
    meter.create_observable_gauge("cpython.gc.enabled", callbacks=(lambda _: (Observation(int(gc.isenabled())),),))
    meter.create_observable_gauge("dify.gc.startup_frozen_objects", callbacks=(observe_frozen,), unit="{object}")
    startup_gc.connect(on_startup, weak=False)
    gc.callbacks.append(on_gc)

    def close() -> None:
        """Stop observation before the caller flushes the existing provider; safe to repeat."""
        nonlocal closed
        if closed:
            return
        closed = True
        if on_gc in gc.callbacks:
            gc.callbacks.remove(on_gc)
        startup_gc.disconnect(on_startup)
        if owns_native:
            native.uninstrument()

    return close
