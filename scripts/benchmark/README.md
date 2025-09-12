# Dify Benchmark Suite

A high-performance benchmark suite for Dify workflow execution using **Locust** - optimized for measuring Server-Sent Events (SSE) streaming performance.

## Key Metrics Tracked

The benchmark focuses on four critical SSE performance indicators:

1. **Active SSE Connections** - Real-time count of open SSE connections
2. **New Connection Rate** - Connections per second (conn/sec)
3. **Time to First Event (TTFE)** - Latency until first SSE event arrives
4. **Event Throughput** - Events per second (events/sec)

## Features

- **True SSE Support**: Properly handles Server-Sent Events streaming without premature connection closure
- **Real-time Metrics**: Live reporting every 5 seconds during tests
- **Comprehensive Tracking**:
  - Active connection monitoring
  - Connection establishment rate
  - Event processing throughput
  - TTFE distribution analysis
- **Multiple Interfaces**:
  - Web UI for real-time monitoring (<http://localhost:8089>)
  - Headless mode with periodic console updates
- **Detailed Reports**: Final statistics with overall rates and averages
- **Easy Configuration**: Uses existing API key configuration from setup

## Test Types Explained

The benchmark suite includes 4 different test measurements:

### 1. **Workflow SSE Stream** (POST)

- **Purpose**: Tests individual SSE streaming requests with full event processing
- **What it does**:
  - Sends a workflow request with a random question
  - Establishes SSE connection and waits for response
  - Processes every event in the stream until completion
  - Tracks detailed metrics for each event
- **Metrics captured**:
  - Initial connection time
  - Full processing of all SSE events
  - Total data volume received
- **Use case**: Measuring end-to-end streaming performance under normal conditions

### 2. **Workflow SSE Burst** (POST)

- **Purpose**: Stress tests the system with rapid-fire requests
- **What it does**:
  - Sends 3 consecutive requests without waiting between them
  - Simulates burst traffic patterns
  - Consumes events but with minimal processing
  - Tests system's ability to handle concurrent streams
- **Metrics captured**:
  - Connection establishment time under load
  - System behavior during traffic spikes
- **Use case**: Testing system resilience and concurrent connection handling

### 3. **Time to First Event** (SSE_METRICS)

- **Purpose**: Measures initial response latency for SSE streams
- **What it measures**:
  - Time from request sent to first SSE event received
  - Critical for user experience (perceived responsiveness)
  - Indicates server processing overhead before streaming begins
- **Why it matters**:
  - Users see activity faster with lower TTFE
  - Helps identify bottlenecks in request processing
  - Key metric for streaming applications
- **Good values**: < 100ms excellent, < 500ms acceptable

### 4. **Stream Duration** (SSE_METRICS)

- **Purpose**: Measures total time for complete SSE stream transmission
- **What it measures**:
  - Time from first event to last event (workflow_finished)
  - Total duration of active streaming
  - Excludes initial connection time
- **Why it matters**:
  - Indicates actual content generation/transmission time
  - Helps identify if streams are taking too long
  - Important for timeout configuration
- **Expected values**: Varies by workflow complexity (500ms - 5s typical)

## Prerequisites

1. **Dependencies are automatically installed** when running setup:
   - Locust (load testing framework)
   - sseclient-py (SSE client library)

2. **Complete Dify setup**:

   ```bash
   # Run the complete setup
   python scripts/benchmark/setup_all.py
   ```

3. **Ensure services are running**:
   - Dify API server on port 5001 (`./dev/start-api`)
   - Mock OpenAI server on port 5004 (`python scripts/benchmark/setup/mock_openai_server.py`)

## Running the Benchmark

```bash
# Run with default configuration (headless mode)
./scripts/benchmark/run_locust_benchmark.sh

# Or run directly with uv
uv run --project api python -m locust -f scripts/benchmark/locust_sse_benchmark.py --host http://localhost:5001

# Run with Web UI (access at http://localhost:8089)
uv run --project api python -m locust -f scripts/benchmark/locust_sse_benchmark.py --host http://localhost:5001 --web-port 8089
```

The script will:

1. Validate that all required services are running
2. Check API token availability
3. Execute the Locust benchmark with SSE support
4. Generate comprehensive reports in the `reports/` directory

## Configuration

The benchmark configuration is in `locust.conf`:

```ini
users = 10           # Number of concurrent users
spawn-rate = 2       # Users spawned per second
run-time = 1m        # Test duration (30s, 5m, 1h)
headless = true      # Run without web UI
```

### Custom Question Sets

Modify the questions list in `locust_sse_benchmark.py`:

```python
self.questions = [
    "Your custom question 1",
    "Your custom question 2",
    # Add more questions...
]
```

## Understanding the Results

### Report Structure

After running the benchmark, you'll find two files in the `reports/` directory:

- `benchmark_YYYYMMDD_HHMMSS.txt` - Human-readable report with analysis
- `benchmark_YYYYMMDD_HHMMSS.json` - Raw statistics from drill

### Key Metrics

**Requests Per Second (RPS)**:

- **Excellent**: > 50 RPS
- **Good**: 20-50 RPS
- **Acceptable**: 10-20 RPS
- **Needs Improvement**: < 10 RPS

**Response Time Percentiles**:

- **P50 (Median)**: 50% of requests complete within this time
- **P95**: 95% of requests complete within this time
- **P99**: 99% of requests complete within this time

**Success Rate**:

- Should be > 99% for production readiness
- Lower rates indicate errors or timeouts

### Example Output

```
======================================================================
Starting Dify SSE Benchmark with Locust
Target Metrics:
  - Active SSE connections
  - New connection rate (conn/sec)
  - Time to first event (TTFE)
  - Event throughput (events/sec)
======================================================================

📊 Live Metrics:
  Active Connections: 8
  Connection Rate:    2.41 conn/sec
  Event Throughput:   45.82 events/sec
  Avg TTFE:          42 ms
  Total Connections: 24
  Total Events:      458

Type     Name                          # reqs  # fails |    Avg     Min     Max    Med | req/s  failures/s
---------|------------------------------|--------|--------|--------|--------|--------|--------|--------|-----------
SSE_METRICS  Stream Duration                10   0(0.00%) |    663     523     812    645 |   0.11        0.00
SSE_METRICS  Time to First Event            10   0(0.00%) |     42      38      51     41 |   0.11        0.00
POST     Workflow SSE Stream                10   0(0.00%) |     41      38      51     41 |   0.11        0.00
POST     Workflow SSE Burst                30   0(0.00%) |     45      20     192     38 |   1.38        0.00

======================================================================
FINAL BENCHMARK RESULTS
======================================================================

📈 Final Metrics:
  Total Connections:  156
  Total Events:       2964
  Average TTFE:       42 ms
  TTFE Samples:       156

📊 Overall Rates:
  Connection Rate:    2.60 conn/sec
  Event Throughput:   49.40 events/sec
```

### How to Read the Results

**Live Metrics (Updates every 5 seconds):**

- **Active Connections**: Current number of open SSE connections
- **Connection Rate**: New connections being established per second
- **Event Throughput**: SSE events being processed per second
- **Avg TTFE**: Average time to first event across all connections
- **Total Connections**: Cumulative connection count
- **Total Events**: Cumulative event count

**Standard Locust Metrics:**

- **Type**: Request type (POST for HTTP requests, SSE_METRICS for custom SSE measurements)
- **Name**: Test name identifying what's being measured
- **# reqs**: Total number of requests made
- **# fails**: Number and percentage of failed requests
- **Avg/Min/Max/Med**: Response time statistics in milliseconds
- **req/s**: Requests per second throughput
- **failures/s**: Failed requests per second

**Key Performance Indicators:**

1. **Active Connections** - Should remain stable under load
2. **Connection Rate** - Higher is better, shows system can handle new connections
3. **Event Throughput** - Critical metric for streaming performance
4. **TTFE < 100ms** - Excellent user experience
5. **Zero failures** - System stability indicator

## Test Scenarios

### Light Load

```yaml
concurrency: 10
iterations: 100
```

### Normal Load

```yaml
concurrency: 100
iterations: 1000
```

### Heavy Load

```yaml
concurrency: 500
iterations: 5000
```

### Stress Test

```yaml
concurrency: 1000
iterations: 10000
```

## Performance Tuning

### System Optimizations

1. **Increase file descriptor limits**:

   ```bash
   ulimit -n 65536
   ```

2. **TCP tuning for high concurrency** (Linux):

   ```bash
   # Increase TCP buffer sizes
   sudo sysctl -w net.core.rmem_max=134217728
   sudo sysctl -w net.core.wmem_max=134217728
   
   # Enable TCP fast open
   sudo sysctl -w net.ipv4.tcp_fastopen=3
   ```

3. **macOS specific**:

   ```bash
   # Increase maximum connections
   sudo sysctl -w kern.ipc.somaxconn=2048
   ```

## Troubleshooting

### Common Issues

1. **"ModuleNotFoundError: No module named 'locust'"**:

   ```bash
   # Dependencies are installed automatically, but if needed:
   uv --project api add --dev locust sseclient-py
   ```

2. **"API key configuration not found"**:

   ```bash
   # Run setup
   python scripts/benchmark/setup_all.py
   ```

3. **Services not running**:

   ```bash
   # Start Dify API
   ./dev/start-api
   
   # Start Mock OpenAI server
   python scripts/benchmark/setup/mock_openai_server.py
   ```

4. **High error rate**:
   - Reduce concurrency level
   - Check system resources (CPU, memory)
   - Review API server logs for errors
   - Increase timeout values if needed

5. **Permission denied running script**:

   ```bash
   chmod +x run_benchmark.sh
   ```

## Advanced Usage

### Running Multiple Iterations

```bash
# Run benchmark 3 times with 60-second intervals
for i in {1..3}; do
    echo "Run $i of 3"
    ./run_benchmark.sh
    sleep 60
done
```

### Custom Locust Options

Run Locust directly with custom options:

```bash
# With specific user count and spawn rate
uv run --project api python -m locust -f scripts/benchmark/locust_sse_benchmark.py \
  --host http://localhost:5001 --users 50 --spawn-rate 5

# Generate CSV reports
uv run --project api python -m locust -f scripts/benchmark/locust_sse_benchmark.py \
  --host http://localhost:5001 --csv reports/results

# Run for specific duration
uv run --project api python -m locust -f scripts/benchmark/locust_sse_benchmark.py \
  --host http://localhost:5001 --run-time 5m --headless
```

### Comparing Results

```bash
# Compare multiple benchmark runs
ls -la reports/benchmark_*.txt | tail -5
```

## Interpreting Performance Issues

### High Response Times

Possible causes:

- Database query performance
- External API latency
- Insufficient server resources
- Network congestion

### Low Throughput (RPS < 10)

Check for:

- CPU bottlenecks
- Memory constraints
- Database connection pooling
- API rate limiting

### High Error Rate

Investigate:

- Server error logs
- Resource exhaustion
- Timeout configurations
- Connection limits

## Why Locust?

Locust was chosen over Drill for this benchmark because:

1. **Proper SSE Support**: Correctly handles streaming responses without premature closure
2. **Custom Metrics**: Can track SSE-specific metrics like TTFE and stream duration
3. **Web UI**: Real-time monitoring and control via web interface
4. **Python Integration**: Seamlessly integrates with existing Python setup code
5. **Extensibility**: Easy to customize for specific testing scenarios

## Contributing

To improve the benchmark suite:

1. Edit `benchmark.yml` for configuration changes
2. Modify `run_benchmark.sh` for workflow improvements
3. Update question sets for better coverage
4. Add new metrics or analysis features
