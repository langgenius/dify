#!/usr/bin/env python3
"""
Locust benchmark script for Dify SSE endpoints
Tracks key metrics:
- Active SSE connections
- New connection rate (conn/sec)
- Time to first event (TTFE)
- Event throughput (events/sec)
"""

import json
import time
import random
import sys
import threading
from pathlib import Path
from locust import HttpUser, task, between, events
from locust.clients import HttpSession
from typing import Dict, Any

# Add the benchmark directory to path to import common modules
sys.path.insert(0, str(Path(__file__).parent))
from common.config_helper import ConfigHelper

# Global metrics tracking
class MetricsTracker:
    def __init__(self):
        self.lock = threading.Lock()
        self.active_connections = 0
        self.total_connections = 0
        self.total_events = 0
        self.start_time = time.time()
        self.ttfe_samples = []
        self.last_report_time = time.time()
        self.last_event_count = 0
        self.last_connection_count = 0
    
    def connection_started(self):
        with self.lock:
            self.active_connections += 1
            self.total_connections += 1
    
    def connection_ended(self):
        with self.lock:
            self.active_connections -= 1
    
    def event_received(self):
        with self.lock:
            self.total_events += 1
    
    def record_ttfe(self, ttfe_ms: float):
        with self.lock:
            self.ttfe_samples.append(ttfe_ms)
    
    def get_metrics(self) -> Dict[str, Any]:
        with self.lock:
            current_time = time.time()
            time_delta = current_time - self.last_report_time
            
            # Calculate rates
            events_since_last = self.total_events - self.last_event_count
            connections_since_last = self.total_connections - self.last_connection_count
            
            event_rate = events_since_last / time_delta if time_delta > 0 else 0
            connection_rate = connections_since_last / time_delta if time_delta > 0 else 0
            
            # Calculate average TTFE
            avg_ttfe = sum(self.ttfe_samples) / len(self.ttfe_samples) if self.ttfe_samples else 0
            
            # Update last report values
            self.last_report_time = current_time
            self.last_event_count = self.total_events
            self.last_connection_count = self.total_connections
            
            return {
                "active_connections": self.active_connections,
                "total_connections": self.total_connections,
                "total_events": self.total_events,
                "event_rate": event_rate,
                "connection_rate": connection_rate,
                "avg_ttfe": avg_ttfe,
                "ttfe_samples": len(self.ttfe_samples)
            }

# Global metrics instance
metrics = MetricsTracker()


class SSEClient:
    """Custom SSE client wrapper for Locust"""

    def __init__(self, session: HttpSession):
        self.session = session

    def stream_request(self, method: str, url: str, name: str = None, **kwargs):
        """Make a streaming request and parse SSE events"""
        import requests

        # Remove stream parameter if present (we'll handle it ourselves)
        kwargs.pop("stream", None)
        kwargs.pop("catch_response", None)

        # Make the request with stream=True
        start_time = time.time()

        try:
            # Build full URL
            full_url = self.session.base_url + url

            # Use raw requests for streaming
            raw_response = requests.request(
                method=method, url=full_url, stream=True, timeout=60, **kwargs
            )

            # Record the initial connection
            total_time = (time.time() - start_time) * 1000

            # Fire Locust event for metrics
            events.request.fire(
                request_type=method,
                name=name or url,
                response_time=total_time,
                response_length=0,  # Will be updated as we receive events
                response=raw_response,
                exception=None
                if raw_response.status_code < 400
                else f"HTTP {raw_response.status_code}",
                context={},
            )

            # Return raw response for manual SSE parsing
            return raw_response

        except Exception as e:
            total_time = (time.time() - start_time) * 1000
            events.request.fire(
                request_type=method,
                name=name or url,
                response_time=total_time,
                response_length=0,
                response=None,
                exception=e,
                context={},
            )
            raise

    def parse_sse_events(self, response):
        """Generator to parse SSE events from response"""
        for line in response.iter_lines(decode_unicode=True):
            if line.startswith("data: "):
                yield line[6:]  # Strip 'data: ' prefix


class DifyWorkflowUser(HttpUser):
    """Locust user for testing Dify workflow SSE endpoints"""

    wait_time = between(1, 3)  # Wait 1-3 seconds between requests

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.sse_client = SSEClient(self.client)

        # Load API configuration using config_helper
        config_helper = ConfigHelper()
        self.api_token = config_helper.get_api_key()

        if not self.api_token:
            raise ValueError("API key not found. Please run setup_all.py first.")

        # Sample questions for testing
        self.questions = [
            "What is artificial intelligence and how does it work?",
            "Explain quantum computing in simple terms",
            "What are the key differences between machine learning and deep learning?",
            "How do neural networks process information?",
            "What is the future of renewable energy?",
            "Describe the water cycle and its importance",
            "What causes climate change?",
            "How does the human immune system work?",
            "Explain the theory of relativity",
            "What is blockchain technology?",
        ]

        self.user_counter = 0

    def on_start(self):
        """Called when a user starts"""
        self.user_counter = 0

    @task
    def workflow_streaming_request(self):
        """Test workflow SSE streaming endpoint with comprehensive metrics"""

        # Select a random question
        question = random.choice(self.questions)
        self.user_counter += 1

        # Prepare request data
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",  # Important for SSE
        }

        data = {
            "inputs": {"question": question},
            "response_mode": "streaming",
            "user": f"benchmark_user_{self.user_counter}",
        }

        # Track metrics
        start_time = time.time()
        event_count = 0
        total_bytes = 0
        first_event_time = None
        last_event_time = None

        # Record connection start
        metrics.connection_started()

        try:
            # Make streaming request
            response = self.sse_client.stream_request(
                method="POST",
                url="/v1/workflows/run",
                name="Workflow SSE Stream",
                headers=headers,
                json=data,
            )

            # Process SSE events
            for event_data in self.sse_client.parse_sse_events(response):
                if event_data:
                    event_count += 1
                    total_bytes += len(event_data)
                    metrics.event_received()  # Track each event

                    if first_event_time is None:
                        first_event_time = time.time()
                        # Record TTFE
                        ttfe = (first_event_time - start_time) * 1000
                        metrics.record_ttfe(ttfe)
                    last_event_time = time.time()

                    # Parse event data
                    try:
                        parsed_event = json.loads(event_data)

                        # Check for completion
                        if parsed_event.get("event") == "workflow_finished":
                            break

                        # Check for errors
                        if parsed_event.get("event") == "error":
                            print(f"Error in SSE stream: {parsed_event.get('message')}")
                            break

                    except json.JSONDecodeError:
                        # Some events might not be JSON
                        pass

            # Calculate metrics
            total_time = (time.time() - start_time) * 1000  # in ms

            if first_event_time:
                time_to_first_event = (first_event_time - start_time) * 1000
                stream_duration = (
                    (last_event_time - first_event_time) * 1000
                    if last_event_time
                    else 0
                )

                # Log custom metrics to Locust
                events.request.fire(
                    request_type="SSE_METRICS",
                    name="Time to First Event",
                    response_time=time_to_first_event,
                    response_length=0,
                    response=None,
                    exception=None,
                    context={},
                )

                events.request.fire(
                    request_type="SSE_METRICS",
                    name="Stream Duration",
                    response_time=stream_duration,
                    response_length=total_bytes,
                    response=None,
                    exception=None,
                    context={},
                )

        except Exception as e:
            print(f"Error during SSE streaming: {e}")
            raise
        finally:
            # Record connection end
            metrics.connection_ended()

    @task(2)  # This task runs twice as often
    def workflow_streaming_burst(self):
        """Burst test with rapid requests - tests connection rate"""

        # Make 3 rapid requests
        for i in range(3):
            question = random.choice(self.questions)
            start_time = time.time()

            headers = {
                "Authorization": f"Bearer {self.api_token}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            }

            data = {
                "inputs": {"question": question},
                "response_mode": "streaming",
                "user": f"benchmark_burst_user_{self.user_counter}_{i}",
            }

            # Record connection start
            metrics.connection_started()
            first_event_received = False

            try:
                response = self.sse_client.stream_request(
                    method="POST",
                    url="/v1/workflows/run",
                    name="Workflow SSE Burst",
                    headers=headers,
                    json=data,
                )

                # Consume all events but don't process them in detail
                for event_data in self.sse_client.parse_sse_events(response):
                    if event_data:
                        metrics.event_received()
                        
                        if not first_event_received:
                            ttfe = (time.time() - start_time) * 1000
                            metrics.record_ttfe(ttfe)
                            first_event_received = True
                        
                        try:
                            parsed_event = json.loads(event_data)
                            if parsed_event.get("event") in [
                                "workflow_finished",
                                "error",
                            ]:
                                break
                        except:
                            pass

            except Exception as e:
                print(f"Burst request {i} failed: {e}")
            finally:
                metrics.connection_ended()


# Custom event handlers for reporting
@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    print("=" * 70)
    print("Starting Dify SSE Benchmark with Locust")
    print("Target Metrics:")
    print("  - Active SSE connections")
    print("  - New connection rate (conn/sec)")
    print("  - Time to first event (TTFE)")
    print("  - Event throughput (events/sec)")
    print("=" * 70)
    
    # Start periodic metrics reporting
    def report_metrics():
        while environment.runner.state not in ["stopped", "stopping"]:
            time.sleep(5)  # Report every 5 seconds
            if environment.runner.state == "running":
                m = metrics.get_metrics()
                print(f"\n📊 Live Metrics:")
                print(f"  Active Connections: {m['active_connections']}")
                print(f"  Connection Rate:    {m['connection_rate']:.2f} conn/sec")
                print(f"  Event Throughput:   {m['event_rate']:.2f} events/sec")
                print(f"  Avg TTFE:          {m['avg_ttfe']:.0f} ms")
                print(f"  Total Connections: {m['total_connections']}")
                print(f"  Total Events:      {m['total_events']}")
    
    # Start metrics reporting in background thread
    import threading
    thread = threading.Thread(target=report_metrics, daemon=True)
    thread.start()


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    print("\n" + "=" * 70)
    print("FINAL BENCHMARK RESULTS")
    print("=" * 70)
    
    # Print final metrics
    m = metrics.get_metrics()
    print(f"\n📈 Final Metrics:")
    print(f"  Total Connections:  {m['total_connections']}")
    print(f"  Total Events:       {m['total_events']}")
    print(f"  Average TTFE:       {m['avg_ttfe']:.0f} ms")
    print(f"  TTFE Samples:       {m['ttfe_samples']}")
    
    # Calculate overall rates
    if metrics.start_time:
        total_duration = time.time() - metrics.start_time
        overall_conn_rate = m['total_connections'] / total_duration
        overall_event_rate = m['total_events'] / total_duration
        print(f"\n📊 Overall Rates:")
        print(f"  Connection Rate:    {overall_conn_rate:.2f} conn/sec")
        print(f"  Event Throughput:   {overall_event_rate:.2f} events/sec")
    
    print("\n" + "=" * 70)
