# Worker Management

Dynamic worker pool for node execution.

## Components

### WorkerPool

Manages worker thread lifecycle.

- `start/stop/wait()` - Control workers
- `scale_up/down()` - Adjust pool size
- `get_worker_count()` - Current count

### WorkerFactory

Creates workers with Flask context.

- `create_worker()` - Build with dependencies
- Preserves request context

### DynamicScaler

Determines scaling decisions.

- `min/max_workers` - Pool bounds
- `scale_up_threshold` - Queue trigger
- `should_scale_up/down()` - Check conditions

### ActivityTracker

Tracks worker activity.

- `track_activity(worker_id)` - Record activity
- `get_idle_workers(threshold)` - Find idle
- `get_active_count()` - Active count

## Usage

```python
scaler = DynamicScaler(
    min_workers=2,
    max_workers=10,
    scale_up_threshold=5
)

pool = WorkerPool(
    ready_queue=ready_queue,
    worker_factory=factory,
    dynamic_scaler=scaler
)

pool.start()

# Scale based on load
if scaler.should_scale_up(queue_size, active):
    pool.scale_up()

pool.stop()
```

## Scaling Strategy

**Scale Up**: Queue size > threshold AND workers < max
**Scale Down**: Idle workers exist AND workers > min

## Parameters

- `min_workers` - Minimum pool size
- `max_workers` - Maximum pool size
- `scale_up_threshold` - Queue trigger
- `scale_down_threshold` - Idle seconds

## Flask Context

WorkerFactory preserves request context across threads:

```python
context_vars = {"request_id": request.id}
# Workers receive same context
```
