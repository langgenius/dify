# RAG 知识库构建闭环流程

## 1. 流程概述

本文档描述 Dify 平台中 RAG（Retrieval-Augmented Generation，检索增强生成）知识库从创建到维护的完整闭环流程。Dify 的 RAG 管道覆盖了从数据源接入、文档解析、分块、嵌入、索引构建到检索与重排序的完整生命周期，并提供可视化的管道编排能力。

核心流程包括：
- **知识库创建**：选择索引模式 → 配置嵌入模型 → 初始化知识库
- **文档上传与处理**：上传 → 提取 → 清洗 → 分块 → 嵌入 → 索引
- **检索与重排序**：查询 → 检索方法选择 → 结果合并 → 重排序 → 输出
- **知识库维护**：文档更新、删除、重新索引、管道版本管理

---

## 2. 知识库创建流程图

```mermaid
graph TB
    A[用户进入知识库管理] --> B[点击创建知识库]
    B --> C[输入知识库名称与描述]
    C --> D{选择创建方式}

    D -->|传统模式| E1[选择索引技术类型]
    D -->|RAG Pipeline| E2[选择管道模板]

    E1 --> F1{索引技术类型}
    F1 -->|高质量模式 - high_quality| G1[选择嵌入模型 - 配置向量数据库]
    F1 -->|经济模式 - economy| G2[使用 Jieba 关键词索引 - 无需嵌入模型]

    G1 --> H1[选择索引结构]
    G2 --> H2[仅支持段落索引 - text_model]

    H1 --> I1{索引结构类型}
    I1 -->|段落索引 - text_model| J1[ParagraphIndexProcessor]
    I1 -->|QA 索引 - qa_model| J2[QAIndexProcessor - LLM 生成问答对]
    I1 -->|父子层级索引 - hierarchical_model| J3[ParentChildIndexProcessor - 子块检索 + 父块上下文]

    J1 --> K[创建 Dataset 记录]
    J2 --> K
    J3 --> K
    H2 --> K

    E2 --> L{管道模板来源}
    L -->|内置模板| M1[BuiltInPipelineTemplateRetrieval]
    L -->|数据库模板| M2[DatabasePipelineTemplateRetrieval]
    L -->|自定义模板| M3[CustomizedPipelineTemplateRetrieval]

    M1 --> N[创建 Pipeline Workflow]
    M2 --> N
    M3 --> N

    N --> O[编辑管道草稿 - 配置数据源与索引节点]
    O --> K

    K --> P[知识库创建完成 - 等待添加文档]
```

### 索引技术类型对比

| 索引技术 | 标识 | 嵌入模型 | 检索方法 | 适用场景 |
|----------|------|----------|----------|----------|
| 高质量模式 | `high_quality` | 需要 | 向量/全文/混合检索 | 语义理解要求高 |
| 经济模式 | `economy` | 不需要 | 关键词检索 | 成本敏感、关键词匹配 |

### 索引结构类型对比

| 索引结构 | 标识 | 处理器 | 特点 |
|----------|------|--------|------|
| 段落索引 | `text_model` | ParagraphIndexProcessor | 每个分块独立嵌入和索引 |
| QA 索引 | `qa_model` | QAIndexProcessor | LLM 生成问答对，以问题为索引 |
| 父子层级索引 | `hierarchical_model` | ParentChildIndexProcessor | 子块检索，父块提供上下文 |

---

## 3. 文档上传与处理流程图

```mermaid
graph TB
    A[用户添加文档] --> B{数据源类型}

    B -->|文件上传| C1[上传文件到对象存储 - PDF/Word/Excel/CSV...]
    B -->|Web 爬取| C2[选择爬取提供商 - Firecrawl/WaterCrawl/Jina]
    B -->|Notion 同步| C3[Notion API 授权 - 选择页面导入]
    B -->|外部知识库| C4[配置外部 API - 自定义检索参数]
    B -->|在线文档| C5[插件方式接入 - 浏览并选择文档]
    B -->|在线网盘| C6[插件方式接入 - 浏览并选择文件]

    C1 --> D[ExtractProcessor - 文档提取]
    C2 --> D
    C3 --> D
    C5 --> D
    C6 --> D

    D --> E{ETL 类型判断 - ETL_TYPE}
    E -->|dify| F1[内置提取器 - Pdf/Word/Excel/CSV...]
    E -->|Unstructured| F2[Unstructured 提取器 - 需配置 API URL + Key]

    F1 --> G[提取文本内容 - 返回 Document 列表]
    F2 --> G

    G --> H[CleanProcessor - 文本清洗]
    H --> H1[移除无效 Unicode]
    H --> H2[移除多余空格 - remove_extra_spaces]
    H --> H3[移除 URL 和邮箱 - remove_urls_emails]
    H --> H4[替换特殊标记]

    H1 --> I{分块模式}
    H2 --> I
    H3 --> I
    H4 --> I

    I -->|自动分块 - automatic| J1[EnhanceRecursiveCharacterTextSplitter - 系统预设规则]
    I -->|自定义分块 - custom| J2[FixedRecursiveCharacterTextSplitter - 自定义分隔符 + Token 数]

    J1 --> K[文本分块 - 生成 DocumentSegment 列表]
    J2 --> K

    K --> L{索引技术类型}
    L -->|high_quality| M[CacheEmbedding - 嵌入模型向量化]
    L -->|economy| N[Jieba 分词 - 关键词索引构建]

    M --> M1[embed_documents - 文档文本转向量]
    M1 --> M2[数据库缓存 - model_name + hash + provider_name]
    M2 --> M3[向量归一化]
    M3 --> M4[存入向量数据库 - Vector Store]

    N --> N1[Jieba 分词提取关键词]
    N1 --> N2[TF-IDF 计算权重]
    N2 --> N3[构建关键词索引]

    M4 --> O[索引构建完成 - 文档状态 = completed]
    N3 --> O

    C4 --> P[外部检索 API - ExternalDatasetService]
    P --> Q[外部知识库就绪 - 检索时直接调用外部 API]
```

### 文档处理时序图

```mermaid
sequenceDiagram
    participant User as 用户
    participant API as Backend API
    participant Extract as ExtractProcessor
    participant Clean as CleanProcessor
    participant Split as TextSplitter
    participant Embed as CacheEmbedding
    participant VectorDB as 向量数据库

    User->>API: 上传文档
    API->>API: 创建 Document 记录
    API->>Extract: 提取文本内容
    Extract->>Extract: 根据文件格式选择 Extractor
    Extract-->>API: Document 列表
    API->>Clean: 文本清洗
    Clean->>Clean: 移除无效字符 / 多余空格
    Clean-->>API: 清洗后文本
    API->>Split: 文本分块
    Split->>Split: 递归分割 / 固定分隔符分割
    Split-->>API: DocumentSegment 列表
    API->>Embed: 嵌入向量化
    Embed->>Embed: 检查缓存
    Embed->>VectorDB: 存入向量
    Embed-->>API: 嵌入完成
    API->>API: 更新文档状态 = completed
    API-->>User: 处理完成通知
```

### 支持的文件格式

| 文件格式 | 扩展名 | ETL=dify | ETL=Unstructured |
|----------|--------|----------|------------------|
| PDF | `.pdf` | ✅ | ✅ |
| Word | `.docx` | ✅ | ✅ |
| Word (旧版) | `.doc` | ❌ | ✅ |
| Excel | `.xlsx`, `.xls` | ✅ | ✅ |
| CSV | `.csv` | ✅ | ✅ |
| Markdown | `.md`, `.markdown` | ✅ | ✅ |
| HTML | `.htm`, `.html` | ✅ | ✅ |
| 纯文本 | 其他 | ✅ | ✅ |
| PowerPoint | `.pptx` | ❌ | ✅ |
| 邮件 | `.eml` | ❌ | ✅ |
| Outlook | `.msg` | ❌ | ✅ |
| XML | `.xml` | ❌ | ✅ |
| ePub | `.epub` | ✅ | ✅ |

---

## 4. 检索与重排序流程图

```mermaid
graph TB
    A[用户查询输入] --> B[RetrievalService.retrieve]

    B --> C{检索策略}
    C -->|单数据集检索 - SINGLE| D1[LLM 路由选择最相关数据集 - ReAct/Function Call]
    C -->|多数据集检索 - MULTIPLE| D2[并行检索多个数据集 - 合并结果]

    D1 --> E{检索方法}
    D2 --> E

    E -->|向量检索 - semantic_search| F1[embed_query - 查询向量化]
    F1 --> G1[search_by_vector - 向量相似度搜索]

    E -->|全文检索 - full_text_search| F2[查询文本处理]
    F2 --> G2[search_by_full_text - 全文搜索]

    E -->|混合检索 - hybrid_search| F3[并行执行 - 向量检索 + 全文检索]
    F3 --> G3[去重合并结果]

    E -->|关键词检索 - keyword_search| F4[Jieba 分词]
    F4 --> G4[TF-IDF 关键词匹配]

    G1 --> H{元数据过滤}
    G2 --> H
    G3 --> H
    G4 --> H

    H -->|disabled| I1[无过滤]
    H -->|automatic| I2[LLM 提取过滤条件]
    H -->|manual| I3[用户指定过滤条件]

    I1 --> J[DataPostProcessor - 数据后处理]
    I2 --> J
    I3 --> J

    J --> K{重排序模式}
    K -->|reranking_model| L1[RerankModelRunner - Rerank 模型重排]
    K -->|weighted_score| L2[WeightRerankRunner - 加权评分重排]
    K -->|None| L3[跳过重排序]

    L1 --> M[分数阈值过滤 - score_threshold]
    L2 --> M
    L3 --> N

    M --> N{交错重排 - ReorderRunner}
    N -->|enabled| O[Lost in the Middle 缓解 - 奇偶位交错排列]
    N -->|disabled| P[直接输出]

    O --> P
    P --> Q[返回 Top-K 检索结果]
```

### 检索方法对比

| 检索方法 | 标识 | 适用索引 | 原理 | 优势 |
|----------|------|----------|------|------|
| 向量检索 | `semantic_search` | high_quality | 嵌入向量余弦相似度 | 语义理解能力强 |
| 全文检索 | `full_text_search` | high_quality | 向量数据库全文搜索 | 关键词精确匹配 |
| 混合检索 | `hybrid_search` | high_quality | 向量 + 全文并行 | 兼顾语义与关键词 |
| 关键词检索 | `keyword_search` | economy | Jieba + TF-IDF | 成本低，速度快 |

### 重排序模式对比

| 模式 | 实现类 | 原理 | 适用场景 |
|------|--------|------|----------|
| Rerank 模型 | `RerankModelRunner` | 专用 Rerank 模型重新评分 | 精度要求高 |
| 加权评分 | `WeightRerankRunner` | 向量权重 × 相似度 + 关键词权重 × TF-IDF | 无 Rerank 模型时 |

### 检索参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `top_k` | int | 4 | 返回最大文档数 |
| `score_threshold` | float | 0.0 | 相似度阈值 |
| `score_threshold_enabled` | bool | False | 是否启用阈值过滤 |

---

## 5. 知识库维护流程图

```mermaid
graph TB
    A[知识库运行中] --> B{维护操作}

    B -->|添加文档| C[上传新文档]
    C --> D[文档处理流程 - 提取 清洗 分块 嵌入 索引]
    D --> E[新文档索引完成 - 立即可检索]

    B -->|更新文档| F[重新上传文档]
    F --> G[删除旧索引数据 - clean dataset node_ids]
    G --> H[重新处理文档 - 提取 清洗 分块 嵌入 索引]
    H --> I[文档更新完成]

    B -->|删除文档| J[标记文档为删除]
    J --> K[清理索引数据 - 从向量数据库移除]
    K --> L[删除 Document 记录]
    L --> M[文档删除完成]

    B -->|重新索引| N[选择重新索引范围 - 单个文档/全部文档]
    N --> O[清理旧索引]
    O --> P[重新执行嵌入与索引 - 使用当前嵌入模型配置]
    P --> Q[重新索引完成]

    B -->|修改配置| R{配置变更类型}
    R -->|嵌入模型变更| S[全量重新索引 - 所有文档需重新嵌入]
    R -->|分块规则变更| T[全量重新分块 - 所有文档需重新处理]
    R -->|检索参数变更| U[即时生效 - 无需重新索引]

    S --> P
    T --> D
    U --> V[配置更新完成]

    B -->|RAG Pipeline 管理| W{管道操作}
    W -->|编辑管道| X[修改 Draft Workflow - 调整数据源/索引节点]
    W -->|发布管道| Y[publish_workflow - 新版本生效]
    W -->|回滚管道| Z[restore_published_workflow_to_draft - 恢复历史版本]
    W -->|导出 DSL| AA[export_rag_pipeline_dsl - YAML 格式导出]
    W -->|导入 DSL| AB[import_rag_pipeline - YAML 解析 + 依赖安装]
```

### RAG Pipeline 生命周期

```mermaid
stateDiagram-v2
    [*] --> 创建管道: 创建 Pipeline 实例
    创建管道 --> 编辑草稿: 同步 Draft Workflow
    编辑草稿 --> 单步调试: run_draft_workflow_node
    单步调试 --> 编辑草稿: 继续修改
    编辑草稿 --> 发布: publish_workflow
    发布 --> 运行: PipelineGenerator.generate
    运行 --> 数据源获取: run_datasource_workflow_node
    数据源获取 --> 索引构建: knowledge-index 节点
    索引构建 --> 完成
    运行 --> 错误: 执行失败
    错误 --> 重试: retry_error_document
    重试 --> 运行
    发布 --> 回滚: restore_published_workflow_to_draft
    回滚 --> 编辑草稿
    发布 --> 导出DSL: export_rag_pipeline_dsl
    导入DSL --> 创建管道: import_rag_pipeline
```

### 管道模板转换映射

| 旧版配置 | 转换模板 |
|----------|----------|
| 文件上传 + 段落索引 + 高质量 | `file-general-high-quality.yml` |
| 文件上传 + 段落索引 + 经济 | `file-general-economy.yml` |
| 文件上传 + 父子层级 | `file-parentchild.yml` |
| Notion + 段落索引 + 高质量 | `notion-general-high-quality.yml` |
| Notion + 段落索引 + 经济 | `notion-general-economy.yml` |
| Notion + 父子层级 | `notion-parentchild.yml` |
| Web 爬取 + 段落索引 + 高质量 | `website-crawl-general-high-quality.yml` |
| Web 爬取 + 段落索引 + 经济 | `website-crawl-general-economy.yml` |
| Web 爬取 + 父子层级 | `website-crawl-parentchild.yml` |

---

## 6. 流程步骤说明表格

### 知识库创建步骤

| 步骤 | 操作 | 执行组件 | 输入 | 输出 |
|------|------|----------|------|------|
| 1 | 输入知识库名称 | 前端 UI | 名称 + 描述 | 表单数据 |
| 2 | 选择索引技术 | 前端 UI | high_quality / economy | 索引技术类型 |
| 3 | 选择嵌入模型 | ModelManager | tenant_id | ModelInstance |
| 4 | 选择索引结构 | IndexProcessorFactory | chunk_structure | IndexProcessor |
| 5 | 创建 Dataset | DatasetService | 配置参数 | Dataset 记录 |
| 6 | 初始化向量集合 | VectorStore | dataset_id | 向量存储空间 |

### 文档处理步骤

| 步骤 | 操作 | 执行组件 | 输入 | 输出 |
|------|------|----------|------|------|
| 1 | 上传文件 | ObjectStorage | 文件二进制 | 存储路径 |
| 2 | 创建 Document 记录 | DocumentService | 文件元数据 | Document 记录 |
| 3 | 提取文本 | ExtractProcessor | 文件路径 + 格式 | Document 列表 |
| 4 | 文本清洗 | CleanProcessor | 原始文本 | 清洗后文本 |
| 5 | 文本分块 | TextSplitter | 清洗后文本 + 分块规则 | DocumentSegment 列表 |
| 6 | 嵌入向量化 | CacheEmbedding | 文本列表 | 向量列表 |
| 7 | 存入向量库 | VectorStore | 向量 + 元数据 | 索引记录 |
| 8 | 更新文档状态 | DocumentService | completed | 状态更新 |

### 检索步骤

| 步骤 | 操作 | 执行组件 | 输入 | 输出 |
|------|------|----------|------|------|
| 1 | 查询输入 | RetrievalService | 查询文本 | 检索请求 |
| 2 | 选择检索方法 | RetrievalService | 检索配置 | 检索策略 |
| 3 | 执行检索 | VectorStore / Jieba | 查询向量/关键词 | 候选结果 |
| 4 | 元数据过滤 | RetrievalService | 过滤条件 | 过滤后结果 |
| 5 | 重排序 | RerankModelRunner / WeightRerankRunner | 候选结果 | 重排序结果 |
| 6 | 交错重排 | ReorderRunner | 排序结果 | 最终结果 |
| 7 | 阈值过滤 | DataPostProcessor | score_threshold | Top-K 结果 |

---

## 7. 关键决策点说明

### 决策点 1：索引技术类型选择

| 决策 | 条件 | 影响 |
|------|------|------|
| 高质量模式 | 需要语义检索、有嵌入模型配额 | 使用嵌入模型生成向量，支持向量/全文/混合检索 |
| 经济模式 | 成本敏感、仅需关键词匹配 | 使用 Jieba 分词，仅支持关键词检索 |

### 决策点 2：索引结构选择

| 决策 | 条件 | 影响 |
|------|------|------|
| 段落索引 | 通用场景 | 每个分块独立索引，简单直接 |
| QA 索引 | 需要问答对形式 | LLM 生成问答对，仅支持高质量模式 |
| 父子层级索引 | 需要上下文增强 | 子块检索 + 父块上下文，精度与上下文兼顾 |

### 决策点 3：检索方法选择

| 决策 | 条件 | 影响 |
|------|------|------|
| 向量检索 | 语义理解为主 | 通过嵌入向量计算语义相似度 |
| 全文检索 | 关键词精确匹配为主 | 通过向量数据库全文搜索 |
| 混合检索 | 兼顾语义与关键词 | 并行执行向量+全文，合并后重排序 |
| 关键词检索 | 经济模式 | Jieba 分词 + TF-IDF |

### 决策点 4：重排序模式选择

| 决策 | 条件 | 影响 |
|------|------|------|
| Rerank 模型 | 已配置 Rerank 模型 | 使用专用模型重新评分，精度最高 |
| 加权评分 | 无 Rerank 模型 | 向量权重 × 相似度 + 关键词权重 × TF-IDF |
| 不重排序 | 无需精排 | 直接使用检索结果排序 |

### 决策点 5：配置变更影响

| 决策 | 条件 | 影响 |
|------|------|------|
| 嵌入模型变更 | 更换嵌入模型 | 需全量重新索引，向量维度可能不同 |
| 分块规则变更 | 修改分隔符或 Token 数 | 需全量重新分块和索引 |
| 检索参数变更 | 修改 top_k / 阈值 | 即时生效，无需重新处理 |
| 重排序配置变更 | 修改 Rerank 模型或权重 | 即时生效，无需重新处理 |
