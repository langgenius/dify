# Dify Stress Test Suite

A high-performance stress test suite for Dify workflow execution using **Locust** - optimized for measuring Server-Sent Events (SSE) streaming performance.

## Key Metrics Tracked

The stress test focuses on four critical SSE performance indicators:

1. **Active SSE Connections** - Real-time count of open SSE connections
1. **New Connection Rate** - Connections per second (conn/sec)
1. **Time to First Event (TTFE)** - Latency until first SSE event arrives
1. **Event Throughput** - Events per second (events/sec)

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

## What Gets Measured

The stress test focuses on SSE streaming performance with these key metrics:

### Primary Endpoint: `/v1/workflows/run`

The stress test tests a single endpoint with comprehensive SSE metrics tracking:

- **Request Type**: POST request to workflow execution API
- **Response Type**: Server-Sent Events (SSE) stream
- **Payload**: Random questions from a configurable pool
- **Concurrency**: Configurable from 1 to 1000+ simultaneous users

### Key Performance Metrics

#### 1. **Active Connections**

- **What it measures**: Number of concurrent SSE connections open at any moment
- **Why it matters**: Shows system's ability to handle parallel streams
- **Good values**: Should remain stable under load without drops

#### 2. **Connection Rate (conn/sec)**

- **What it measures**: How fast new SSE connections are established
- **Why it matters**: Indicates system's ability to handle connection spikes
- **Good values**:
  - Light load: 5-10 conn/sec
  - Medium load: 20-50 conn/sec
  - Heavy load: 100+ conn/sec

#### 3. **Time to First Event (TTFE)**

- **What it measures**: Latency from request sent to first SSE event received
- **Why it matters**: Critical for user experience - faster TTFE = better perceived performance
- **Good values**:
  - Excellent: < 50ms
  - Good: 50-100ms
  - Acceptable: 100-500ms
  - Poor: > 500ms

#### 4. **Event Throughput (events/sec)**

- **What it measures**: Rate of SSE events being delivered across all connections
- **Why it matters**: Shows actual data delivery performance
- **Expected values**: Depends on workflow complexity and number of connections
  - Single connection: 10-20 events/sec
  - 10 connections: 50-100 events/sec
  - 100 connections: 200-500 events/sec

#### 5. **Request/Response Times**

- **P50 (Median)**: 50% of requests complete within this time
- **P95**: 95% of requests complete within this time
- **P99**: 99% of requests complete within this time
- **Min/Max**: Best and worst case response times

## Prerequisites

1. **Dependencies are automatically installed** when running setup:

   - Locust (load testing framework)
   - sseclient-py (SSE client library)

1. **Complete Dify setup**:

   ```bash
   # Run the complete setup
   python scripts/stress-test/setup_all.py
   ```

1. **Ensure services are running**:

   **IMPORTANT**: For accurate stress testing, run the API server with Gunicorn in production mode:

   ```bash
   # Run from the api directory
   cd api
   uv run gunicorn \
     --bind 0.0.0.0:5001 \
     --workers 4 \
     --worker-class gevent \
     --timeout 120 \
     --keep-alive 5 \
     --log-level info \
     --access-logfile - \
     --error-logfile - \
     app:app
   ```

   **Configuration options explained**:

   - `--workers 4`: Number of worker processes (adjust based on CPU cores)
   - `--worker-class gevent`: Async worker for handling concurrent connections
   - `--timeout 120`: Worker timeout for long-running requests
   - `--keep-alive 5`: Keep connections alive for SSE streaming

   **NOT RECOMMENDED for stress testing**:

   ```bash
   # Debug mode - DO NOT use for stress testing (slow performance)
   ./dev/start-api  # This runs Flask in debug mode with single-threaded execution
   ```

   **Also start the Mock OpenAI server**:

   ```bash
   python scripts/stress-test/setup/mock_openai_server.py
   ```

## Running the Stress Test

```bash
# Run with default configuration (headless mode)
./scripts/stress-test/run_locust_stress_test.sh

# Or run directly with uv
uv run --project api python -m locust -f scripts/stress-test/sse_benchmark.py --host http://localhost:5001

# Run with Web UI (access at http://localhost:8089)
uv run --project api python -m locust -f scripts/stress-test/sse_benchmark.py --host http://localhost:5001 --web-port 8089
```

The script will:

1. Validate that all required services are running
1. Check API token availability
1. Execute the Locust stress test with SSE support
1. Generate comprehensive reports in the `reports/` directory

## Configuration

The stress test configuration is in `locust.conf`:

```ini
users = 10           # Number of concurrent users
spawn-rate = 2       # Users spawned per second
run-time = 1m        # Test duration (30s, 5m, 1h)
headless = true      # Run without web UI
```

### Custom Question Sets

Modify the questions list in `sse_benchmark.py`:

```python
self.questions = [
    "Your custom question 1",
    "Your custom question 2",
    # Add more questions...
]
```

## Understanding the Results

### Report Structure

After running the stress test, you'll find these files in the `reports/` directory:

- `locust_summary_YYYYMMDD_HHMMSS.txt` - Complete console output with metrics
- `locust_report_YYYYMMDD_HHMMSS.html` - Interactive HTML report with charts
- `locust_YYYYMMDD_HHMMSS_stats.csv` - CSV with detailed statistics
- `locust_YYYYMMDD_HHMMSS_stats_history.csv` - Time-series data

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

```text
============================================================
DIFY SSE STRESS TEST
============================================================

[2025-09-12 15:45:44,468] Starting test run with 10 users at 2 users/sec

============================================================
SSE Metrics | Active:   8 | Total Conn:   142 | Events:   2841
Rates: 2.4 conn/s | 47.3 events/s | TTFE: 43ms
============================================================

Type     Name                          # reqs  # fails |    Avg     Min     Max    Med | req/s  failures/s
---------|------------------------------|--------|--------|--------|--------|--------|--------|--------|-----------
POST     /v1/workflows/run                  142   0(0.00%) |     41      18     192     38 |   2.37        0.00
---------|------------------------------|--------|--------|--------|--------|--------|--------|--------|-----------
         Aggregated                         142   0(0.00%) |     41      18     192     38 |   2.37        0.00

============================================================
FINAL RESULTS
============================================================
Total Connections: 142
Total Events:      2841
Average TTFE:      43 ms
============================================================
```

### How to Read the Results

**Live SSE Metrics Box (Updates every 10 seconds):**

```text
SSE Metrics | Active:   8 | Total Conn:   142 | Events:   2841
Rates: 2.4 conn/s | 47.3 events/s | TTFE: 43ms
```

- **Active**: Current number of open SSE connections
- **Total Conn**: Cumulative connections established
- **Events**: Total SSE events received
- **conn/s**: Connection establishment rate
- **events/s**: Event delivery rate
- **TTFE**: Average time to first event

**Standard Locust Table:**

```text
Type     Name                # reqs  # fails |    Avg     Min     Max    Med | req/s
POST     /v1/workflows/run      142   0(0.00%) |     41      18     192     38 |   2.37
```

- **Type**: Always POST for our SSE requests
- **Name**: The API endpoint being tested
- **# reqs**: Total requests made
- **# fails**: Failed requests (should be 0)
- **Avg/Min/Max/Med**: Response time percentiles (ms)
- **req/s**: Request throughput

**Performance Targets:**

✅ **Good Performance**:

- Zero failures (0.00%)
- TTFE < 100ms
- Stable active connections
- Consistent event throughput

⚠️ **Warning Signs**:

- Failures > 1%
- TTFE > 500ms
- Dropping active connections
- Declining event rate over time

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

### API Server Optimization

**Gunicorn Tuning for Different Load Levels**:

```bash
# Light load (10-50 concurrent users)
uv run gunicorn --bind 0.0.0.0:5001 --workers 2 --worker-class gevent app:app

# Medium load (50-200 concurrent users)
uv run gunicorn --bind 0.0.0.0:5001 --workers 4 --worker-class gevent --worker-connections 1000 app:app

# Heavy load (200-1000 concurrent users)
uv run gunicorn --bind 0.0.0.0:5001 --workers 8 --worker-class gevent --worker-connections 2000 --max-requests 1000 app:app
```

**Worker calculation formula**:

- Workers = (2 × CPU cores) + 1
- For SSE/WebSocket: Use gevent worker class
- For CPU-bound tasks: Use sync workers

### Database Optimization

**PostgreSQL Connection Pool Tuning**:

For high-concurrency stress testing, increase the PostgreSQL max connections in `docker/middleware.env`:

```bash
# Edit docker/middleware.env
POSTGRES_MAX_CONNECTIONS=200  # Default is 100

# Recommended values for different load levels:
# Light load (10-50 users): 100 (default)
# Medium load (50-200 users): 200
# Heavy load (200-1000 users): 500
```

After changing, restart the PostgreSQL container:

```bash
docker compose -f docker/docker-compose.middleware.yaml down db
docker compose -f docker/docker-compose.middleware.yaml up -d db
```

**Note**: Each connection uses ~10MB of RAM. Ensure your database server has sufficient memory:

- 100 connections: ~1GB RAM
- 200 connections: ~2GB RAM
- 500 connections: ~5GB RAM

### System Optimizations

1. **Increase file descriptor limits**:

   ```bash
   ulimit -n 65536
   ```

1. **TCP tuning for high concurrency** (Linux):

   ```bash
   # Increase TCP buffer sizes
   sudo sysctl -w net.core.rmem_max=134217728
   sudo sysctl -w net.core.wmem_max=134217728

   # Enable TCP fast open
   sudo sysctl -w net.ipv4.tcp_fastopen=3
   ```

1. **macOS specific**:

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

1. **"API key configuration not found"**:

   ```bash
   # Run setup
   python scripts/stress-test/setup_all.py
   ```

1. **Services not running**:

   ```bash
   # Start Dify API with Gunicorn (production mode)
   cd api
   uv run gunicorn --bind 0.0.0.0:5001 --workers 4 --worker-class gevent app:app

   # Start Mock OpenAI server
   python scripts/stress-test/setup/mock_openai_server.py
   ```

1. **High error rate**:

   - Reduce concurrency level
   - Check system resources (CPU, memory)
   - Review API server logs for errors
   - Increase timeout values if needed

1. **Permission denied running script**:

   ```bash
   chmod +x run_benchmark.sh
   ```

## Advanced Usage

### Running Multiple Iterations

```bash
# Run stress test 3 times with 60-second intervals
for i in {1..3}; do
    echo "Run $i of 3"
    ./run_locust_stress_test.sh
    sleep 60
done
```

### Custom Locust Options

Run Locust directly with custom options:

```bash
# With specific user count and spawn rate
uv run --project api python -m locust -f scripts/stress-test/sse_benchmark.py \
  --host http://localhost:5001 --users 50 --spawn-rate 5

# Generate CSV reports
uv run --project api python -m locust -f scripts/stress-test/sse_benchmark.py \
  --host http://localhost:5001 --csv reports/results

# Run for specific duration
uv run --project api python -m locust -f scripts/stress-test/sse_benchmark.py \
  --host http://localhost:5001 --run-time 5m --headless
```

### Comparing Results

```bash
# Compare multiple stress test runs
ls -la reports/stress_test_*.txt | tail -5
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

Locust was chosen over Drill for this stress test because:

1. **Proper SSE Support**: Correctly handles streaming responses without premature closure
1. **Custom Metrics**: Can track SSE-specific metrics like TTFE and stream duration
1. **Web UI**: Real-time monitoring and control via web interface
1. **Python Integration**: Seamlessly integrates with existing Python setup code
1. **Extensibility**: Easy to customize for specific testing scenarios

## Contributing

To improve the stress test suite:

1. Edit `stress_test.yml` for configuration changes
1. Modify `run_locust_stress_test.sh` for workflow improvements
1. Update question sets for better coverage
1. Add new metrics or analysis features
