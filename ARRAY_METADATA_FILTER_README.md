# 元数据数组过滤功能实现

## 功能概述

这个实现为Dify的知识检索系统添加了对数组类型元数据的过滤支持，解决了GitHub Issue #16195中提到的需求。

## 问题背景

用户在使用Dify的知识检索功能时，需要根据包含特定`job_ids`的数组来过滤文档，但现有系统只支持字符串、数字和时间类型的元数据过滤，不支持数组类型的条件匹配。

## 解决方案

### 1. 前端改动

#### 新增数组类型支持
- 在`MetadataFilteringVariableType`枚举中添加了`array`类型
- 更新了`MetadataFilteringCondition`类型以支持`string[]`值
- 为数组类型添加了专门的操作符：`in`、`not in`、`contains`、`not contains`、`empty`、`not empty`
- 添加了数组类型的图标支持（使用`RiListUnordered`图标）

#### 文件修改
```typescript
// web/app/components/workflow/nodes/knowledge-retrieval/types.ts
export enum MetadataFilteringVariableType {
  string = 'string',
  number = 'number', 
  time = 'time',
  select = 'select',
  array = 'array',  // 新增
}

export type MetadataFilteringCondition = {
  id: string
  name: string
  comparison_operator: ComparisonOperator
  value?: string | number | string[]  // 支持数组值
}
```

### 2. 后端改动

#### 数据库查询逻辑
在PostgreSQL的JSONB字段中实现数组条件查询：

**`in` 操作符逻辑：**
- 检查文档的元数据字段是否包含输入数组中的任何值
- 使用OR逻辑连接多个LIKE条件

**`not in` 操作符逻辑：**
- 检查文档的元数据字段是否不包含输入数组中的任何值  
- 使用AND逻辑连接多个NOT LIKE条件

#### 文件修改
```python
# api/core/rag/retrieval/dataset_retrieval.py
# api/core/workflow/nodes/knowledge_retrieval/knowledge_retrieval_node.py

case "in":
    if isinstance(value, (list, tuple)):
        or_conditions = []
        for i, v in enumerate(value):
            param_key = f"{key_value}_{i}"
            if isinstance(v, str):
                or_conditions.append(
                    (text(f"documents.doc_metadata ->> :{key} LIKE :{param_key}")).params(
                        **{key: metadata_name, param_key: f'%"{v}"%'}
                    )
                )
        if or_conditions:
            filters.append(or_(*or_conditions))
```

## 使用示例

### 场景：根据job_ids数组过滤文档

假设有以下文档元数据：
```json
{
  "doc1": {"job_ids": ["job1", "job2", "job3"]},
  "doc2": {"job_ids": ["job2", "job4", "job5"]}, 
  "doc3": {"job_ids": ["job6", "job7"]}
}
```

### 查询1：包含指定job_ids的文档
```
条件：job_ids in ["job1", "job4"]
结果：返回doc1和doc2，因为它们分别包含job1和job4
```

### 查询2：不包含指定job_ids的文档  
```
条件：job_ids not in ["job2", "job6"]
结果：返回doc3（如果存在不包含job2和job6的其他文档）
```

## 对应的SQL查询

### 包含查询 (in)
```sql
SELECT * FROM documents WHERE
  doc_metadata ->> 'job_ids' LIKE '%"job1"%' OR
  doc_metadata ->> 'job_ids' LIKE '%"job4"%';
```

### 排除查询 (not in)
```sql  
SELECT * FROM documents WHERE
  doc_metadata ->> 'job_ids' NOT LIKE '%"job2"%' AND
  doc_metadata ->> 'job_ids' NOT LIKE '%"job6"%';
```

## 测试

运行测试脚本：
```bash
python test_array_metadata_filter.py
```

这将演示数组过滤功能的工作原理。

## 技术细节

### 数据存储
- 元数据存储在PostgreSQL的JSONB字段中
- 数组值在JSON中以字符串数组形式存储：`["value1", "value2"]`
- 使用LIKE操作符进行部分匹配：`LIKE '%"value"%'`

### 性能考虑
- 使用了数据库索引：`db.Index("document_metadata_idx", "doc_metadata", postgresql_using="gin")`
- JSONB字段支持GIN索引，能够高效处理包含查询

### 支持的操作符
- `in`: 检查字段是否包含数组中的任意值
- `not in`: 检查字段是否不包含数组中的任意值
- `contains`: 检查字段是否包含特定值
- `not contains`: 检查字段是否不包含特定值
- `empty`: 检查字段是否为空
- `not empty`: 检查字段是否不为空

## 扩展性

这个实现为未来支持更复杂的数组操作奠定了基础，比如：
- `all of`: 检查是否包含数组中的所有值
- `any of`: 检查是否包含数组中的任意值（类似当前的`in`）
- 数组长度比较
- 数组交集/并集操作

## 兼容性

- 向后兼容：现有的字符串、数字、时间类型过滤功能保持不变
- 数据库兼容：利用PostgreSQL的JSONB特性，无需额外的schema变更
- API兼容：扩展现有的元数据过滤API，不破坏现有接口 