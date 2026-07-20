# KnowledgeFS Code Review — 待优化问题清单

> 审查时间：2026-05-13
> Historical review note: the project-owned Rust/WASM compute layer was removed on 2026-07-16
> after its algorithms moved to `packages/compute`. Rust/WASM findings below are retained only as
> audit history and no longer describe the active build or runtime.
>
> 代码规模：原审查时约 82,000 行（TypeScript + Rust），monorepo 结构
> 审查范围：全项目架构与代码实现

---

## 目录

- [严重程度：高（High）](#严重程度高high)
- [严重程度：中（Medium）](#严重程度中medium)
- [严重程度：低（Low）](#严重程度低low)
- [优先行动建议](#优先行动建议)

---

## 严重程度：高（High）

### H1. `packages/api/src/index.ts` 单文件 24,095 行——God File

**位置**：`packages/api/src/index.ts`（24,095 行），`packages/api/src/gateway.test.ts`（14,570 行）

**描述**：该文件包含了：

- ~40 个接口定义
- ~30 个内存仓库实现
- ~10 个数据库仓库实现
- HTTP 中间件（auth、rate limit、trace）
- ~50 个 OpenAPI 路由定义和处理器
- MCP 服务器实现
- Safe Shell 解析器和执行器
- 检索规划器、评估运行器、证据组装器
- 上下文富化、实体/关系抽取流程
- 图索引仓库
- 文档编译工作流
- 研究任务状态机
- Agent 工作区快照/回放服务

**影响**：

- IDE 性能显著下降（类型推断、自动补全变慢）
- 合并冲突频繁发生
- 代码审查困难，认知负载过高
- 无法对单一职责进行独立测试和部署

**建议**：按领域拆分为独立模块（routes/、middleware/、repositories/、mcp/、retrieval/ 等）。项目中已有子模块（`document-compilation-job.ts`、`retrieval-regression.ts`）证明团队知道如何拆分。

---

### H2. 数据库 Schema 无外键约束

**位置**：`packages/database/src/schema.ts`

**描述**：所有表定义中没有任何 `REFERENCES` 子句。`knowledge_nodes` 引用了 `knowledge_space_id`、`document_asset_id`、`parse_artifact_id`，但数据库不会强制执行引用完整性。

**影响**：

- 部分失败会导致孤儿行和悬挂引用
- 删除操作无级联保护，可能产生数据不一致
- 无法依赖数据库保证数据完整性，完全依赖应用层

**建议**：为关键外键关系添加 `REFERENCES` 约束，配合 `ON DELETE CASCADE` 或 `ON DELETE SET NULL`。特别是 `graph_relations` 引用 `graph_entities` 等场景。

---

### H3. `collectPlatformHealth` 不捕获异常

**位置**：`packages/core/src/platform-adapter.ts:268-286`

**描述**：如果任何一个子适配器的 `health()` 方法抛出异常（而不是返回 `false`），整个 `Promise.all` 会拒绝，导致健康检查端点完全崩溃，而非报告该组件不健康。

**影响**：单个适配器故障会导致整个健康端点不可用，运维无法获取其他组件的健康状态。

**建议**：为每个子适配器的 health 调用包裹 try-catch，捕获异常后映射为 `false`。

```typescript
const dbHealthy = await adapter.database.health().catch(() => false);
```

---

### H4. Admin 表单绕过 BFF 直接 POST 到 API

**位置**：`apps/admin/app/page.tsx:435`、`page.tsx:728`、`page.tsx:914`

**描述**：表单的 `action` 属性指向 `http://localhost:8787`（API 服务器），完全绕过了 BFF 代理的安全控制：

- body 大小限制
- 路由白名单
- header 过滤
- cookie 剥离

且没有附带 `Authorization` header，请求会静默失败。

**影响**：安全边界被架构性地绕过；表单提交功能实际不可用。

**建议**：表单应提交到 BFF 代理路由（`/api/bff/...`），由 BFF 添加 Authorization header 后转发到 API。

---

### H5. BFF 路由白名单缺失多个功能路由

**位置**：`apps/admin/lib/bff.ts:131-236`

**描述**：API client 中存在以下方法，但 BFF 代理中没有对应的白名单路由：

| API Client 方法 | 请求路径 | BFF 状态 |
|-----------------|----------|----------|
| `traverseGraph` | `/knowledge-spaces/{id}/graph/traverse` | 缺失 |
| `listKnowledgeFs` | `/knowledge-spaces/{id}/fs/ls` | 缺失 |
| `diffKnowledgeFs` | `/knowledge-spaces/{id}/fs/diff` | 缺失 |
| `listSemanticView` | `/knowledge-spaces/{id}/fs/ls` | 缺失 |

**影响**：通过 Admin UI 访问这些功能会返回 404。

**建议**：在 `resolveAllowedRoute` 中为缺失的路由添加白名单条目。

---

### H6. 无全局错误处理器

**位置**：`packages/api/src/index.ts`

**描述**：未注册 `app.onError()` 或 `app.notFound()` 处理器。未处理的异常会泄露栈信息（在非生产环境下），未知路由会返回 Hono 默认响应。

**影响**：

- 生产环境可能泄露内部实现细节
- 错误响应格式不统一
- 无法集中记录未预期异常

**建议**：

```typescript
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});
```

---

## 严重程度：中（Medium）

### M1. `quoteIdentifier` 不转义内嵌引号——SQL 注入风险

**位置**：`packages/adapters/src/database.ts:356-358`、`packages/database/src/schema.ts:652-654`

**描述**：

```typescript
function quoteIdentifier(dialect: DatabaseDialect, identifier: string): string {
  return dialect === "postgres" ? `"${identifier}"` : `\`${identifier}\``;
}
```

如果标识符包含双引号（`"`），生成的 SQL 为 `"table"name"`，会破坏引号闭合并可能导致注入。

**风险等级**：实际风险低（标识符来自开发者硬编码的常量，且 `requireTable` / `validateColumns` 限制了输入），但函数本身不安全。

**建议**：添加转义逻辑或输入验证：

```typescript
function quoteIdentifier(dialect: DatabaseDialect, identifier: string): string {
  if (dialect === "postgres") {
    return `"${identifier.replace(/"/g, '""')}"`;
  }
  return `\`${identifier.replace(/`/g, '``')}\``;
}
```

---

### M2. BFF 在检查大小前读取完整请求体

**位置**：`apps/admin/lib/bff.ts:250`

**描述**：`request.arrayBuffer()` 将整个 body 读入内存后才在 line 251 检查大小。恶意客户端可以发送 multi-GB body 导致服务器内存耗尽。

**建议**：改用流式读取并逐块检查大小，类似 `api-client.ts:1055-1087` 中 `readBoundedTextResponse` 的实现。

---

### M3. `countTokens` 名称误导——实际是词计数器

**位置**：`crates/knowledge_compute/src/lib.rs:41-71`

**描述**：该函数不是 BPE tokenizer，而是基于空格的词计数 + CJK 字符计数。对英文文本系统性低估：

| 输入 | 本函数结果 | tiktoken 结果 | 差异 |
|------|-----------|---------------|------|
| `"unbelievable"` | 1 | 3 (`un`+`believ`+`able`) | 低估 2x |
| `"KnowledgeFS parses documents."` | 4 | ~5+ | 低估 ~25% |

**影响**：`pack_evidence_json`（line 589）依赖此函数控制 LLM 上下文窗口预算。系统性低估会导致 evidence packing 超出实际上下文限制。

**建议**：

- 重命名为 `countApproxTokens` 或 `countWords` 并文档说明近似语义
- 或引入乘数校正因子（如英文 ×1.3）
- 长期考虑引入轻量级 BPE 实现

---

### M4. 缓存无内存字节上限

**位置**：`packages/adapters/src/cache.ts`

**描述**：缓存只限制 `maxEntries`，没有 `maxTotalBytes` 限制。10,000 个条目每个 100MB 就能耗尽内存。`stats()` 方法已经计算了 `totalBytes`，添加检查很简单。

**建议**：在 `set()` 中增加 `totalBytes` 检查，超限时触发驱逐。

---

### M5. 9 处 `context: any` 类型断言

**位置**：`packages/api/src/index.ts:19946-20276`（9 处）

**描述**：9 个路由处理器将 Hono context 断言为 `any`（biome-ignore 注释说明是因为 TS2589 类型递归深度限制）。OpenAPI 路由 schema 仍在运行时验证输入，但编译时无法捕获处理器内部的字段访问错误。

**影响**：拼写错误如 `context.req.valid("jsom")` 会静默编译通过。

**建议**：将验证后的输入提取到显式类型的局部变量中，而非将整个 context 断言为 `any`。

---

### M6. SSE 解析器不符合规范

**位置**：`packages/generation/src/index.ts:2786-2827`

**描述**：

1. **多行 data 字段未合并**：SSE 规范要求同一事件内连续的 `data:` 行用 `\n` 拼接。当前实现在遇到新 `data:` 行且无事件名时会刷新为独立事件（line 2817-2819），不符合规范。
2. **非流式处理**：`readTextResponse` 读取完整响应体后 `parseSseEvents` 才开始处理，对长时间运行的生成任务会一直阻塞直到响应完成。
3. **不支持 retry/id 字段**：SSE 规范中的重连机制未实现。

**建议**：实现增量式 SSE 解析，逐块消费 `ReadableStream` 并在完整帧到达时 yield 事件。

---

### M7. 作业队列幂等键索引漂移

**位置**：`packages/adapters/src/cloudflare-job-queue.ts:49`、`packages/adapters/src/pg-boss-job-queue.ts:53`

**描述**：外层适配器和内层 inline adapter 各自维护独立的幂等键索引。当 inline adapter 清理终态任务并移除幂等键时，外层索引仍保留该键，阻止后续使用相同幂等键重新入队。

**建议**：外层适配器应在终态转换时同步清理自己的幂等键索引，或委托给 inline adapter 统一管理。

---

### M8. 无增量迁移支持

**位置**：`packages/database/src/migration-file.ts`、`packages/database/scripts/migration-artifacts.ts`

**描述**：

- 整个迁移系统只生成单个 `0001_initial_schema` 迁移文件
- 使用 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`，只能处理首次创建
- 无 `schema_migrations` 版本追踪表
- 无迁移运行器
- 无回滚能力
- 无法处理列添加、重命名、类型变更

**影响**：Schema 演进只能通过手写 SQL 完成，无法自动化。随着项目成长，这会成为严重瓶颈。

**建议**：引入增量迁移机制（考虑 drizzle-kit、prisma migrate 或自建版本追踪）。

---

### M9. TiDB 兼容性问题

**位置**：`packages/database/src/schema.ts`

**描述**：

1. **FULLTEXT 索引类型错误**（line 216-220）：TiDB FULLTEXT 索引要求 `VARCHAR(n)` 类型，但 `fts_document` 定义为 `TEXT`，迁移执行会失败。

2. **CREATE INDEX 非幂等**（line 640）：TiDB 的 `CREATE INDEX` 语句缺少 `IF NOT EXISTS`，重复执行会报错。PostgreSQL 分支（line 633）已包含此子句。

**建议**：

- 将 TiDB 的 `fts_document` 改为 `VARCHAR(65535)` 或适当长度
- 为 TiDB 索引创建添加 `IF NOT EXISTS`

---

### M10. `stableJson` 中 null 处理 Bug

**位置**：`packages/embeddings/src/index.ts:1337-1349`

**描述**：`typeof null === "object"` 为 `true`，导致 `null` 值进入对象分支后 `Object.entries(null as any)` 抛出异常。`packages/generation/src/index.ts:3066` 中的同名函数已正确处理此情况。

**建议**：添加显式 null 检查：

```typescript
if (value === null) return "null";
```

---

### M11. Cloudflare/Node 适配器静默回退到内存存储

**位置**：`packages/adapters/src/cloudflare.ts:82-88`、`packages/adapters/src/node.ts:81-86`

**描述**：环境变量缺失时静默回退到内存对象存储，但 `kind` 仍报告为生产值（`"r2"` / `"s3-compatible"`）。

**影响**：

- 生产环境重启后数据丢失且无任何警告
- 运行时无法通过 `kind` 字段区分真实存储和内存回退
- 健康检查会报告存储为"健康"但数据实际不持久

**建议**：

- 回退时 `kind` 应设为 `"memory"` 而非伪装为生产类型
- 输出明确的 warning 日志
- 考虑在生产模式下拒绝启动而非回退

---

### M12. 未定义向量相似度索引

> 状态更新：原建议中的全局 `vector(1536)` 不适用于由 plugin-daemon 动态选择的模型。
> 当前实现使用无固定维度的 `vector` / `VECTOR` 保存不同模型的向量，并在检索时按实际
> 模型和维度隔离。若需要 ANN，应针对具体模型与维度创建 PostgreSQL partial/expression
> HNSW 索引，或在 TiDB 中使用独立的固定维度表，不能创建跨模型的通用向量索引。

**位置**：`packages/database/src/schema.ts`

**描述**：Schema 定义了 `dense_vector` 列（使用 pgvector 的 `vector` 类型），但没有创建任何向量相似度索引（IVFFlat、HNSW 等）。且 `vectorColumn`（line 89-96）未指定维度参数。

**影响**：向量相似度搜索会退化为全表扫描，性能随数据量线性下降。

**建议**：

- 为高流量的具体模型和维度建立独立 ANN 索引或固定维度存储
- 查询必须使用建立索引时相同的模型，并在距离计算前校验实际向量维度

---

### M13. Cloudflare 缓存 kind 伪装

**位置**：`packages/adapters/src/cloudflare.ts:39-41`

**描述**：

```typescript
cache: {
  ...createMemoryCacheAdapter({ maxEntries: 10_000 }),
  kind: "kv",
},
```

创建了内存缓存但将 `kind` 覆写为 `"kv"`。运行时行为是内存缓存，但自我报告为 KV。

**影响**：健康面板或运维监控检查 `kind === "kv"` 会得出错误结论。

**建议**：保持诚实的 `"memory"` kind 直到真正实现 KV 适配器。

---

## 严重程度：低（Low）

### L1. 适配器无生命周期管理方法

**位置**：`packages/core/src/platform-adapter.ts`

**描述**：所有适配器接口（DatabaseAdapter、ObjectStorageAdapter、CacheAdapter、JobQueueAdapter）均无 `close()` / `dispose()` / `shutdown()` 方法。持有连接池、Redis 连接等资源的适配器无法被优雅关闭。

**影响**：测试中资源泄漏；生产环境优雅关闭时连接不释放。

---

### L2. `KnowledgeFsVirtualPathSchema` 正则与命名空间枚举手动同步

**位置**：`packages/core/src/models.ts:171-173`

**描述**：路径验证正则硬编码了 `sources|knowledge|evidence|workspaces`，必须与 `KnowledgeFsNamespaceSchema`（line 139）保持同步。新增命名空间时容易遗漏正则更新。

**建议**：从枚举选项程序化生成正则。

---

### L3. 多个实体 Schema 缺少 `updatedAt` 字段

**位置**：`packages/core/src/models.ts`、`packages/database/src/schema.ts`

**描述**：以下实体有 `createdAt` 和 `version` 但无 `updatedAt`：

- `DocumentAssetSchema`（models.ts:43）
- `ParseArtifactSchema`
- `KnowledgeNodeSchema`
- `IndexProjectionSchema`

数据库层的 `knowledge_nodes`、`index_projections`、`knowledge_paths`、`evidence_bundles`、`answer_trace_steps` 同样缺少 `updated_at` 列。

---

### L4. 命令注册表 `execute<TOutput>` 泛型不安全

**位置**：`packages/core/src/command-registry.ts:225-229`

**描述**：`register` 方法通过 `as StoredCommandDefinition` 擦除泛型参数，`execute` 方法的 `TOutput` 泛型仅是装饰性的——实际通过 `as TOutput` 断言返回，无类型安全保证。

---

### L5. Dockerfile 生产环境问题

**位置**：`apps/api/Dockerfile`

**描述**：

1. **运行时转译**（line 36）：`CMD ["pnpm", ..., "start"]` 通过 `tsx` 在启动时转译 TypeScript，增加启动时间且引入不必要的运行时依赖
2. **Root 用户运行**：无 `USER` 指令，容器以 root 身份运行
3. **`tsx` 放在 `dependencies` 而非 `devDependencies`**

**建议**：添加构建步骤产出 JavaScript；添加 `USER node` 指令。

---

### L6. WASM 构建流水线缺少优化

**位置**：`scripts/wasm-build.mjs`、`Cargo.toml`

**描述**：

1. `cargo build` 缺少 `--locked` 标志，CI 构建可能不可复现
2. 未运行 `wasm-opt`，WASM 二进制可减少 10-30% 体积
3. 工作区 `Cargo.toml` 无 `[profile.release]` 优化配置（建议 `lto = true`、`codegen-units = 1`、`opt-level = "s"`）

---

### L7. TypeScript WASM 包装层性能开销

**位置**：`packages/compute/src/index.ts`

**描述**：每次 WASM 调用经历：`JSON.stringify` → WASM → `JSON.parse` → Zod validate → `JSON.parse(JSON.stringify(...))` clone → Zod validate again。即 2 次序列化、2 次反序列化、2 次 Zod 验证。

**影响**：对 `countTokens` 等轻量计算，包装层开销可能超过实际计算成本。

**建议**：

- 消除重复验证（clone 函数中的 Zod re-parse 可移除）
- 对简单返回值（如 `countTokens` 返回单个数字）提供快速路径

---

### L8. LCS Diff 算法 O(n*m) 内存

**位置**：`crates/knowledge_compute/src/lib.rs:159`

**描述**：`build_lcs_diff` 分配 `(old_len+1) * (new_len+1)` 个 u32。默认 `max_diff_cells=2,000,000` 限制在 ~8 MB，但 `max_tokens=20,000` 暗示最大 400M cells——两个默认值不一致。实际有效最大方阵为 ~1414×1414 tokens。

**建议**：文档说明有效限制；长期考虑 Myers diff（对相似文件更高效）。

---

### L9. 公共工具函数跨 7+ 文件重复定义

**位置**：全项目

**描述**：以下函数/模式在多个文件中重复实现：

| 函数 | 出现次数 | 涉及包 |
|------|---------|--------|
| `cloneJson` (JSON round-trip clone) | 7+ | api, compute, adapters |
| `requiredString` | 5+ | api |
| `validatePositive` / `validatePositiveInteger` | 5+ | api, admin |
| `formatPercent` | 3 | admin |
| `formatMs` | 3 | admin |
| `isRecord` | 2 | admin |
| `stableJson` | 2 | embeddings, generation |
| `boundedResponseText` | 2 | embeddings, generation |
| `FakeS3Client` (测试) | 2 | adapters |

**建议**：提取到 `packages/core/src/utils.ts` 或新建 `packages/shared`。

---

### L10. 非拉丁字符 Token 计数不准

**位置**：`crates/knowledge_compute/src/lib.rs:73-77`

**描述**：`is_latin_token_grapheme` 只检查 ASCII。带重音的拉丁字符（如 `é`、`ñ`、`ü`）不是 ASCII 字母，会被当作独立 token 而非词的一部分。

示例：`"café"` → 正确应为 1 token，实际因 `é` 非 ASCII 导致拉丁词被拆分。

---

### L11. `formatPercent` 浮点偏差

**位置**：`apps/admin/lib/retrieval-studio.ts:218`、`apps/admin/lib/failed-query-diagnostics.ts:193`

**描述**：`Math.round(value * 100 + 1e-9)` 中的 `+ 1e-9` epsilon 引入系统性向上取整偏差。`evaluation-dashboard.ts:154` 中的同名函数不含此偏差——实现不一致。

示例：`value = 0.004999999` → 产出 `1` 而非 `0`。

---

### L12. "1 steps" 语法错误

**位置**：`apps/admin/lib/trace-comparison.ts:149`

**描述**：`stepCountLabel` 始终使用复数 `` `${trace.steps.length} steps` ``，当恰好 1 步时显示 "1 steps"。

---

### L13. Provider 无 Retry/Backoff 和 AbortSignal 支持

**位置**：`packages/embeddings/src/index.ts`、`packages/generation/src/index.ts`

**描述**：

1. HTTP provider 对 429 (Rate Limit)、503 等可重试错误无自动重试机制
2. 所有 provider 接口不接受 `AbortSignal`，长时间运行的 embedding/generation 调用无法被调用方取消

---

### L14. Embedding Provider 未传递 Voyage `input_type`

**位置**：`packages/embeddings/src/index.ts:718-723`

**描述**：`requestBody` 函数只为 Cohere 传递 `input_type`。Voyage API 同样支持 `input_type` 来区分 query 和 document embedding，但被静默忽略。

**影响**：Voyage embedding 质量可能低于预期（未区分查询和文档向量）。

---

### L15. Research Workflow 引用计数 Off-by-one

**位置**：`packages/api/src/research-workflow.ts:193`

**描述**：`if (citations.length > maxCitations)` 在 push 之后检查，允许收集 `maxCitations + 1` 条引用后才抛出错误。

**建议**：改为 `>=` 或在 push 之前检查。

---

### L16. 任务规划器硬编码 Token 价格

**位置**：`packages/api/src/research-task-planning.ts:293-294`

**描述**：`inputTokens * 0.000003 + outputTokens * 0.000012` 硬编码了特定模型的定价，无法配置且未说明对应哪个模型。

**建议**：将价格常量提取为可配置参数。

---

### L17. Rate Limit 响应泄露租户信息

**位置**：`packages/api/src/index.ts:21987-21998`

**描述**：429 响应 body 包含 `tenantId` 和 `subjectId`。虽然客户端已知自身身份，但在错误响应中暴露可被中间层日志捕获用于侦察。

---

### L18. 缓存驱逐策略是 FIFO 而非 LRU

**位置**：`packages/adapters/src/cache.ts:70-77`

**描述**：`evictOldest` 删除 Map 中第一个键（按插入顺序）。`get()` 不会将条目移到 Map 末尾，因此频繁访问的热点条目仍可能被驱逐。

---

### L19. `platform-adapter.ts` 中 `health()` 与 `collectPlatformHealth` 双路径

**位置**：`packages/core/src/platform-adapter.ts:259-266` vs `268-286`

**描述**：`PlatformAdapter` 接口有自己的 `health()` 方法，同时存在独立的 `collectPlatformHealth()` 函数。消费者不清楚应调用哪个。测试只覆盖了 `collectPlatformHealth`。

---

### L20. 防御性克隆过度（Embeddings）

**位置**：`packages/embeddings/src/index.ts`

**描述**：`cloneDenseVectors` 在每条 embed 路径上调用 3+ 次（parse → build → return）。对 128 条文本 × 3072 维向量，每次 clone 复制 ~1.2M 个浮点数。

**建议**：文档化所有权语义，减少不必要的中间 clone。

---

### L21. `readJsonResponse` 无响应体大小限制

**位置**：`apps/admin/lib/api-client.ts:1047-1053`

**描述**：直接调用 `response.json()` 无大小限制。恶意或故障的上游服务可返回超大 JSON 响应耗尽客户端内存。同文件中 `readBoundedTextResponse` 已有大小限制——不一致。

---

### L22. 结构化错误类型缺失

**位置**：`packages/embeddings/`、`packages/generation/`、`packages/parsers/`

**描述**：除 `GenerationModelUnavailableError` 外，所有错误都是裸 `new Error(...)`。Rate limiting、超时、输入验证、解析失败等场景无法被调用方程序化区分。

**建议**：引入结构化错误类型：`ProviderRateLimitError`、`ProviderTimeoutError`、`InputValidationError`、`ParseError` 等。

---

### L23. Markdown 解析器标题深度跳跃产生 undefined

**位置**：`packages/parsers/src/index.ts:582-597`

**描述**：如果 H3 出现但之前没有 H2，`sectionPath` 会变为 `[h1Text, undefined, h3Text]`。`undefined` 会传播到解析产物中。

---

### L24. `ObjectStorageAdapter.getObject` 强制全量内存加载

**位置**：`packages/core/src/platform-adapter.ts:155`

**描述**：返回 `Uint8Array | null`，对大对象强制全量内存加载。无流式读取接口。

---

### L25. Research Workflow 中独立操作串行执行

**位置**：`packages/api/src/research-workflow.ts:140-154`

**描述**：`sourceComparison.compare` 和 `freshnessChecking.check` 相互独立（都只需要 `evidenceBundle` 和 `knowledgeSpaceId`），但当前串行执行。

**建议**：用 `Promise.all` 并行执行以减少延迟。

---

## 优先行动建议

| 优先级 | 行动 | 预期收益 |
|--------|------|---------|
| **P0** | 拆分 `packages/api/src/index.ts`（H1） | 可维护性、审查效率、IDE 性能 |
| **P0** | 添加全局错误处理器（H6）+ 修复表单直连 API（H4） | 生产安全底线 |
| **P1** | 修复 `collectPlatformHealth` 异常吞没（H3） | 运维可靠性 |
| **P1** | 补全 BFF 路由白名单（H5） | Admin 功能可用性 |
| **P1** | 修复 `stableJson` null bug（M10） | 运行时崩溃风险 |
| **P2** | 添加外键约束（H2）+ 增量迁移机制（M8） | 数据完整性 |
| **P2** | 修复 TiDB 兼容性（M9）+ 添加向量索引（M12） | 多数据库支持 + 检索性能 |
| **P2** | 提取公共工具函数（L9） | 代码质量、减少 bug 传播 |
| **P3** | SSE 规范修复（M6）+ Provider retry（L13） | 生成质量和可靠性 |
| **P3** | 缓存字节限制（M4）+ LRU（L18） | 内存安全 |
| **P3** | WASM 构建优化（L6）+ 包装层性能（L7） | 构建体积和运行时性能 |
| **P3** | Token 计数重命名/校正（M3） | 证据打包准确性 |
