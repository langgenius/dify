# Dify中配置Clickzetta Lakehouse作为向量数据库指南

## 概述

Clickzetta Lakehouse是一个统一的数据湖仓平台，支持向量数据存储和高性能搜索。本指南将帮助您在Dify中配置Clickzetta作为向量数据库，替代默认的向量数据库选项。

## 前置条件

### 1. 系统要求
- Dify 平台已部署并运行
- Python 3.11+ 环境
- 可访问的Clickzetta Lakehouse实例

### 2. 必需的连接信息
在开始配置之前，请确保您有以下Clickzetta Lakehouse连接信息：

| 参数 | 说明 | 示例 |
|------|------|------|
| `username` | Clickzetta用户名 | `your_username` |
| `password` | Clickzetta密码 | `your_password` |
| `instance` | Clickzetta实例ID | `your_instance_id` |
| `service` | 服务端点 | `api.clickzetta.com` |
| `workspace` | 工作空间名称 | `quick_start` |
| `vcluster` | 虚拟集群名称 | `default_ap` |
| `schema` | 数据库模式 | `dify` |

## 配置步骤

### 1. 环境变量配置

在Dify部署环境中设置以下环境变量：

```bash
# Clickzetta Lakehouse连接配置
export VECTOR_STORE=clickzetta
export CLICKZETTA_USERNAME=your_username
export CLICKZETTA_PASSWORD=your_password
export CLICKZETTA_INSTANCE=your_instance_id
export CLICKZETTA_SERVICE=api.clickzetta.com
export CLICKZETTA_WORKSPACE=quick_start
export CLICKZETTA_VCLUSTER=default_ap
export CLICKZETTA_SCHEMA=dify

# 可选的高级配置
export CLICKZETTA_BATCH_SIZE=100
export CLICKZETTA_ENABLE_INVERTED_INDEX=true
export CLICKZETTA_ANALYZER_TYPE=chinese
export CLICKZETTA_ANALYZER_MODE=smart
export CLICKZETTA_VECTOR_DISTANCE_FUNCTION=cosine_distance
```

### 2. Docker Compose配置

如果使用Docker Compose部署Dify，请在`docker-compose.yml`中添加环境变量：

```yaml
version: '3'
services:
  api:
    image: langgenius/dify-api:latest
    environment:
      # ... 其他配置
      
      # Clickzetta向量数据库配置
      VECTOR_STORE: clickzetta
      CLICKZETTA_USERNAME: ${CLICKZETTA_USERNAME}
      CLICKZETTA_PASSWORD: ${CLICKZETTA_PASSWORD}
      CLICKZETTA_INSTANCE: ${CLICKZETTA_INSTANCE}
      CLICKZETTA_SERVICE: ${CLICKZETTA_SERVICE:-api.clickzetta.com}
      CLICKZETTA_WORKSPACE: ${CLICKZETTA_WORKSPACE:-quick_start}
      CLICKZETTA_VCLUSTER: ${CLICKZETTA_VCLUSTER:-default_ap}
      CLICKZETTA_SCHEMA: ${CLICKZETTA_SCHEMA:-dify}
      
      # 可选的高级配置
      CLICKZETTA_BATCH_SIZE: ${CLICKZETTA_BATCH_SIZE:-100}
      CLICKZETTA_ENABLE_INVERTED_INDEX: ${CLICKZETTA_ENABLE_INVERTED_INDEX:-true}
      CLICKZETTA_ANALYZER_TYPE: ${CLICKZETTA_ANALYZER_TYPE:-chinese}
      CLICKZETTA_ANALYZER_MODE: ${CLICKZETTA_ANALYZER_MODE:-smart}
      CLICKZETTA_VECTOR_DISTANCE_FUNCTION: ${CLICKZETTA_VECTOR_DISTANCE_FUNCTION:-cosine_distance}
```

### 3. 配置文件设置

如果使用配置文件方式，请在Dify配置文件中添加：

```python
# config.py
class Config:
    # ... 其他配置
    
    # 向量数据库配置
    VECTOR_STORE = "clickzetta"
    
    # Clickzetta连接配置
    CLICKZETTA_USERNAME = os.getenv("CLICKZETTA_USERNAME")
    CLICKZETTA_PASSWORD = os.getenv("CLICKZETTA_PASSWORD")
    CLICKZETTA_INSTANCE = os.getenv("CLICKZETTA_INSTANCE")
    CLICKZETTA_SERVICE = os.getenv("CLICKZETTA_SERVICE", "api.clickzetta.com")
    CLICKZETTA_WORKSPACE = os.getenv("CLICKZETTA_WORKSPACE", "quick_start")
    CLICKZETTA_VCLUSTER = os.getenv("CLICKZETTA_VCLUSTER", "default_ap")
    CLICKZETTA_SCHEMA = os.getenv("CLICKZETTA_SCHEMA", "dify")
    
    # 高级配置
    CLICKZETTA_BATCH_SIZE = int(os.getenv("CLICKZETTA_BATCH_SIZE", "100"))
    CLICKZETTA_ENABLE_INVERTED_INDEX = os.getenv("CLICKZETTA_ENABLE_INVERTED_INDEX", "true").lower() == "true"
    CLICKZETTA_ANALYZER_TYPE = os.getenv("CLICKZETTA_ANALYZER_TYPE", "chinese")
    CLICKZETTA_ANALYZER_MODE = os.getenv("CLICKZETTA_ANALYZER_MODE", "smart")
    CLICKZETTA_VECTOR_DISTANCE_FUNCTION = os.getenv("CLICKZETTA_VECTOR_DISTANCE_FUNCTION", "cosine_distance")
```

## 验证配置

### 1. 连接测试

启动Dify后，可以通过以下方式验证Clickzetta连接：

1. **查看日志**：
   ```bash
   # 查看Dify API日志
   docker logs dify-api
   
   # 查找Clickzetta相关日志
   docker logs dify-api | grep -i clickzetta
   ```

2. **创建知识库测试**：
   - 登录Dify管理界面
   - 创建新的知识库
   - 上传测试文档
   - 观察是否成功创建向量索引

### 2. 功能验证

在Dify中验证以下功能：

- ✅ **知识库创建**：能否成功创建知识库
- ✅ **文档上传**：能否上传和处理文档
- ✅ **向量化存储**：文档是否被正确向量化并存储
- ✅ **相似度搜索**：搜索功能是否正常工作
- ✅ **问答功能**：基于知识库的问答是否准确

## 使用指南

### 1. 知识库管理

#### 创建知识库
1. 登录Dify管理界面
2. 点击「知识库」→「创建知识库」
3. 填写知识库名称和描述
4. 选择嵌入模型（推荐使用支持中文的模型）
5. 点击「保存并处理」

#### 上传文档
1. 在知识库中点击「上传文档」
2. 选择支持的文件格式（PDF、Word、TXT等）
3. 配置文档分块规则
4. 点击「保存并处理」
5. 等待文档处理完成

#### 管理向量数据
- **查看统计**：在知识库详情页查看向量数量和存储统计
- **更新文档**：可以更新或删除已上传的文档
- **搜索测试**：使用搜索功能测试向量检索效果

### 2. 应用开发

#### 在聊天应用中使用
1. 创建新的聊天应用
2. 在「提示词编排」中关联知识库
3. 配置检索设置：
   - **TopK值**：建议3-5
   - **相似度阈值**：建议0.3-0.7
   - **重排序**：可选启用
4. 测试问答效果

#### 在工作流中使用
1. 创建工作流应用
2. 添加「知识检索」节点
3. 配置检索参数：
   - **查询变量**：`{{sys.query}}`
   - **知识库**：选择目标知识库
   - **检索设置**：TopK和相似度阈值
4. 将检索结果传递给LLM节点

## 性能优化

### 1. 向量索引优化

Clickzetta自动为向量字段创建HNSW索引，您可以通过以下方式优化：

```python
# 在配置中调整索引参数
CLICKZETTA_VECTOR_DISTANCE_FUNCTION = "cosine_distance"  # 适合文本嵌入
# 或
CLICKZETTA_VECTOR_DISTANCE_FUNCTION = "l2_distance"      # 适合图像嵌入
```

### 2. 批处理优化

```python
# 调整批处理大小
CLICKZETTA_BATCH_SIZE = 200  # 增加批处理大小可提高吞吐量
```

### 3. 全文搜索优化

```python
# 启用倒排索引以支持全文搜索
CLICKZETTA_ENABLE_INVERTED_INDEX = true
CLICKZETTA_ANALYZER_TYPE = "chinese"  # 中文分词
CLICKZETTA_ANALYZER_MODE = "smart"    # 智能分词模式
```

## 监控和维护

### 1. 性能监控

监控以下关键指标：
- **连接状态**：数据库连接是否正常
- **查询延迟**：向量搜索响应时间
- **吞吐量**：每秒处理的向量查询数
- **存储使用**：向量数据存储空间使用情况

### 2. 日志分析

关注以下日志信息：
```bash
# 连接日志
INFO - Clickzetta connection established successfully

# 向量操作日志
INFO - Vector insert completed: 1000 vectors in 2.3s
INFO - Vector search completed: 5 results in 120ms

# 错误日志
ERROR - Clickzetta connection failed: ...
WARNING - Vector search timeout: ...
```

### 3. 数据备份

定期备份重要的向量数据：
```sql
-- 查看向量集合
SHOW TABLES IN dify;

-- 备份向量数据
CREATE TABLE dify.backup_vectors AS 
SELECT * FROM dify.knowledge_base_vectors;

-- 查看数据统计
SELECT COUNT(*) FROM dify.knowledge_base_vectors;
```

## 故障排除

### 常见问题

#### Q1: 连接失败
**症状**: Dify启动时报Clickzetta连接错误
**解决方案**:
1. 检查网络连接
2. 验证用户名和密码
3. 确认实例ID正确
4. 检查防火墙设置

#### Q2: 向量搜索性能差
**症状**: 搜索响应时间过长
**解决方案**:
1. 检查是否创建了向量索引
2. 调整TopK值
3. 优化查询条件
4. 考虑增加计算资源

#### Q3: 文档处理失败
**症状**: 文档上传后处理失败
**解决方案**:
1. 检查文档格式是否支持
2. 验证文档大小限制
3. 查看详细错误日志
4. 检查向量化模型状态

#### Q4: 中文搜索效果差
**症状**: 中文文档搜索结果不准确
**解决方案**:
1. 启用中文分词器
2. 调整相似度阈值
3. 使用支持中文的嵌入模型
4. 检查文档分块设置

## 迁移指南

### 从其他向量数据库迁移

如果您从其他向量数据库（如Pinecone、Weaviate等）迁移到Clickzetta：

1. **备份现有数据**：
   ```bash
   # 导出现有向量数据
   python export_vectors.py --source=pinecone --output=vectors.json
   ```

2. **更新配置**：
   - 修改环境变量
   - 重启Dify服务

3. **数据导入**：
   ```bash
   # 导入向量数据到Clickzetta
   python import_vectors.py --source=vectors.json --target=clickzetta
   ```

4. **验证迁移**：
   - 测试搜索功能
   - 验证数据完整性
   - 检查性能指标

## 技术支持

### 获取帮助

如遇到问题，请：
1. 查看Dify系统日志
2. 检查Clickzetta连接状态
3. 参考本指南的故障排除部分
4. 联系技术支持团队

### 有用的资源

- **Dify官方文档**: https://docs.dify.ai
- **Clickzetta文档**: https://docs.clickzetta.com
- **GitHub Issues**: https://github.com/langgenius/dify/issues
- **社区论坛**: https://community.dify.ai

---

*本指南基于Dify v0.8.0+ 和 Clickzetta Lakehouse v1.0.0+*