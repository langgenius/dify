#!/usr/bin/env python3
"""
SSE (Server-Sent Events) Stress Test for Dify Workflow API

This script stress tests the streaming performance of Dify's workflow execution API,
measuring key metrics like connection rate, event throughput, and time to first event (TTFE).
"""

import json
import logging
import os
import random
import statistics
import sys
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal, TypeAlias, TypedDict

import requests.exceptions
from locust import HttpUser, between, constant, events, task

# Add the stress-test directory to path to import common modules
sys.path.insert(0, str(Path(__file__).parent))
from common.config_helper import ConfigHelper  # type: ignore[import-not-found]

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Configuration from environment
WORKFLOW_PATH = os.getenv("WORKFLOW_PATH", "/v1/workflows/run")
CONNECT_TIMEOUT = float(os.getenv("CONNECT_TIMEOUT", "10"))
READ_TIMEOUT = float(os.getenv("READ_TIMEOUT", "60"))
TERMINAL_EVENTS = [e.strip() for e in os.getenv("TERMINAL_EVENTS", "workflow_finished,error").split(",") if e.strip()]
QUESTIONS_FILE = os.getenv("QUESTIONS_FILE", "")


# Type definitions
ErrorType: TypeAlias = Literal[
    "connection_error",
    "timeout",
    "invalid_json",
    "http_4xx",
    "http_5xx",
    "early_termination",
    "invalid_response",
]


class ErrorCounts(TypedDict):
    """Error count tracking"""

    connection_error: int
    timeout: int
    invalid_json: int
    http_4xx: int
    http_5xx: int
    early_termination: int
    invalid_response: int


class SSEEvent(TypedDict):
    """Server-Sent Event structure"""

    data: str
    event: str
    id: str | None


class WorkflowInputs(TypedDict):
    """Workflow input structure"""

    question: str


class WorkflowRequestData(TypedDict):
    """Workflow request payload"""

    inputs: WorkflowInputs
    response_mode: Literal["streaming"]
    user: str


class ParsedEventData(TypedDict, total=False):
    """Parsed event data from SSE stream"""

    event: str
    task_id: str
    workflow_run_id: str
    data: object  # For dynamic content
    created_at: int


class LocustStats(TypedDict):
    """Locust statistics structure"""

    total_requests: int
    total_failures: int
    avg_response_time: float
    min_response_time: float
    max_response_time: float


class ReportData(TypedDict):
    """JSON report structure"""

    timestamp: str
    duration_seconds: float
    metrics: dict[str, object]  # Metrics as dict for JSON serialization
    locust_stats: LocustStats | None


@dataclass
class StreamMetrics:
    """Metrics for a single stream"""

    stream_duration: float
    events_count: int
    bytes_received: int
    ttfe: float
    inter_event_times: list[float]


@dataclass
class MetricsSnapshot:
    """Snapshot of current metrics state"""

    active_connections: int
    total_connections: int
    total_events: int
    connection_rate: float
    event_rate: float
    overall_conn_rate: float
    overall_event_rate: float
    ttfe_avg: float
    ttfe_min: float
    ttfe_max: float
    ttfe_p50: float
    ttfe_p95: float
    ttfe_samples: int
    ttfe_total_samples: int  # Total TTFE samples collected (not limited by window)
    error_counts: ErrorCounts
    stream_duration_avg: float
    stream_duration_p50: float
    stream_duration_p95: float
    events_per_stream_avg: float
    inter_event_latency_avg: float
    inter_event_latency_p50: float
    inter_event_latency_p95: float


class MetricsTracker:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.active_connections = 0
        self.total_connections = 0
        self.total_events = 0
        self.start_time = time.time()

        # Enhanced metrics with memory limits
        self.max_samples = 10000  # Prevent unbounded growth
        self.ttfe_samples: deque[float] = deque(maxlen=self.max_samples)
        self.ttfe_total_count = 0  # Track total TTFE samples collected

        # For rate calculations - no maxlen to avoid artificial limits
        self.connection_times: deque[float] = deque()
        self.event_times: deque[float] = deque()
        self.last_stats_time = time.time()
        self.last_total_connections = 0
        self.last_total_events = 0
        self.stream_metrics: deque[StreamMetrics] = deque(maxlen=self.max_samples)
        self.error_counts: ErrorCounts = ErrorCounts(
            connection_error=0,
            timeout=0,
            invalid_json=0,
            http_4xx=0,
            http_5xx=0,
            early_termination=0,
            invalid_response=0,
        )

    def connection_started(self) -> None:
        with self.lock:
            self.active_connections += 1
            self.total_connections += 1
            self.connection_times.append(time.time())

    def connection_ended(self) -> None:
        with self.lock:
            self.active_connections -= 1

    def event_received(self) -> None:
        with self.lock:
            self.total_events += 1
            self.event_times.append(time.time())

    def record_ttfe(self, ttfe_ms: float) -> None:
        with self.lock:
            self.ttfe_samples.append(ttfe_ms)  # deque handles maxlen
            self.ttfe_total_count += 1  # Increment total counter

    def record_stream_metrics(self, metrics: StreamMetrics) -> None:
        with self.lock:
            self.stream_metrics.append(metrics)  # deque handles maxlen

    def record_error(self, error_type: ErrorType) -> None:
        with self.lock:
            self.error_counts[error_type] += 1

    def get_stats(self) -> MetricsSnapshot:
        with self.lock:
            current_time = time.time()
            time_window = 10.0  # 10 second window for rate calculation

            # Clean up old timestamps outside the window
            cutoff_time = current_time - time_window
            while self.connection_times and self.connection_times[0] < cutoff_time:
                self.connection_times.popleft()
            while self.event_times and self.event_times[0] < cutoff_time:
                self.event_times.popleft()

            # Calculate rates based on actual window or elapsed time
            window_duration = min(time_window, current_time - self.start_time)
            if window_duration > 0:
                conn_rate = len(self.connection_times) / window_duration
                event_rate = len(self.event_times) / window_duration
            else:
                conn_rate = 0
                event_rate = 0

            # Calculate TTFE statistics
            if self.ttfe_samples:
                avg_ttfe = statistics.mean(self.ttfe_samples)
                min_ttfe = min(self.ttfe_samples)
                max_ttfe = max(self.ttfe_samples)
                p50_ttfe = statistics.median(self.ttfe_samples)
                if len(self.ttfe_samples) >= 2:
                    quantiles = statistics.quantiles(self.ttfe_samples, n=20, method="inclusive")
                    p95_ttfe = quantiles[18]  # 19th of 19 quantiles = 95th percentile
                else:
                    p95_ttfe = max_ttfe
            else:
                avg_ttfe = min_ttfe = max_ttfe = p50_ttfe = p95_ttfe = 0

            # Calculate stream metrics
            if self.stream_metrics:
                durations = [m.stream_duration for m in self.stream_metrics]
                events_per_stream = [m.events_count for m in self.stream_metrics]
                stream_duration_avg = statistics.mean(durations)
                stream_duration_p50 = statistics.median(durations)
                stream_duration_p95 = (
                    statistics.quantiles(durations, n=20, method="inclusive")[18]
                    if len(durations) >= 2
                    else max(durations)
                    if durations
                    else 0
                )
                events_per_stream_avg = statistics.mean(events_per_stream) if events_per_stream else 0

                # Calculate inter-event latency statistics
                all_inter_event_times = []
                for m in self.stream_metrics:
                    all_inter_event_times.extend(m.inter_event_times)

                if all_inter_event_times:
                    inter_event_latency_avg = statistics.mean(all_inter_event_times)
                    inter_event_latency_p50 = statistics.median(all_inter_event_times)
                    inter_event_latency_p95 = (
                        statistics.quantiles(all_inter_event_times, n=20, method="inclusive")[18]
                        if len(all_inter_event_times) >= 2
                        else max(all_inter_event_times)
                    )
                else:
                    inter_event_latency_avg = inter_event_latency_p50 = inter_event_latency_p95 = 0
            else:
                stream_duration_avg = stream_duration_p50 = stream_duration_p95 = events_per_stream_avg = 0
                inter_event_latency_avg = inter_event_latency_p50 = inter_event_latency_p95 = 0

            # Also calculate overall average rates
            total_elapsed = current_time - self.start_time
            overall_conn_rate = self.total_connections / total_elapsed if total_elapsed > 0 else 0
            overall_event_rate = self.total_events / total_elapsed if total_elapsed > 0 else 0

            return MetricsSnapshot(
                active_connections=self.active_connections,
                total_connections=self.total_connections,
                total_events=self.total_events,
                connection_rate=conn_rate,
                event_rate=event_rate,
                overall_conn_rate=overall_conn_rate,
                overall_event_rate=overall_event_rate,
                ttfe_avg=avg_ttfe,
                ttfe_min=min_ttfe,
                ttfe_max=max_ttfe,
                ttfe_p50=p50_ttfe,
                ttfe_p95=p95_ttfe,
                ttfe_samples=len(self.ttfe_samples),
                ttfe_total_samples=self.ttfe_total_count,  # Return total count
                error_counts=ErrorCounts(**self.error_counts),
                stream_duration_avg=stream_duration_avg,
                stream_duration_p50=stream_duration_p50,
                stream_duration_p95=stream_duration_p95,
                events_per_stream_avg=events_per_stream_avg,
                inter_event_latency_avg=inter_event_latency_avg,
                inter_event_latency_p50=inter_event_latency_p50,
                inter_event_latency_p95=inter_event_latency_p95,
            )


# Global metrics instance
metrics = MetricsTracker()


class SSEParser:
    """Parser for Server-Sent Events according to W3C spec"""

    def __init__(self) -> None:
        self.data_buffer: list[str] = []
        self.event_type: str | None = None
        self.event_id: str | None = None

    def parse_line(self, line: str) -> SSEEvent | None:
        """Parse a single SSE line and return event if complete"""
        # Empty line signals end of event
        if not line:
            if self.data_buffer:
                event = SSEEvent(
                    data="\n".join(self.data_buffer),
                    event=self.event_type or "message",
                    id=self.event_id,
                )
                self.data_buffer = []
                self.event_type = None
                self.event_id = None
                return event
            return None

        # Comment line
        if line.startswith(":"):
            return None

        # Parse field
        if ":" in line:
            field, value = line.split(":", 1)
            value = value.lstrip()

            if field == "data":
                self.data_buffer.append(value)
            elif field == "event":
                self.event_type = value
            elif field == "id":
                self.event_id = value

        return None


# Note: SSEClient removed - we'll handle SSE parsing directly in the task for better Locust integration


class DifyWorkflowUser(HttpUser):
    """Locust user for testing Dify workflow SSE endpoints"""

    # Use constant wait for streaming workloads
    wait_time = constant(0) if os.getenv("WAIT_TIME", "0") == "0" else between(1, 3)

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)  # type: ignore[arg-type]

        # Load API configuration
        config_helper = ConfigHelper()
        self.api_token = config_helper.get_api_key()

        if not self.api_token:
            raise ValueError("API key not found. Please run setup_all.py first.")

        # Load questions from file or use defaults
        if QUESTIONS_FILE and os.path.exists(QUESTIONS_FILE):
            with open(QUESTIONS_FILE) as f:
                self.questions = [line.strip() for line in f if line.strip()]
        else:
            self.questions = [
                "What is artificial intelligence?",
                "Explain quantum computing",
                "What is machine learning?",
                "How do neural networks work?",
                "What is renewable energy?",
            ]

        self.user_counter = 0

    def on_start(self) -> None:
        """Called when a user starts"""
        self.user_counter = 0

    @task
    def test_workflow_stream(self) -> None:
        """Test workflow SSE streaming endpoint"""

        question = random.choice(self.questions)
        self.user_counter += 1

        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Cache-Control": "no-cache",
        }

        data = WorkflowRequestData(
            inputs=WorkflowInputs(question=question),
            response_mode="streaming",
            user=f"user_{self.user_counter}",
        )

        start_time = time.time()
        first_event_time = None
        event_count = 0
        inter_event_times: list[float] = []
        last_event_time = None
        ttfe = 0
        request_success = False
        bytes_received = 0

        metrics.connection_started()

        # Use catch_response context manager directly
        with self.client.request(
            method="POST",
            url=WORKFLOW_PATH,
            headers=headers,
            json=data,
            stream=True,
            catch_response=True,
            timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
            name="/v1/workflows/run",  # Name for Locust stats
        ) as response:
            try:
                # Validate response
                if response.status_code >= 400:
                    error_type: ErrorType = "http_4xx" if response.status_code < 500 else "http_5xx"
                    metrics.record_error(error_type)
                    response.failure(f"HTTP {response.status_code}")
                    return

                content_type = response.headers.get("Content-Type", "")
                if "text/event-stream" not in content_type and "application/json" not in content_type:
                    logger.error(f"Expected text/event-stream, got: {content_type}")
                    metrics.record_error("invalid_response")
                    response.failure(f"Invalid content type: {content_type}")
                    return

                # Parse SSE events
                parser = SSEParser()

                for line in response.iter_lines(decode_unicode=True):
                    # Check if runner is stopping
                    if getattr(self.environment.runner, "state", "") in (
                        "stopping",
                        "stopped",
                    ):
                        logger.debug("Runner stopping, breaking streaming loop")
                        break

                    if line is not None:
                        bytes_received += len(line.encode("utf-8"))

                    # Parse SSE line
                    event = parser.parse_line(line if line is not None else "")
                    if event:
                        event_count += 1
                        current_time = time.time()
                        metrics.event_received()

                        # Track inter-event timing
                        if last_event_time:
                            inter_event_times.append((current_time - last_event_time) * 1000)
                        last_event_time = current_time

                        if first_event_time is None:
                            first_event_time = current_time
                            ttfe = (first_event_time - start_time) * 1000
                            metrics.record_ttfe(ttfe)

                        try:
                            # Parse event data
                            event_data = event.get("data", "")
                            if event_data:
                                if event_data == "[DONE]":
                                    logger.debug("Received [DONE] sentinel")
                                    request_success = True
                                    break

                                try:
                                    parsed_event: ParsedEventData = json.loads(event_data)
                                    # Check for terminal events
                                    if parsed_event.get("event") in TERMINAL_EVENTS:
                                        logger.debug(f"Received terminal event: {parsed_event.get('event')}")
                                        request_success = True
                                        break
                                except json.JSONDecodeError as e:
                                    logger.debug(f"JSON decode error: {e} for data: {event_data[:100]}")
                                    metrics.record_error("invalid_json")

                        except Exception as e:
                            logger.error(f"Error processing event: {e}")

                # Mark success only if terminal condition was met or events were received
                if request_success:
                    response.success()
                elif event_count > 0:
                    # Got events but no proper terminal condition
                    metrics.record_error("early_termination")
                    response.failure("Stream ended without terminal event")
                else:
                    response.failure("No events received")

            except (
                requests.exceptions.ConnectTimeout,
                requests.exceptions.ReadTimeout,
            ) as e:
                metrics.record_error("timeout")
                response.failure(f"Timeout: {e}")
            except (
                requests.exceptions.ConnectionError,
                requests.exceptions.RequestException,
            ) as e:
                metrics.record_error("connection_error")
                response.failure(f"Connection error: {e}")
            except Exception as e:
                response.failure(str(e))
                raise
            finally:
                metrics.connection_ended()

                # Record stream metrics
                if event_count > 0:
                    stream_duration = (time.time() - start_time) * 1000
                    stream_metrics = StreamMetrics(
                        stream_duration=stream_duration,
                        events_count=event_count,
                        bytes_received=bytes_received,
                        ttfe=ttfe,
                        inter_event_times=inter_event_times,
                    )
                    metrics.record_stream_metrics(stream_metrics)
                    logger.debug(
                        f"Stream completed: {event_count} events, {stream_duration:.1f}ms, success={request_success}"
                    )
                else:
                    logger.warning("No events received in stream")


# Event handlers
@events.test_start.add_listener  # type: ignore[misc]
def on_test_start(environment: object, **kwargs: object) -> None:
    logger.info("=" * 80)
    logger.info(" " * 25 + "DIFY SSE BENCHMARK - REAL-TIME METRICS")
    logger.info("=" * 80)
    logger.info(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("=" * 80)

    # Periodic stats reporting
    def report_stats() -> None:
        if not hasattr(environment, "runner"):
            return
        runner = environment.runner
        while hasattr(runner, "state") and runner.state not in ["stopped", "stopping"]:
            time.sleep(5)  # Report every 5 seconds
            if hasattr(runner, "state") and runner.state == "running":
                stats = metrics.get_stats()

                # Only log on master node in distributed mode
                is_master = (
                    not getattr(environment.runner, "worker_id", None) if hasattr(environment, "runner") else True
                )
                if is_master:
                    # Clear previous lines and show updated stats
                    logger.info("\n" + "=" * 80)
                    logger.info(
                        f"{'METRIC':<25} {'CURRENT':>15} {'RATE (10s)':>15} {'AVG (overall)':>15} {'TOTAL':>12}"
                    )
                    logger.info("-" * 80)

                    # Active SSE Connections
                    logger.info(
                        f"{'Active SSE Connections':<25} {stats.active_connections:>15,d} {'-':>15} {'-':>12} {'-':>12}"
                    )

                    # New Connection Rate
                    logger.info(
                        f"{'New Connections':<25} {'-':>15} {stats.connection_rate:>13.2f}/s {stats.overall_conn_rate:>13.2f}/s {stats.total_connections:>12,d}"
                    )

                    # Event Throughput
                    logger.info(
                        f"{'Event Throughput':<25} {'-':>15} {stats.event_rate:>13.2f}/s {stats.overall_event_rate:>13.2f}/s {stats.total_events:>12,d}"
                    )

                    logger.info("-" * 80)
                    logger.info(
                        f"{'TIME TO FIRST EVENT':<25} {'AVG':>15} {'P50':>10} {'P95':>10} {'MIN':>10} {'MAX':>10}"
                    )
                    logger.info(
                        f"{'(TTFE in ms)':<25} {stats.ttfe_avg:>15.1f} {stats.ttfe_p50:>10.1f} {stats.ttfe_p95:>10.1f} {stats.ttfe_min:>10.1f} {stats.ttfe_max:>10.1f}"
                    )
                    logger.info(
                        f"{'Window Samples':<25} {stats.ttfe_samples:>15,d} (last {min(10000, stats.ttfe_total_samples):,d} samples)"
                    )
                    logger.info(f"{'Total Samples':<25} {stats.ttfe_total_samples:>15,d}")

                    # Inter-event latency
                    if stats.inter_event_latency_avg > 0:
                        logger.info("-" * 80)
                        logger.info(f"{'INTER-EVENT LATENCY':<25} {'AVG':>15} {'P50':>10} {'P95':>10}")
                        logger.info(
                            f"{'(ms between events)':<25} {stats.inter_event_latency_avg:>15.1f} {stats.inter_event_latency_p50:>10.1f} {stats.inter_event_latency_p95:>10.1f}"
                        )

                    # Error stats
                    if any(stats.error_counts.values()):
                        logger.info("-" * 80)
                        logger.info(f"{'ERROR TYPE':<25} {'COUNT':>15}")
                        for error_type, count in stats.error_counts.items():
                            if isinstance(count, int) and count > 0:
                                logger.info(f"{error_type:<25} {count:>15,d}")

                    logger.info("=" * 80)

                    # Show Locust stats summary
                    if hasattr(environment, "stats") and hasattr(environment.stats, "total"):
                        total = environment.stats.total
                        if hasattr(total, "num_requests") and total.num_requests > 0:
                            logger.info(
                                f"{'LOCUST STATS':<25} {'Requests':>12} {'Fails':>8} {'Avg (ms)':>12} {'Min':>8} {'Max':>8}"
                            )
                            logger.info("-" * 80)
                            logger.info(
                                f"{'Aggregated':<25} {total.num_requests:>12,d} "
                                f"{total.num_failures:>8,d} "
                                f"{total.avg_response_time:>12.1f} "
                                f"{total.min_response_time:>8.0f} "
                                f"{total.max_response_time:>8.0f}"
                            )
                    logger.info("=" * 80)

    threading.Thread(target=report_stats, daemon=True).start()


@events.test_stop.add_listener  # type: ignore[misc]
def on_test_stop(environment: object, **kwargs: object) -> None:
    stats = metrics.get_stats()
    test_duration = time.time() - metrics.start_time

    # Log final results
    logger.info("\n" + "=" * 80)
    logger.info(" " * 30 + "FINAL BENCHMARK RESULTS")
    logger.info("=" * 80)
    logger.info(f"Test Duration: {test_duration:.1f} seconds")
    logger.info("-" * 80)

    logger.info("")
    logger.info("CONNECTIONS")
    logger.info(f"  {'Total Connections:':<30} {stats.total_connections:>10,d}")
    logger.info(f"  {'Final Active:':<30} {stats.active_connections:>10,d}")
    logger.info(f"  {'Average Rate:':<30} {stats.overall_conn_rate:>10.2f} conn/s")

    logger.info("")
    logger.info("EVENTS")
    logger.info(f"  {'Total Events Received:':<30} {stats.total_events:>10,d}")
    logger.info(f"  {'Average Throughput:':<30} {stats.overall_event_rate:>10.2f} events/s")
    logger.info(f"  {'Final Rate (10s window):':<30} {stats.event_rate:>10.2f} events/s")

    logger.info("")
    logger.info("STREAM METRICS")
    logger.info(f"  {'Avg Stream Duration:':<30} {stats.stream_duration_avg:>10.1f} ms")
    logger.info(f"  {'P50 Stream Duration:':<30} {stats.stream_duration_p50:>10.1f} ms")
    logger.info(f"  {'P95 Stream Duration:':<30} {stats.stream_duration_p95:>10.1f} ms")
    logger.info(f"  {'Avg Events per Stream:':<30} {stats.events_per_stream_avg:>10.1f}")

    logger.info("")
    logger.info("INTER-EVENT LATENCY")
    logger.info(f"  {'Average:':<30} {stats.inter_event_latency_avg:>10.1f} ms")
    logger.info(f"  {'Median (P50):':<30} {stats.inter_event_latency_p50:>10.1f} ms")
    logger.info(f"  {'95th Percentile:':<30} {stats.inter_event_latency_p95:>10.1f} ms")

    logger.info("")
    logger.info("TIME TO FIRST EVENT (ms)")
    logger.info(f"  {'Average:':<30} {stats.ttfe_avg:>10.1f} ms")
    logger.info(f"  {'Median (P50):':<30} {stats.ttfe_p50:>10.1f} ms")
    logger.info(f"  {'95th Percentile:':<30} {stats.ttfe_p95:>10.1f} ms")
    logger.info(f"  {'Minimum:':<30} {stats.ttfe_min:>10.1f} ms")
    logger.info(f"  {'Maximum:':<30} {stats.ttfe_max:>10.1f} ms")
    logger.info(
        f"  {'Window Samples:':<30} {stats.ttfe_samples:>10,d} (last {min(10000, stats.ttfe_total_samples):,d})"
    )
    logger.info(f"  {'Total Samples:':<30} {stats.ttfe_total_samples:>10,d}")

    # Error summary
    if any(stats.error_counts.values()):
        logger.info("")
        logger.info("ERRORS")
        for error_type, count in stats.error_counts.items():
            if isinstance(count, int) and count > 0:
                logger.info(f"  {error_type:<30} {count:>10,d}")

    logger.info("=" * 80 + "\n")

    # Export machine-readable report (only on master node)
    is_master = not getattr(environment.runner, "worker_id", None) if hasattr(environment, "runner") else True
    if is_master:
        export_json_report(stats, test_duration, environment)


def export_json_report(stats: MetricsSnapshot, duration: float, environment: object) -> None:
    """Export metrics to JSON file for CI/CD analysis"""

    reports_dir = Path(__file__).parent / "reports"
    reports_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_file = reports_dir / f"sse_metrics_{timestamp}.json"

    # Access environment.stats.total attributes safely
    locust_stats: LocustStats | None = None
    if hasattr(environment, "stats") and hasattr(environment.stats, "total"):
        total = environment.stats.total
        if hasattr(total, "num_requests") and total.num_requests > 0:
            locust_stats = LocustStats(
                total_requests=total.num_requests,
                total_failures=total.num_failures,
                avg_response_time=total.avg_response_time,
                min_response_time=total.min_response_time,
                max_response_time=total.max_response_time,
            )

    report_data = ReportData(
        timestamp=datetime.now().isoformat(),
        duration_seconds=duration,
        metrics=asdict(stats),  # type: ignore[arg-type]
        locust_stats=locust_stats,
    )

    with open(report_file, "w") as f:
        json.dump(report_data, f, indent=2)

    logger.info(f"Exported metrics to {report_file}")
