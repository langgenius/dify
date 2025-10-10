# Elasticsearch Factory 配置指南

## 配置您的 .env 文件

请在您的 `dify/api/.env` 文件中添加以下配置：

### 1. Elasticsearch 连接配置

```bash
# 启用 Elasticsearch
ELASTICSEARCH_ENABLED=true

# 连接设置（使用 HTTPS 和认证）
ELASTICSEARCH_HOSTS=["https://localhost:9200"]
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=2gYvv6+O36PGwaVD6yzE

# SSL 设置
ELASTICSEARCH_USE_SSL=true
ELASTICSEARCH_VERIFY_CERTS=false

# 性能设置
ELASTICSEARCH_TIMEOUT=30
ELASTICSEARCH_MAX_RETRIES=3
ELASTICSEARCH_INDEX_PREFIX=dify
ELASTICSEARCH_RETENTION_DAYS=30
```

### 2. Factory 模式配置 - 切换到 Elasticsearch 实现

```bash
# 核心工作流 repositories
CORE_WORKFLOW_EXECUTION_REPOSITORY=core.repositories.elasticsearch_workflow_execution_repository.ElasticsearchWorkflowExecutionRepository
CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY=core.repositories.elasticsearch_workflow_node_execution_repository.ElasticsearchWorkflowNodeExecutionRepository

# API 服务层 repositories
API_WORKFLOW_RUN_REPOSITORY=repositories.elasticsearch_api_workflow_run_repository.ElasticsearchAPIWorkflowRunRepository
```

## 测试配置

配置完成后，重启应用并测试：

```bash
# 检查连接状态
flask elasticsearch status

# 测试迁移（干运行）
flask elasticsearch migrate --dry-run
```

## 四个日志表的 Repository 映射

| 日志表 | Repository 配置 | 说明 |
|--------|----------------|------|
| `workflow_runs` | `API_WORKFLOW_RUN_REPOSITORY` | API 服务层使用 |
| `workflow_node_executions` | `CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY` | 核心工作流使用 |
| `workflow_app_logs` | 直接使用服务 | 不通过 factory 模式 |
| `workflow_node_execution_offload` | 集成在 node_executions 中 | 大数据卸载处理 |

## 注意事项

1. **密码安全**: 请使用您自己的安全密码替换示例密码
2. **渐进迁移**: 建议先在测试环境验证
3. **数据备份**: 切换前请确保有完整备份
4. **监控**: 切换后密切监控应用性能
