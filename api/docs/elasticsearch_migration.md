# Elasticsearch Migration Guide

This guide explains how to migrate workflow log data from PostgreSQL to Elasticsearch for better performance and scalability.

## Overview

The Elasticsearch integration provides:

- **High-performance log storage**: Better suited for time-series log data
- **Advanced search capabilities**: Full-text search and complex queries
- **Scalability**: Horizontal scaling for large datasets
- **Time-series optimization**: Date-based index rotation for efficient storage
- **Multi-tenant isolation**: Separate indices per tenant for data isolation

## Architecture

The migration involves four main log tables:

1. **workflow_runs**: Core workflow execution records
2. **workflow_app_logs**: Application-level workflow logs
3. **workflow_node_executions**: Individual node execution records
4. **workflow_node_execution_offload**: Large data offloaded to storage

## Configuration

### Environment Variables

Add the following to your `.env` file:

```bash
# Enable Elasticsearch
ELASTICSEARCH_ENABLED=true

# Elasticsearch connection
ELASTICSEARCH_HOSTS=["http://localhost:9200"]
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=your_password

# SSL configuration (optional)
ELASTICSEARCH_USE_SSL=false
ELASTICSEARCH_VERIFY_CERTS=true
ELASTICSEARCH_CA_CERTS=/path/to/ca.crt

# Performance settings
ELASTICSEARCH_TIMEOUT=30
ELASTICSEARCH_MAX_RETRIES=3
ELASTICSEARCH_INDEX_PREFIX=dify
ELASTICSEARCH_RETENTION_DAYS=30
```

### Repository Configuration

Update your configuration to use Elasticsearch repositories:

```bash
# Core repositories
CORE_WORKFLOW_EXECUTION_REPOSITORY=core.repositories.elasticsearch_workflow_execution_repository.ElasticsearchWorkflowExecutionRepository
CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY=core.repositories.elasticsearch_workflow_node_execution_repository.ElasticsearchWorkflowNodeExecutionRepository

# API repositories
API_WORKFLOW_RUN_REPOSITORY=repositories.elasticsearch_api_workflow_run_repository.ElasticsearchAPIWorkflowRunRepository
```

## Migration Process

### 1. Setup Elasticsearch

First, ensure Elasticsearch is running and accessible:

```bash
# Check Elasticsearch status
curl -X GET "localhost:9200/_cluster/health?pretty"
```

### 2. Test Configuration

Verify your Dify configuration:

```bash
# Check Elasticsearch connection
flask elasticsearch status
```

### 3. Dry Run Migration

Perform a dry run to estimate migration scope:

```bash
# Dry run for all data
flask elasticsearch migrate --dry-run

# Dry run for specific tenant
flask elasticsearch migrate --tenant-id tenant-123 --dry-run

# Dry run for date range
flask elasticsearch migrate --start-date 2024-01-01 --end-date 2024-01-31 --dry-run
```

### 4. Incremental Migration

Start with recent data and work backwards:

```bash
# Migrate last 7 days
flask elasticsearch migrate --start-date $(date -d '7 days ago' +%Y-%m-%d)

# Migrate specific data types
flask elasticsearch migrate --data-type workflow_runs
flask elasticsearch migrate --data-type app_logs
flask elasticsearch migrate --data-type node_executions
```

### 5. Full Migration

Migrate all historical data:

```bash
# Migrate all data (use appropriate batch size)
flask elasticsearch migrate --batch-size 500

# Migrate specific tenant
flask elasticsearch migrate --tenant-id tenant-123
```

### 6. Validation

Validate the migrated data:

```bash
# Validate migration for tenant
flask elasticsearch validate --tenant-id tenant-123 --sample-size 1000
```

### 7. Switch Configuration

Once validation passes, update your configuration to use Elasticsearch repositories and restart the application.

### 8. Cleanup (Optional)

After successful migration and validation, clean up old PostgreSQL data:

```bash
# Dry run cleanup
flask elasticsearch cleanup-pg --tenant-id tenant-123 --before-date 2024-01-01 --dry-run

# Actual cleanup (CAUTION: This cannot be undone)
flask elasticsearch cleanup-pg --tenant-id tenant-123 --before-date 2024-01-01
```

## Index Management

### Index Structure

Elasticsearch indices are organized as:
- `dify-workflow-runs-{tenant_id}-{YYYY.MM}`
- `dify-workflow-app-logs-{tenant_id}-{YYYY.MM}`
- `dify-workflow-node-executions-{tenant_id}-{YYYY.MM}`

### Retention Policy

Configure automatic cleanup of old indices:

```python
# In your scheduled tasks
from services.elasticsearch_migration_service import ElasticsearchMigrationService

migration_service = ElasticsearchMigrationService()

# Clean up indices older than 30 days
for tenant_id in get_all_tenant_ids():
    migration_service._workflow_run_repo.cleanup_old_indices(tenant_id, retention_days=30)
    migration_service._app_log_repo.cleanup_old_indices(tenant_id, retention_days=30)
```

## Performance Tuning

### Elasticsearch Settings

Optimize Elasticsearch for log data:

```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0,
    "index.refresh_interval": "30s",
    "index.mapping.total_fields.limit": 2000
  }
}
```

### Batch Processing

Adjust batch sizes based on your system:

```bash
# Smaller batches for limited memory
flask elasticsearch migrate --batch-size 100

# Larger batches for high-performance systems
flask elasticsearch migrate --batch-size 5000
```

## Monitoring

### Check Migration Progress

```bash
# Monitor Elasticsearch status
flask elasticsearch status

# Check specific tenant indices
flask elasticsearch status --tenant-id tenant-123
```

### Query Performance

Monitor query performance in your application logs and Elasticsearch slow query logs.

## Troubleshooting

### Common Issues

1. **Connection Timeout**
   - Increase `ELASTICSEARCH_TIMEOUT`
   - Check network connectivity
   - Verify Elasticsearch is running

2. **Memory Issues**
   - Reduce batch size
   - Increase JVM heap size for Elasticsearch
   - Process data in smaller date ranges

3. **Index Template Conflicts**
   - Delete existing templates: `DELETE _index_template/dify-*-template`
   - Restart migration

4. **Data Validation Failures**
   - Check Elasticsearch logs for indexing errors
   - Verify data integrity in PostgreSQL
   - Re-run migration for failed records

### Recovery

If migration fails:

1. Check logs for specific errors
2. Fix configuration issues
3. Resume migration from last successful point
4. Use date ranges to process data incrementally

## Best Practices

1. **Test First**: Always run dry runs and validate on staging
2. **Incremental Migration**: Start with recent data, migrate incrementally
3. **Monitor Resources**: Watch CPU, memory, and disk usage during migration
4. **Backup**: Ensure PostgreSQL backups before cleanup
5. **Gradual Rollout**: Switch tenants to Elasticsearch gradually
6. **Index Lifecycle**: Implement proper index rotation and cleanup

## Example Migration Script

```bash
#!/bin/bash

# Complete migration workflow
TENANT_ID="tenant-123"
START_DATE="2024-01-01"

echo "Starting Elasticsearch migration for $TENANT_ID"

# 1. Dry run
echo "Performing dry run..."
flask elasticsearch migrate --tenant-id $TENANT_ID --start-date $START_DATE --dry-run

# 2. Migrate data
echo "Migrating data..."
flask elasticsearch migrate --tenant-id $TENANT_ID --start-date $START_DATE --batch-size 1000

# 3. Validate
echo "Validating migration..."
flask elasticsearch validate --tenant-id $TENANT_ID --sample-size 500

# 4. Check status
echo "Checking status..."
flask elasticsearch status --tenant-id $TENANT_ID

echo "Migration completed for $TENANT_ID"
```

## Support

For issues or questions:
1. Check application logs for detailed error messages
2. Review Elasticsearch cluster logs
3. Verify configuration settings
4. Test with smaller datasets first
