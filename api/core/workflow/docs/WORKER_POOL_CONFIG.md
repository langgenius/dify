# GraphEngine Worker Pool Configuration

## Overview

The GraphEngine now supports **dynamic worker pool management** to optimize performance and resource usage. Instead of a fixed 10-worker pool, the engine can:

1. **Start with optimal worker count** based on graph complexity
1. **Scale up** when workload increases
1. **Scale down** when workers are idle
1. **Respect configurable min/max limits**

## Benefits

- **Resource Efficiency**: Uses fewer workers for simple sequential workflows
- **Better Performance**: Scales up for parallel-heavy workflows
- **Gevent Optimization**: Works efficiently with Gevent's greenlet model
- **Memory Savings**: Reduces memory footprint for simple workflows

## Configuration

### Configuration Variables (via dify_config)

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAPH_ENGINE_MIN_WORKERS` | 1 | Minimum number of workers per engine |
| `GRAPH_ENGINE_MAX_WORKERS` | 10 | Maximum number of workers per engine |
| `GRAPH_ENGINE_SCALE_UP_THRESHOLD` | 3 | Queue depth that triggers scale up |
| `GRAPH_ENGINE_SCALE_DOWN_IDLE_TIME` | 5.0 | Seconds of idle time before scaling down |

### Example Configurations

#### Low-Resource Environment

```bash
export GRAPH_ENGINE_MIN_WORKERS=1
export GRAPH_ENGINE_MAX_WORKERS=3
export GRAPH_ENGINE_SCALE_UP_THRESHOLD=2
export GRAPH_ENGINE_SCALE_DOWN_IDLE_TIME=3.0
```

#### High-Performance Environment

```bash
export GRAPH_ENGINE_MIN_WORKERS=2
export GRAPH_ENGINE_MAX_WORKERS=20
export GRAPH_ENGINE_SCALE_UP_THRESHOLD=5
export GRAPH_ENGINE_SCALE_DOWN_IDLE_TIME=10.0
```

#### Default (Balanced)

```bash
# Uses defaults: min=1, max=10, threshold=3, idle_time=5.0
```

## How It Works

### Initial Worker Calculation

The engine analyzes the graph structure at startup:

- **Sequential graphs** (no branches): 1 worker
- **Limited parallelism** (few branches): 2 workers
- **Moderate parallelism**: 3 workers
- **High parallelism** (many branches): 5 workers

### Dynamic Scaling

During execution:

1. **Scale Up** triggers when:

   - Queue depth exceeds `SCALE_UP_THRESHOLD`
   - All workers are busy and queue has items
   - Not at `MAX_WORKERS` limit

1. **Scale Down** triggers when:

   - Worker idle for more than `SCALE_DOWN_IDLE_TIME` seconds
   - Above `MIN_WORKERS` limit

### Gevent Compatibility

Since Gevent patches threading to use greenlets:

- Workers are lightweight coroutines, not OS threads
- Dynamic scaling has minimal overhead
- Can efficiently handle many concurrent workers

## Migration Guide

### Before (Fixed 10 Workers)

```python
# Every GraphEngine instance created 10 workers
# Resource waste for simple workflows
# No adaptation to workload
```

### After (Dynamic Workers)

```python
# GraphEngine creates 1-5 initial workers based on graph
# Scales up/down based on workload
# Configurable via environment variables
```

### Backward Compatibility

The default configuration (`max=10`) maintains compatibility with existing deployments. To get the old behavior exactly:

```bash
export GRAPH_ENGINE_MIN_WORKERS=10
export GRAPH_ENGINE_MAX_WORKERS=10
```

## Performance Impact

### Memory Usage

- **Simple workflows**: ~80% reduction (1 vs 10 workers)
- **Complex workflows**: Similar or slightly better

### Execution Time

- **Sequential workflows**: No change
- **Parallel workflows**: Improved with proper scaling
- **Bursty workloads**: Better adaptation

### Example Metrics

| Workflow Type | Old (10 workers) | New (Dynamic) | Improvement |
|--------------|------------------|---------------|-------------|
| Sequential | 10 workers idle | 1 worker active | 90% fewer workers |
| 3-way parallel | 7 workers idle | 3 workers active | 70% fewer workers |
| Heavy parallel | 10 workers busy | 10+ workers (scales up) | Better throughput |

## Monitoring

Log messages indicate scaling activity:

```shell
INFO: GraphEngine initialized with 2 workers (min: 1, max: 10)
INFO: Scaled up workers: 2 -> 3 (queue_depth: 4)
INFO: Scaled down workers: 3 -> 2 (removed 1 idle workers)
```

## Best Practices

1. **Start with defaults** - They work well for most cases
1. **Monitor queue depth** - Adjust `SCALE_UP_THRESHOLD` if queues back up
1. **Consider workload patterns**:
   - Bursty: Lower `SCALE_DOWN_IDLE_TIME`
   - Steady: Higher `SCALE_DOWN_IDLE_TIME`
1. **Test with your workloads** - Measure and tune

## Troubleshooting

### Workers not scaling up

- Check `GRAPH_ENGINE_MAX_WORKERS` limit
- Verify queue depth exceeds threshold
- Check logs for scaling messages

### Workers scaling down too quickly

- Increase `GRAPH_ENGINE_SCALE_DOWN_IDLE_TIME`
- Consider workload patterns

### Out of memory

- Reduce `GRAPH_ENGINE_MAX_WORKERS`
- Check for memory leaks in nodes
