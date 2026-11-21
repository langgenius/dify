"""OTel's native GC counters plus low-overhead cyclic-collection duration samples.

On GIL-enabled CPython, GC callbacks only timestamp and append bounded samples.
Each generation has its own buffer; SDK collection alone records histogram data.
"""

import gc
from collections import deque
from collections.abc import Callable, Iterable
from threading import Lock
from time import perf_counter_ns

from opentelemetry.instrumentation.system_metrics import SystemMetricsInstrumentor
from opentelemetry.metrics import CallbackOptions, MeterProvider, Observation

_DURATION_SAMPLES_PER_GENERATION = 4096


def init_gc_metrics(meter_provider: MeterProvider) -> Callable[[], None]:
    """Install process-local GC telemetry on an initialized provider and return cleanup.

    Call once during OTel startup on Dify's GIL-enabled CPython runtime. The caller
    owns provider collection/export and must run cleanup before its final flush.
    GC behavior is unchanged: no heap walk, manual collection, tuning, publisher
    thread or exporter is introduced. SDK setup errors propagate to the caller.

    CPython's GIL protects sample appends. One buffer per generation prevents young
    collections from evicting full-collection samples. Recording directly inside GC
    could reenter an SDK aggregation lock; only the SDK collection callback records.
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
    samples: tuple[deque[tuple[int, float]], ...] = tuple(
        deque(maxlen=_DURATION_SAMPLES_PER_GENERATION) for _ in generations
    )
    sequence = [0 for _ in generations]
    published = [0 for _ in generations]
    dropped = [0 for _ in generations]
    publish_lock = Lock()
    closed = False

    def on_gc(event: str, info: dict[str, int]) -> None:
        """Given paired CPython GC events, buffer elapsed seconds without SDK calls or I/O."""
        generation = info["generation"]
        if event == "start":
            starts[generation] = perf_counter_ns()
            return
        started = starts.pop(generation, None)
        if started is not None:
            sequence[generation] += 1
            samples[generation].append((sequence[generation], (perf_counter_ns() - started) / 1_000_000_000))

    def publish(_options: CallbackOptions) -> Iterable[Observation]:
        """Drain bounded samples before the SDK snapshots histograms and report cumulative loss.

        Snapshot each buffer's length so publication stays bounded even if recording
        triggers GC. Sequence gaps account for overwritten samples per generation.
        """
        with publish_lock:
            for generation, pending in enumerate(samples):
                for _ in range(len(pending)):
                    current, seconds = pending.popleft()
                    dropped[generation] += current - published[generation] - 1
                    published[generation] = current
                    duration.record(seconds, {"generation": str(generation)})
            return tuple(Observation(count, {"generation": str(i)}) for i, count in enumerate(dropped))

    meter.create_observable_counter("dify.gc.duration_samples_dropped", callbacks=(publish,), unit="{sample}")
    for name, read in (("count", gc.get_count), ("threshold", gc.get_threshold)):

        def observe(_: CallbackOptions, read: Callable[[], tuple[int, int, int]] = read) -> Iterable[Observation]:
            """Read current interpreter scheduling state without a heap walk or collection."""
            return tuple(Observation(value, {"generation": str(i)}) for i, value in enumerate(read()))

        meter.create_observable_gauge(f"cpython.gc.{name}", callbacks=(observe,))
    meter.create_observable_gauge("cpython.gc.enabled", callbacks=(lambda _: (Observation(int(gc.isenabled())),),))
    gc.callbacks.append(on_gc)

    def close() -> None:
        """Stop GC observation before the caller's final flush; repeated cleanup is harmless.

        Pending durations remain available for that flush. Only native instrumentation
        installed by this call is released; the caller still owns the provider.
        """
        nonlocal closed
        if closed:
            return
        closed = True
        if on_gc in gc.callbacks:
            gc.callbacks.remove(on_gc)
        if owns_native:
            native.uninstrument()

    return close
