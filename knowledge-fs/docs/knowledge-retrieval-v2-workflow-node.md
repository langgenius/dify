# Knowledge Retrieval v2 工作流节点

`knowledge-retrieval-v2` 是 Dify Workflow / Chatflow 中面向 KnowledgeFS 的证据检索节点。
它和原有 `knowledge-retrieval` 节点并存，不会自动改写或迁移旧 Dataset 节点。

## 何时使用

在 Workspace 已开启 KnowledgeFS，且工作流需要把可引用的证据交给 LLM、条件分支或
后续代码节点时使用 v2。它调用 evidence-only 检索操作，不在检索阶段生成问答答案。

## 配置

- Query 必须引用上游字符串变量，最长 16,000 个 Unicode 字符。
- 可选 1–10 个 KnowledgeFS Space，实际执行最多 4 路并发。
- Mode 留空时，每个 Space 分别使用自己已发布 Profile 的默认模式；也可固定为
  `fast`、`deep` 或 `research`。`research` 使用 Evidence V3：直接问题只做一次证据集判断，复杂问题最多增加一次计划调用；不会再按文档/目录层级重复调用模型。
- Top N 是多 Space 合并后的输出上限，范围 1–100。每个 Space 内的 Top K、阈值和
  rerank 仍由该 Space 已发布的 Retrieval Profile 管理。
- Manual filters 只接受 KnowledgeFS 固定字段：创建时间、文档类型、实体、新鲜度、
  语言、节点类型、Source ID 和标签。

## 输出

`result` 是按 KnowledgeFS 最终分数稳定降序排列的证据数组。节点不会对每个 Space 再做
min-max 归一化；不同 Profile / rerank 模型之间的分数只弱可比。每项包含：

```json
{
  "content": "evidence text",
  "title": "section title",
  "metadata": {
    "citation": {
      "document_id": "document asset id",
      "document_version": 2,
      "section_path": ["Chapter", "Section"],
      "page_number": 3,
      "artifact_hash": "..."
    },
    "score": 0.82,
    "sources": ["dense", "fts"],
    "space_id": "control space id"
  }
}
```

`metrics` 稳定暴露 `mode`、`total_ms` 和 `degradation_flags`。未显式指定 mode 且多个
Space 的实际模式不同时，`mode` 为 `mixed`。更完整的 per-space trace 和候选数写入
节点运行详情的 `process_data.knowledge_fs`。

## 发布与授权

- Debugger / Explore 的草稿运行会为当前账号有权限的所选 Space 幂等建立 workflow 绑定。
- 发布会先校验所有 Space 处于当前 Workspace 且为 active，再与 workflow snapshot 在同一
  事务中精确同步绑定：新增/恢复引用，撤销已从已发布 graph 移除的引用。
- 已发布和终端用户运行绝不自动补绑定。权限被撤销、Space 不可用或任一所选
  Space 失败时，节点 fail-closed，不返回容易被误认为完整结果的部分证据。
- DSL 导入会为目标 Workspace 中缺失的 Space 生成 warning，重新选择前无法发布。

## 与原有节点的区别

| 维度 | Knowledge Retrieval | Knowledge Retrieval v2 |
|---|---|---|
| 数据体系 | Dify Dataset / Document | KnowledgeFS Space / publication |
| 检索配置 | 主要保存在节点 | Top K、阈值、rerank 由 Space Profile 管理 |
| 模式 | 旧检索策略 | fast / deep / research / 跟随 Space |
| 多知识库 | Dataset 合并检索 | 最多 10 Space，4 路并发、稳定合并 |
| 引用 | 旧 metadata | 文档版本、章节路径、页码、offset、artifact hash |
| 授权 | Dataset app join | Capability v2 + workflow 精确绑定 |
| 失败语义 | 依旧节点实现 | 多 Space fail-closed，空结果为成功 |
