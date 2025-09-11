# Dify Benchmark Suite

This benchmark suite tests the performance of Dify workflow execution using the [drill](https://github.com/fcsonline/drill) load testing tool.

## Prerequisites

1. **Install drill**:
   ```bash
   # Using cargo
   cargo install drill
   
   # Or download binary from GitHub releases
   # https://github.com/fcsonline/drill/releases
   ```

2. **Complete Dify setup**:
   ```bash
   # Run the complete setup
   python scripts/benchmark/setup/setup_all.py
   ```

3. **Ensure services are running**:
   - Dify API server on port 5001 (`./dev/start-api`)
   - Mock OpenAI server on port 5004 (`python scripts/benchmark/setup/mock_openai_server.py`)

## Benchmark Configuration

The benchmark is configured in `drill_config.yml`:

- **Concurrency**: 10 concurrent users
- **Iterations**: 100 total requests
- **Ramp-up**: 5 seconds to start all threads
- **Response mode**: Blocking (synchronous)
- **Test data**: 10 rotating question prompts

## Running the Benchmark

### Quick Start

```bash
# Run the automated benchmark script
python scripts/benchmark/run_benchmark.py
```

This script will:
1. Check that required services are running
2. Prepare the benchmark configuration with your API token
3. Execute the drill benchmark
4. Generate a timestamped report

### Manual Steps

1. **Prepare the benchmark configuration**:
   ```bash
   python scripts/benchmark/prepare_benchmark.py
   ```
   This injects your API token into the drill configuration.

2. **Run drill directly**:
   ```bash
   # Basic run
   drill --benchmark scripts/benchmark/benchmark.yml
   
   # With statistics
   drill --benchmark scripts/benchmark/benchmark.yml --stats
   
   # Quiet mode (results only)
   drill --benchmark scripts/benchmark/benchmark.yml --quiet
   
   # Custom iterations
   drill --benchmark scripts/benchmark/benchmark.yml --iterations 500
   ```

## Benchmark Metrics

The benchmark measures:
- **Response times**: Min, max, average, percentiles (p50, p90, p95, p99)
- **Throughput**: Requests per second
- **Success rate**: Percentage of successful requests
- **Concurrency**: Actual concurrent connections

## Output Files

- `benchmark_report_YYYYMMDD_HHMMSS.txt`: Timestamped benchmark results
- `benchmark.yml`: Temporary config with injected API token (auto-cleaned)

## Customizing the Benchmark

Edit `drill_config.yml` to adjust:

```yaml
concurrency: 20          # Increase concurrent users
iterations: 500          # More total requests
rampup: 10              # Slower ramp-up period

plan:
  - name: 'Dify Workflow Execution'
    request:
      # Modify request parameters
      body: |
        {
          "response_mode": "streaming"  # Change to streaming mode
        }
```

### Adding Custom Questions

Modify the `assign` section in `drill_config.yml`:

```yaml
assign:
  question:
    - "Your custom question 1"
    - "Your custom question 2"
    # Add more questions...
```

## Troubleshooting

### Common Issues

1. **"drill is not installed"**
   - Install drill using cargo or download the binary

2. **"No API token found"**
   - Run the setup scripts first: `python scripts/benchmark/setup/setup_all.py`

3. **"Services not running"**
   - Start Dify API: `./dev/start-api`
   - Start Mock OpenAI: `python scripts/benchmark/setup/mock_openai_server.py`

4. **Connection errors**
   - Verify services are running on correct ports (5001 and 5004)
   - Check firewall settings

## Performance Tuning

For better benchmark results:

1. **System limits**: Increase file descriptor limits
   ```bash
   ulimit -n 4096
   ```

2. **Network tuning**: Adjust TCP settings for high concurrency

3. **Mock server**: The mock OpenAI server has minimal latency. For realistic tests, add delays:
   ```python
   # In mock_openai_server.py
   import time
   time.sleep(0.5)  # Simulate processing time
   ```

## Interpreting Results

Example output:
```
Concurrency: 10
Iterations: 100
Ramp-up: 5 seconds

Response Times:
  Min: 45ms
  Max: 320ms
  Mean: 125ms
  p50: 110ms
  p90: 180ms
  p95: 220ms
  p99: 310ms

Throughput: 75 req/sec
Success Rate: 100%
```

Key metrics to watch:
- **p95/p99**: 95th/99th percentile response times (most users experience)
- **Throughput**: System capacity (requests/second)
- **Success Rate**: Should be close to 100%