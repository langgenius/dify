"""add workflow performance analytics tables

Revision ID: a1b2c3d4e5f6
Revises: cf8f4fc45278
Create Date: 2024-11-24 08:00:00.000000

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = 'cf8f4fc45278'
branch_labels = None
depends_on = None


def upgrade():
    # Create workflow_performance_metrics table
    op.create_table(
        'workflow_performance_metrics',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('app_id', sa.String(length=36), nullable=False),
        sa.Column('workflow_id', sa.String(length=36), nullable=False),
        sa.Column('workflow_run_id', sa.String(length=36), nullable=False),
        sa.Column('total_execution_time', sa.Float(), nullable=False, comment='Total execution time in seconds'),
        sa.Column('node_count', sa.Integer(), nullable=False, comment='Number of nodes executed'),
        sa.Column('successful_nodes', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('failed_nodes', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('cached_nodes', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('total_tokens_used', sa.Integer(), nullable=True, comment='Total LLM tokens consumed'),
        sa.Column('total_tokens_cost', sa.Float(), nullable=True, comment='Estimated cost in USD'),
        sa.Column('peak_memory_mb', sa.Float(), nullable=True, comment='Peak memory usage in MB'),
        sa.Column('avg_node_execution_time', sa.Float(), nullable=False, comment='Average node execution time'),
        sa.Column('slowest_node_id', sa.String(length=255), nullable=True),
        sa.Column('slowest_node_time', sa.Float(), nullable=True),
        sa.Column('cache_hit_rate', sa.Float(), nullable=False, server_default=sa.text('0.0'), comment='Percentage of cache hits'),
        sa.Column('execution_status', sa.String(length=50), nullable=False, comment='succeeded, failed, partial'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workflow_run_id', name='uq_workflow_run_id')
    )
    
    op.create_index('idx_wf_perf_workflow_id', 'workflow_performance_metrics', ['workflow_id'])
    op.create_index('idx_wf_perf_app_id', 'workflow_performance_metrics', ['app_id'])
    op.create_index('idx_wf_perf_created_at', 'workflow_performance_metrics', ['created_at'])
    op.create_index('idx_wf_perf_workflow_created', 'workflow_performance_metrics', ['workflow_id', 'created_at'])

    # Create workflow_node_performance table
    op.create_table(
        'workflow_node_performance',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workflow_run_id', sa.String(length=36), nullable=False),
        sa.Column('node_id', sa.String(length=255), nullable=False),
        sa.Column('node_execution_id', sa.String(length=36), nullable=False),
        sa.Column('node_type', sa.String(length=100), nullable=False),
        sa.Column('node_title', sa.String(length=255), nullable=True),
        sa.Column('execution_time', sa.Float(), nullable=False, comment='Execution time in seconds'),
        sa.Column('start_time', sa.DateTime(), nullable=False),
        sa.Column('end_time', sa.DateTime(), nullable=False),
        sa.Column('tokens_used', sa.Integer(), nullable=True),
        sa.Column('tokens_cost', sa.Float(), nullable=True),
        sa.Column('memory_used_mb', sa.Float(), nullable=True),
        sa.Column('is_cached', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('cache_key', sa.String(length=255), nullable=True),
        sa.Column('retry_count', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('status', sa.String(length=50), nullable=False, comment='succeeded, failed, skipped'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('input_size_bytes', sa.Integer(), nullable=True),
        sa.Column('output_size_bytes', sa.Integer(), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workflow_run_id', 'node_execution_id', name='uq_workflow_node_execution')
    )
    
    op.create_index('idx_wf_node_perf_workflow_run', 'workflow_node_performance', ['workflow_run_id'])
    op.create_index('idx_wf_node_perf_node_id', 'workflow_node_performance', ['node_id'])
    op.create_index('idx_wf_node_perf_node_type', 'workflow_node_performance', ['node_type'])
    op.create_index('idx_wf_node_perf_created_at', 'workflow_node_performance', ['created_at'])

    # Create workflow_optimization_recommendations table
    op.create_table(
        'workflow_optimization_recommendations',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('app_id', sa.String(length=36), nullable=False),
        sa.Column('workflow_id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('category', sa.String(length=50), nullable=False, comment='performance, cost, reliability, scalability, best_practice'),
        sa.Column('severity', sa.String(length=20), nullable=False, comment='info, low, medium, high, critical'),
        sa.Column('estimated_improvement', sa.String(length=255), nullable=True, comment="e.g., '30% faster', '20% cost reduction'"),
        sa.Column('affected_nodes', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('recommendation_steps', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('code_example', sa.Text(), nullable=True),
        sa.Column('documentation_link', sa.String(length=500), nullable=True),
        sa.Column('supporting_metrics', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('sample_workflow_runs', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default=sa.text("'active'"), comment='active, dismissed, implemented, obsolete'),
        sa.Column('dismissed_by', sa.String(length=36), nullable=True),
        sa.Column('dismissed_at', sa.DateTime(), nullable=True),
        sa.Column('dismissed_reason', sa.Text(), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_index('idx_wf_opt_workflow_id', 'workflow_optimization_recommendations', ['workflow_id'])
    op.create_index('idx_wf_opt_app_id', 'workflow_optimization_recommendations', ['app_id'])
    op.create_index('idx_wf_opt_severity', 'workflow_optimization_recommendations', ['severity'])
    op.create_index('idx_wf_opt_category', 'workflow_optimization_recommendations', ['category'])
    op.create_index('idx_wf_opt_status', 'workflow_optimization_recommendations', ['status'])
    op.create_index('idx_wf_opt_created_at', 'workflow_optimization_recommendations', ['created_at'])

    # Create workflow_cache_entries table
    op.create_table(
        'workflow_cache_entries',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('cache_key', sa.String(length=255), nullable=False),
        sa.Column('node_type', sa.String(length=100), nullable=False),
        sa.Column('node_config_hash', sa.String(length=64), nullable=False, comment='Hash of node configuration'),
        sa.Column('input_hash', sa.String(length=64), nullable=False, comment='Hash of input data'),
        sa.Column('output_data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('output_size_bytes', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('last_accessed_at', sa.DateTime(), nullable=False),
        sa.Column('hit_count', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('original_execution_time', sa.Float(), nullable=False, comment='Original execution time in seconds'),
        sa.Column('total_time_saved', sa.Float(), nullable=False, server_default=sa.text('0.0'), comment='Cumulative time saved'),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_index('idx_wf_cache_key', 'workflow_cache_entries', ['cache_key'], unique=True)
    op.create_index('idx_wf_cache_node_type', 'workflow_cache_entries', ['node_type'])
    op.create_index('idx_wf_cache_expires_at', 'workflow_cache_entries', ['expires_at'])
    op.create_index('idx_wf_cache_hit_count', 'workflow_cache_entries', ['hit_count'])
    op.create_index('idx_wf_cache_last_accessed', 'workflow_cache_entries', ['last_accessed_at'])

    # Create workflow_performance_trends table
    op.create_table(
        'workflow_performance_trends',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('app_id', sa.String(length=36), nullable=False),
        sa.Column('workflow_id', sa.String(length=36), nullable=False),
        sa.Column('period_start', sa.DateTime(), nullable=False),
        sa.Column('period_end', sa.DateTime(), nullable=False),
        sa.Column('period_type', sa.String(length=20), nullable=False, comment='hourly, daily, weekly, monthly'),
        sa.Column('metric_type', sa.String(length=50), nullable=False),
        sa.Column('metric_value', sa.Float(), nullable=False),
        sa.Column('min_value', sa.Float(), nullable=False),
        sa.Column('max_value', sa.Float(), nullable=False),
        sa.Column('avg_value', sa.Float(), nullable=False),
        sa.Column('median_value', sa.Float(), nullable=True),
        sa.Column('std_deviation', sa.Float(), nullable=True),
        sa.Column('sample_count', sa.Integer(), nullable=False),
        sa.Column('percentile_95', sa.Float(), nullable=True),
        sa.Column('percentile_99', sa.Float(), nullable=True),
        sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workflow_id', 'period_start', 'metric_type', name='uq_workflow_period_metric')
    )
    
    op.create_index('idx_wf_trend_workflow_id', 'workflow_performance_trends', ['workflow_id'])
    op.create_index('idx_wf_trend_period', 'workflow_performance_trends', ['period_start', 'period_end'])
    op.create_index('idx_wf_trend_metric_type', 'workflow_performance_trends', ['metric_type'])


def downgrade():
    # Drop tables in reverse order
    op.drop_table('workflow_performance_trends')
    op.drop_table('workflow_cache_entries')
    op.drop_table('workflow_optimization_recommendations')
    op.drop_table('workflow_node_performance')
    op.drop_table('workflow_performance_metrics')
