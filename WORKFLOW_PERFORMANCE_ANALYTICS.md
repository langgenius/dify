# Workflow Performance Analytics & Optimization System

## Overview

The Workflow Performance Analytics & Optimization System is a comprehensive feature that provides deep insights into workflow execution performance, intelligent caching, and AI-powered optimization recommendations. This system helps users identify bottlenecks, reduce costs, and improve the reliability of their AI workflows.

## Features

### 1. Performance Profiling & Metrics Collection

Track detailed performance metrics at both workflow and node levels:

- **Workflow-level metrics:**
  - Total execution time
  - Node count and success/failure rates
  - Token usage and costs
  - Cache hit rates
  - Memory usage

- **Node-level metrics:**
  - Individual node execution times
  - Resource consumption per node
  - Retry counts and error rates
  - Input/output data sizes

### 2. Intelligent Caching Layer

Automatically cache node execution results to improve performance:

- **Smart cache key generation** based on node configuration and inputs
- **Configurable TTL** per node type
- **Cache hit tracking** and performance metrics
- **Automatic cleanup** of expired entries
- **Cache invalidation** strategies

### 3. AI-Powered Optimization Advisor

Generate actionable recommendations to improve workflows:

- **Performance optimizations:** Identify and fix slow nodes
- **Cost reduction:** Optimize token usage and model selection
- **Reliability improvements:** Fix error-prone nodes
- **Best practices:** Suggest architectural improvements
- **Parallelization opportunities:** Identify nodes that can run concurrently

### 4. Performance Trend Analysis

Track performance over time:

- **Historical metrics** aggregated by hour, day, week, or month
- **Statistical analysis** including percentiles and standard deviation
- **Trend detection** to identify performance degradation
- **Comparative analysis** across time periods

## Architecture

### Database Models

#### WorkflowPerformanceMetrics
Stores aggregated performance data for each workflow execution.

```python
- id: Unique identifier
- app_id: Application ID
- workflow_id: Workflow ID
- workflow_run_id: Unique run ID
- total_execution_time: Total time in seconds
- node_count: Number of nodes executed
- successful_nodes: Count of successful nodes
- failed_nodes: Count of failed nodes
- cached_nodes: Count of cached nodes
- total_tokens_used: LLM tokens consumed
- total_tokens_cost: Estimated cost in USD
- cache_hit_rate: Percentage of cache hits
- execution_status: succeeded/failed/partial
```

#### WorkflowNodePerformance
Stores detailed metrics for individual node executions.

```python
- id: Unique identifier
- workflow_run_id: Parent workflow run
- node_id: Node identifier
- node_execution_id: Unique execution ID
- node_type: Type of node (llm, code, etc.)
- execution_time: Time in seconds
- tokens_used: LLM tokens (if applicable)
- is_cached: Whether result was cached
- retry_count: Number of retries
- status: succeeded/failed/skipped
```

#### WorkflowOptimizationRecommendation
Stores AI-generated optimization recommendations.

```python
- id: Unique identifier
- app_id: Application ID
- workflow_id: Workflow ID
- title: Recommendation title
- description: Detailed description
- category: performance/cost/reliability/scalability/best_practice
- severity: info/low/medium/high/critical
- estimated_improvement: Expected benefit
- affected_nodes: List of node IDs
- recommendation_steps: Actionable steps
- code_example: Example implementation
- status: active/dismissed/implemented/obsolete
```

#### WorkflowCacheEntry
Stores cached node execution results.

```python
- id: Unique identifier
- cache_key: Unique cache key
- node_type: Type of node
- output_data: Cached result (JSONB)
- expires_at: Expiration timestamp
- hit_count: Number of cache hits
- original_execution_time: Original execution time
- total_time_saved: Cumulative time saved
```

#### WorkflowPerformanceTrend
Stores aggregated performance trends over time.

```python
- id: Unique identifier
- workflow_id: Workflow ID
- period_start: Period start time
- period_end: Period end time
- period_type: hourly/daily/weekly/monthly
- metric_type: Type of metric
- metric_value: Metric value
- min_value, max_value, avg_value: Statistical data
- percentile_95, percentile_99: Percentile values
```

### Services

#### WorkflowPerformanceService
Main service for performance tracking and analysis.

**Key Methods:**
- `record_workflow_execution()`: Record workflow-level metrics
- `record_node_execution()`: Record node-level metrics
- `get_workflow_performance_summary()`: Get performance summary
- `get_node_performance_breakdown()`: Get node-level breakdown
- `identify_bottlenecks()`: Identify performance bottlenecks
- `create_optimization_recommendation()`: Create recommendations
- `get_active_recommendations()`: Retrieve active recommendations
- `dismiss_recommendation()`: Dismiss a recommendation

#### WorkflowCacheService
Service for managing workflow node result caching.

**Key Methods:**
- `generate_cache_key()`: Generate unique cache key
- `get_cached_result()`: Retrieve cached result
- `store_cached_result()`: Store result in cache
- `invalidate_cache()`: Invalidate cache entries
- `cleanup_expired_cache()`: Remove expired entries
- `get_cache_statistics()`: Get cache performance stats
- `should_cache_node()`: Determine if node should be cached

#### WorkflowOptimizationAdvisor
Service for generating AI-powered optimization recommendations.

**Key Methods:**
- `analyze_and_recommend()`: Analyze workflow and generate recommendations
- `_analyze_slow_nodes()`: Identify slow nodes
- `_analyze_cache_opportunities()`: Find caching opportunities
- `_analyze_error_patterns()`: Identify error-prone nodes
- `_analyze_token_usage()`: Optimize token usage
- `_analyze_parallel_opportunities()`: Find parallelization opportunities
- `_analyze_retry_patterns()`: Optimize retry logic

## API Endpoints

### Performance Summary
```
GET /apps/{app_id}/workflows/{workflow_id}/performance/summary?days=7
```
Returns aggregated performance metrics for the specified time period.

### Node Performance Breakdown
```
GET /apps/{app_id}/workflows/{workflow_id}/performance/nodes?days=7
```
Returns performance breakdown by node type.

### Identify Bottlenecks
```
GET /apps/{app_id}/workflows/{workflow_id}/performance/bottlenecks?days=7
```
Identifies performance bottlenecks in the workflow.

### Get Recommendations
```
GET /apps/{app_id}/workflows/{workflow_id}/optimization/recommendations?severity=high&category=performance
```
Retrieves active optimization recommendations.

### Generate Recommendations
```
POST /apps/{app_id}/workflows/{workflow_id}/optimization/recommendations
{
  "days": 7
}
```
Analyzes workflow and generates new optimization recommendations.

### Dismiss Recommendation
```
POST /apps/{app_id}/workflows/{workflow_id}/optimization/recommendations/{recommendation_id}/dismiss
{
  "reason": "Not applicable to our use case"
}
```
Dismisses an optimization recommendation.

### Cache Statistics
```
GET /apps/{app_id}/workflows/{workflow_id}/cache/statistics?days=7&node_type=llm
```
Returns cache performance statistics.

### Top Cached Nodes
```
GET /apps/{app_id}/workflows/{workflow_id}/cache/top-nodes?limit=10&days=7
```
Returns the most frequently cached nodes.

### Invalidate Cache
```
POST /apps/{app_id}/workflows/{workflow_id}/cache/invalidate
{
  "node_type": "llm",
  "older_than_hours": 48
}
```
Invalidates cache entries based on criteria.

### Cleanup Expired Cache
```
POST /apps/{app_id}/workflows/{workflow_id}/cache/cleanup
```
Removes expired cache entries.

## Usage Examples

### Recording Performance Metrics

```python
from services.workflow_performance_service import WorkflowPerformanceService

# Record workflow execution
metrics = WorkflowPerformanceService.record_workflow_execution(
    app_id="app-123",
    workflow_id="workflow-456",
    workflow_run_id="run-789",
    total_execution_time=15.5,
    node_count=10,
    successful_nodes=9,
    failed_nodes=1,
    cached_nodes=3,
    total_tokens_used=5000,
    total_tokens_cost=0.25,
    cache_hit_rate=30.0,
    execution_status="succeeded",
)

# Record node execution
node_perf = WorkflowPerformanceService.record_node_execution(
    workflow_run_id="run-789",
    node_id="node-1",
    node_execution_id="exec-1",
    node_type="llm",
    node_title="Generate Response",
    execution_time=5.0,
    start_time=start_time,
    end_time=end_time,
    tokens_used=2000,
    tokens_cost=0.10,
    is_cached=False,
    status="succeeded",
)
```

### Using the Cache Service

```python
from services.workflow_cache_service import WorkflowCacheService

# Generate cache key
cache_key = WorkflowCacheService.generate_cache_key(
    node_type="llm",
    node_config={"model": "gpt-4", "temperature": 0.7},
    input_data={"prompt": "Hello, world!"},
)

# Try to get cached result
cached_result = WorkflowCacheService.get_cached_result(cache_key)

if cached_result is None:
    # Execute node and cache result
    result = execute_node()
    
    WorkflowCacheService.store_cached_result(
        cache_key=cache_key,
        node_type="llm",
        node_config=node_config,
        input_data=input_data,
        output_data=result,
        execution_time=5.0,
        ttl_hours=24,
    )
else:
    # Use cached result
    result = cached_result
```

### Generating Optimization Recommendations

```python
from services.workflow_optimization_advisor import WorkflowOptimizationAdvisor

# Analyze workflow and generate recommendations
recommendations = WorkflowOptimizationAdvisor.analyze_and_recommend(
    app_id="app-123",
    workflow_id="workflow-456",
    days=7,
)

# Process recommendations
for rec in recommendations:
    print(f"[{rec.severity}] {rec.title}")
    print(f"Category: {rec.category}")
    print(f"Estimated improvement: {rec.estimated_improvement}")
    print(f"Steps:")
    for step in rec.recommendation_steps:
        print(f"  - {step}")
```

## Configuration

### Cache TTL Settings

Default cache TTL (in hours) for different node types:

```python
DEFAULT_TTL_HOURS = {
    "llm": 24,              # LLM results cached for 24 hours
    "http_request": 6,      # HTTP requests cached for 6 hours
    "code": 48,             # Code execution cached for 48 hours
    "tool": 12,             # Tool results cached for 12 hours
    "knowledge_retrieval": 24,  # Knowledge retrieval cached for 24 hours
    "template_transform": 72,   # Template transforms cached for 72 hours
    "default": 24,          # Default TTL for other node types
}
```

### Caching Criteria

Nodes are cached if:
- Execution time > 0.1 seconds
- Node type is cacheable (not start, end, answer, human_input)
- Caching is not explicitly disabled in node configuration

## Performance Impact

### Benefits

- **Reduced execution time:** Cache hits can reduce execution time by 90-99%
- **Cost savings:** Cached LLM responses eliminate redundant API calls
- **Improved reliability:** Cached results provide fallback for transient failures
- **Better user experience:** Faster response times for repeated queries

### Overhead

- **Storage:** Approximately 1-10 KB per cached entry (depending on output size)
- **Database queries:** 1-2 additional queries per node execution for cache lookup
- **Memory:** Minimal impact (cache data stored in database, not memory)

## Monitoring & Maintenance

### Recommended Maintenance Tasks

1. **Daily:** Run cache cleanup to remove expired entries
2. **Weekly:** Review optimization recommendations
3. **Monthly:** Analyze performance trends and adjust cache TTLs
4. **Quarterly:** Review and archive old performance metrics

### Monitoring Queries

```sql
-- Check cache efficiency
SELECT 
    node_type,
    COUNT(*) as entries,
    SUM(hit_count) as total_hits,
    AVG(hit_count) as avg_hits,
    SUM(total_time_saved) as time_saved
FROM workflow_cache_entries
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY node_type
ORDER BY total_hits DESC;

-- Identify slow workflows
SELECT 
    workflow_id,
    COUNT(*) as runs,
    AVG(total_execution_time) as avg_time,
    MAX(total_execution_time) as max_time
FROM workflow_performance_metrics
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY workflow_id
HAVING AVG(total_execution_time) > 10
ORDER BY avg_time DESC;

-- Check recommendation adoption
SELECT 
    category,
    severity,
    status,
    COUNT(*) as count
FROM workflow_optimization_recommendations
GROUP BY category, severity, status
ORDER BY category, severity;
```

## Migration

To apply the database migrations:

```bash
# Run the migration
uv run --project api alembic upgrade head

# Verify migration
uv run --project api alembic current
```

## Testing

Run the test suite:

```bash
# Run all performance-related tests
uv run --project api pytest tests/unit_tests/services/test_workflow_performance_service.py
uv run --project api pytest tests/unit_tests/services/test_workflow_cache_service.py

# Run with coverage
uv run --project api pytest --cov=services.workflow_performance_service --cov=services.workflow_cache_service
```

## Future Enhancements

1. **Real-time monitoring dashboard:** Live performance metrics visualization
2. **Automated optimization:** Automatically apply low-risk optimizations
3. **A/B testing:** Compare performance of different workflow configurations
4. **Predictive analytics:** Forecast resource usage and costs
5. **Custom metrics:** Allow users to define custom performance metrics
6. **Integration with external monitoring tools:** Export metrics to Prometheus, Datadog, etc.

## Contributing

When contributing to this feature:

1. Follow the existing code structure and naming conventions
2. Add comprehensive tests for new functionality
3. Update documentation for API changes
4. Ensure migrations are reversible
5. Consider performance impact of new features

## License

This feature is part of the Dify project and follows the same license terms.
