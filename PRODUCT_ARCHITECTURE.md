# Dify Product Architecture

## Functional Diagram

```mermaid
flowchart TB
    subgraph Users["👥 Users & Clients"]
        WebUI["Web Console<br/>(Next.js)"]
        API_Client["API Clients<br/>(SDKs/REST)"]
        Webhooks["External<br/>Webhooks"]
    end

    subgraph Frontend["🖥️ Frontend Layer"]
        subgraph Console["Console UI"]
            AppStudio["App Studio<br/>/apps"]
            WorkflowEditor["Workflow Editor<br/>/app/(appDetailLayout)"]
            DatasetUI["Knowledge Base<br/>/datasets"]
            ToolsUI["Tools Manager<br/>/tools"]
            PluginsUI["Plugin Store<br/>/plugins"]
        end
        subgraph SharedUI["Public UI"]
            ChatWidget["Chat Widget"]
            SharePages["Share Pages"]
        end
    end

    subgraph API["🔧 API Layer (Flask)"]
        subgraph Controllers["Controllers"]
            ConsoleAPI["Console API<br/>/console"]
            ServiceAPI["Service API<br/>/v1"]
            WebAPI["Web API<br/>/web"]
            InnerAPI["Inner API<br/>/inner"]
        end

        subgraph Middleware["Middleware"]
            Auth["Authentication<br/>(JWT/API Key)"]
            RBAC["Access Control<br/>(Tenant/Role)"]
            RateLimit["Rate Limiting"]
        end
    end

    subgraph Services["📦 Service Layer"]
        AppService["App Service"]
        WorkflowService["Workflow Service"]
        DatasetService["Dataset Service"]
        MessageService["Message Service"]
        ConversationService["Conversation Service"]
        ModelProviderService["Model Provider Service"]
        AnnotationService["Annotation Service"]
    end

    subgraph Core["⚙️ Core Domain Layer"]
        subgraph WorkflowEngine["Workflow Engine"]
            GraphEngine["Graph Engine"]
            NodeExecutor["Node Executor"]
            VariablePool["Variable Pool"]
            EventManager["Event Manager"]

            subgraph Nodes["Workflow Nodes"]
                StartEnd["Start/End"]
                LLMNode["LLM Node"]
                AgentNode["Agent Node"]
                ToolNode["Tool Node"]
                KnowledgeNode["Knowledge<br/>Retrieval"]
                CodeNode["Code Node"]
                HTTPNode["HTTP Request"]
                ConditionNode["If/Else<br/>Iteration"]
                HumanNode["Human Input"]
            end
        end

        subgraph RAGPipeline["RAG Pipeline"]
            FileParser["File Parser<br/>(PDF/DOCX/etc)"]
            TextSplitter["Text Splitter"]
            EmbeddingGen["Embedding<br/>Generator"]
            Retrieval["Retrieval<br/>Engine"]
            Reranker["Reranker"]
        end

        subgraph AgentSystem["Agent System"]
            CoTAgent["Chain-of-Thought<br/>Agent"]
            FCAgent["Function Calling<br/>Agent"]
            ToolManager["Tool Manager"]
        end

        subgraph ModelRuntime["Model Runtime"]
            LLMProvider["LLM Providers"]
            EmbedProvider["Embedding<br/>Providers"]
            RerankProvider["Rerank<br/>Providers"]
            SpeechProvider["Speech<br/>Providers"]
        end

        subgraph TriggerSystem["Trigger System"]
            WebhookTrigger["Webhook<br/>Triggers"]
            ScheduleTrigger["Schedule<br/>Triggers"]
            PluginTrigger["Plugin<br/>Triggers"]
        end

        subgraph ToolSystem["Tool System"]
            BuiltinTools["Builtin Tools<br/>(50+)"]
            CustomTools["Custom Tools"]
            MCPTools["MCP Tools"]
            WorkflowTools["Workflow<br/>as Tools"]
        end
    end

    subgraph AsyncTasks["🔄 Async Task Layer (Celery)"]
        TaskQueue["Task Queues"]
        CeleryWorker["Celery Workers"]
        CeleryBeat["Celery Beat<br/>(Scheduler)"]

        subgraph Queues["Task Queues"]
            DatasetQueue["dataset"]
            PipelineQueue["pipeline"]
            ConvoQueue["conversation"]
            MailQueue["mail"]
            ScheduleQueue["schedule"]
        end
    end

    subgraph Storage["💾 Storage Layer"]
        subgraph Databases["Databases"]
            PostgreSQL[("PostgreSQL<br/>Primary DB")]
            Redis[("Redis<br/>Cache/Broker")]
        end

        subgraph VectorStores["Vector Stores"]
            Weaviate[("Weaviate")]
            Pinecone[("Pinecone")]
            Milvus[("Milvus")]
            Qdrant[("Qdrant")]
        end

        ObjectStorage[("S3/Object<br/>Storage")]
    end

    subgraph External["🌐 External Services"]
        subgraph LLMs["LLM Providers"]
            OpenAI["OpenAI"]
            Anthropic["Anthropic"]
            GoogleAI["Google AI"]
            Ollama["Ollama/Local"]
            OtherLLM["150+ Others"]
        end

        subgraph ExtTools["External Tools"]
            GoogleSearch["Google Search"]
            WebScraper["Web Scrapers<br/>(Jina/FireCrawl)"]
            ImageGen["Image Gen<br/>(DALL-E/SD)"]
            Wolfram["WolframAlpha"]
        end
    end

    %% User Connections
    WebUI --> Console
    WebUI --> SharedUI
    API_Client --> ServiceAPI
    Webhooks --> WebhookTrigger

    %% Frontend to API
    Console --> ConsoleAPI
    SharedUI --> WebAPI

    %% API Layer Flow
    ConsoleAPI --> Middleware
    ServiceAPI --> Middleware
    WebAPI --> Middleware
    Middleware --> Services

    %% Service to Core
    AppService --> WorkflowEngine
    WorkflowService --> WorkflowEngine
    DatasetService --> RAGPipeline
    MessageService --> WorkflowEngine
    MessageService --> AgentSystem
    ModelProviderService --> ModelRuntime

    %% Workflow Engine Internal
    GraphEngine --> NodeExecutor
    NodeExecutor --> Nodes
    NodeExecutor --> VariablePool
    GraphEngine --> EventManager

    %% Node Connections
    LLMNode --> ModelRuntime
    AgentNode --> AgentSystem
    ToolNode --> ToolSystem
    KnowledgeNode --> RAGPipeline

    %% Agent System
    CoTAgent --> ToolManager
    FCAgent --> ToolManager
    ToolManager --> ToolSystem

    %% RAG Pipeline Flow
    FileParser --> TextSplitter
    TextSplitter --> EmbeddingGen
    EmbeddingGen --> VectorStores
    Retrieval --> VectorStores
    Retrieval --> Reranker

    %% Model Runtime to External
    LLMProvider --> LLMs
    EmbedProvider --> LLMs
    RerankProvider --> LLMs

    %% Tool System to External
    BuiltinTools --> ExtTools

    %% Async Tasks
    Services --> TaskQueue
    TaskQueue --> CeleryWorker
    CeleryBeat --> ScheduleTrigger

    %% Storage Connections
    Services --> PostgreSQL
    Services --> Redis
    RAGPipeline --> VectorStores
    Services --> ObjectStorage
    TaskQueue --> Redis

    %% Styling
    classDef frontend fill:#e1f5fe,stroke:#01579b
    classDef api fill:#fff3e0,stroke:#e65100
    classDef service fill:#f3e5f5,stroke:#7b1fa2
    classDef core fill:#e8f5e9,stroke:#2e7d32
    classDef async fill:#fce4ec,stroke:#c2185b
    classDef storage fill:#fff8e1,stroke:#f9a825
    classDef external fill:#eceff1,stroke:#546e7a

    class WebUI,API_Client,Webhooks frontend
    class Console,SharedUI,AppStudio,WorkflowEditor,DatasetUI,ToolsUI,PluginsUI,ChatWidget,SharePages frontend
    class Controllers,Middleware,ConsoleAPI,ServiceAPI,WebAPI,InnerAPI,Auth,RBAC,RateLimit api
    class Services,AppService,WorkflowService,DatasetService,MessageService,ConversationService,ModelProviderService,AnnotationService service
    class Core,WorkflowEngine,RAGPipeline,AgentSystem,ModelRuntime,TriggerSystem,ToolSystem core
    class AsyncTasks,TaskQueue,CeleryWorker,CeleryBeat,Queues async
    class Storage,Databases,VectorStores,PostgreSQL,Redis,Weaviate,Pinecone,Milvus,Qdrant,ObjectStorage storage
    class External,LLMs,ExtTools,OpenAI,Anthropic,GoogleAI,Ollama,OtherLLM,GoogleSearch,WebScraper,ImageGen,Wolfram external
```

## Data Flow Diagrams

### Chat/Conversation Flow

```mermaid
sequenceDiagram
    participant User
    participant WebUI as Web UI
    participant API as API Controller
    participant Auth as Auth Middleware
    participant MsgSvc as Message Service
    participant WfEngine as Workflow Engine
    participant LLM as LLM Provider
    participant DB as PostgreSQL
    participant Redis

    User->>WebUI: Send message
    WebUI->>API: POST /chat-messages
    API->>Auth: Validate JWT/API Key
    Auth->>API: User + Tenant context
    API->>MsgSvc: Process message
    MsgSvc->>DB: Store message
    MsgSvc->>Redis: Queue async task

    Note over Redis,WfEngine: Celery Worker picks up task

    Redis->>WfEngine: Execute workflow
    WfEngine->>WfEngine: Process nodes
    WfEngine->>LLM: Generate response
    LLM-->>WfEngine: Response stream
    WfEngine->>DB: Update conversation
    WfEngine-->>WebUI: Stream response (WebSocket)
    WebUI-->>User: Display response
```

### RAG Document Indexing Flow

```mermaid
sequenceDiagram
    participant User
    participant API as API Controller
    participant DatasetSvc as Dataset Service
    participant Parser as File Parser
    participant Splitter as Text Splitter
    participant Embed as Embedding Generator
    participant Vector as Vector Store
    participant DB as PostgreSQL
    participant Celery

    User->>API: Upload document
    API->>DatasetSvc: Create document
    DatasetSvc->>DB: Store document metadata
    DatasetSvc->>Celery: Queue indexing task

    Note over Celery,Vector: Async Processing

    Celery->>Parser: Parse file (PDF/DOCX/etc)
    Parser-->>Celery: Raw text
    Celery->>Splitter: Split into chunks
    Splitter-->>Celery: Text segments

    loop For each segment
        Celery->>Embed: Generate embedding
        Embed-->>Celery: Vector
        Celery->>Vector: Store vector + metadata
        Celery->>DB: Store segment record
    end

    Celery->>DB: Update document status
```

### RAG Retrieval Flow

```mermaid
sequenceDiagram
    participant WfEngine as Workflow Engine
    participant KnowledgeNode as Knowledge Retrieval Node
    participant Embed as Embedding Generator
    participant Vector as Vector Store
    participant Rerank as Reranker
    participant LLM as LLM Node

    WfEngine->>KnowledgeNode: Execute retrieval
    KnowledgeNode->>Embed: Embed query
    Embed-->>KnowledgeNode: Query vector

    par Hybrid Search
        KnowledgeNode->>Vector: Vector similarity search
        KnowledgeNode->>Vector: Keyword search (BM25)
    end

    Vector-->>KnowledgeNode: Combined results
    KnowledgeNode->>Rerank: Rerank results
    Rerank-->>KnowledgeNode: Ranked segments
    KnowledgeNode-->>WfEngine: Top-k segments
    WfEngine->>LLM: Query + Context
    LLM-->>WfEngine: Generated response
```

### Agent Execution Flow

```mermaid
sequenceDiagram
    participant WfEngine as Workflow Engine
    participant AgentNode as Agent Node
    participant Agent as Agent Runner
    participant LLM as LLM Provider
    participant ToolMgr as Tool Manager
    participant Tool as External Tool

    WfEngine->>AgentNode: Execute agent
    AgentNode->>Agent: Initialize (CoT/FC)

    loop Until final answer
        Agent->>LLM: Send prompt + history
        LLM-->>Agent: Thought + Action

        alt Tool Call Required
            Agent->>ToolMgr: Execute tool
            ToolMgr->>Tool: Call external API
            Tool-->>ToolMgr: Result
            ToolMgr-->>Agent: Tool output
            Agent->>Agent: Add to context
        else Final Answer
            Agent-->>AgentNode: Return response
        end
    end

    AgentNode-->>WfEngine: Agent output
```

## Component Architecture

### Multi-Tenancy Model

```mermaid
erDiagram
    Account ||--o{ TenantAccountJoin : "belongs to"
    Tenant ||--o{ TenantAccountJoin : "has members"
    Tenant ||--o{ App : "owns"
    Tenant ||--o{ Dataset : "owns"
    App ||--o| Workflow : "has"
    App ||--o{ Conversation : "has"
    Conversation ||--o{ Message : "contains"
    Dataset ||--o{ Document : "contains"
    Document ||--o{ DocumentSegment : "split into"

    Account {
        uuid id PK
        string email
        string name
        string password_hash
    }

    Tenant {
        uuid id PK
        string name
        string plan
        json settings
    }

    TenantAccountJoin {
        uuid id PK
        uuid account_id FK
        uuid tenant_id FK
        string role
    }

    App {
        uuid id PK
        uuid tenant_id FK
        string name
        string mode
        json config
    }

    Workflow {
        uuid id PK
        uuid app_id FK
        json graph
        string version
    }

    Dataset {
        uuid id PK
        uuid tenant_id FK
        string name
        string embedding_model
    }

    Document {
        uuid id PK
        uuid dataset_id FK
        string name
        string status
    }

    DocumentSegment {
        uuid id PK
        uuid document_id FK
        text content
        vector embedding
    }
```

### Workflow Node Types

```mermaid
graph LR
    subgraph "I/O Nodes"
        Start["🟢 Start"]
        End["🔴 End"]
        Answer["💬 Answer"]
        HumanInput["👤 Human Input"]
    end

    subgraph "Logic Nodes"
        IfElse["🔀 If/Else"]
        Iteration["🔁 Iteration"]
        Loop["♻️ Loop"]
        Classifier["🏷️ Question Classifier"]
    end

    subgraph "AI Nodes"
        LLM["🤖 LLM"]
        Agent["🦾 Agent"]
        KnowledgeRetrieval["📚 Knowledge Retrieval"]
        ParameterExtractor["📋 Parameter Extractor"]
    end

    subgraph "Tool Nodes"
        Tool["🔧 Tool"]
        HTTP["🌐 HTTP Request"]
        Code["💻 Code"]
        Template["📝 Template Transform"]
    end

    subgraph "Data Nodes"
        VarAssigner["📥 Variable Assigner"]
        ListOp["📊 List Operator"]
        DocExtractor["📄 Document Extractor"]
    end

    subgraph "Trigger Nodes"
        Webhook["🔗 Webhook Trigger"]
        Schedule["⏰ Schedule Trigger"]
        Plugin["🔌 Plugin Trigger"]
    end
```

### Deployment Architecture

```mermaid
graph TB
    subgraph "Load Balancer"
        LB["Nginx/ALB"]
    end

    subgraph "Application Tier"
        subgraph "Web Servers"
            Web1["Web (Next.js)"]
            Web2["Web (Next.js)"]
        end

        subgraph "API Servers"
            API1["API (Flask)"]
            API2["API (Flask)"]
        end

        subgraph "Workers"
            Worker1["Celery Worker"]
            Worker2["Celery Worker"]
            Beat["Celery Beat"]
        end
    end

    subgraph "Data Tier"
        subgraph "Primary"
            PG[("PostgreSQL")]
            Redis[("Redis")]
        end

        subgraph "Vector"
            Weaviate[("Weaviate")]
        end

        subgraph "Object Storage"
            S3[("S3/MinIO")]
        end
    end

    subgraph "External"
        LLMs["LLM APIs"]
        Tools["External Tools"]
    end

    LB --> Web1 & Web2
    LB --> API1 & API2

    Web1 & Web2 --> API1 & API2
    API1 & API2 --> PG & Redis
    API1 & API2 --> Weaviate
    API1 & API2 --> S3

    Worker1 & Worker2 --> PG & Redis
    Worker1 & Worker2 --> Weaviate
    Worker1 & Worker2 --> LLMs
    Worker1 & Worker2 --> Tools

    Redis --> Worker1 & Worker2
    Beat --> Redis
```

## Layer Summary

| Layer | Technology | Responsibility |
|-------|-----------|----------------|
| **Frontend** | Next.js, React, TypeScript | User interface, workflow editor, chat UI |
| **API** | Flask, SQLAlchemy | REST endpoints, authentication, request handling |
| **Service** | Python | Business logic orchestration, validation |
| **Core** | Python | Domain logic: workflows, RAG, agents, tools |
| **Async** | Celery, Redis | Background tasks, scheduling, queues |
| **Storage** | PostgreSQL, Redis, Vector DBs, S3 | Persistence, caching, embeddings, files |
| **External** | LLM APIs, Tool APIs | AI models, external integrations |
