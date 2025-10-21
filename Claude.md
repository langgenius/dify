# Dify - LLMOps Platform

## Overview

Dify is an open-source LLMOps (Large Language Model Operations) platform designed to empower developers and businesses to create sustainable, AI-native applications. It provides visual orchestration tools and Backend-as-a-Service APIs for building LLM-powered applications without extensive backend development.

## Core Purpose

- **Visual Development**: Build AI applications through visual prompt engineering and orchestration
- **BaaS APIs**: Access ready-to-use backend APIs for AI capabilities
- **Multi-LLM Support**: Integrate with various LLM providers through a unified interface
- **Data Integration**: Embed custom data sources to create context-aware AI applications

## Repository Structure

```
dify/
├── api/              # Python/Flask backend service
│   ├── core/         # Core business logic
│   ├── models/       # Database models (SQLAlchemy)
│   ├── controllers/  # API controllers
│   ├── services/     # Business services
│   ├── tasks/        # Background tasks
│   └── tests/        # Backend tests
├── web/              # Next.js frontend application
│   ├── app/          # Next.js app directory
│   ├── components/   # React components
│   ├── service/      # API service layer
│   ├── hooks/        # React hooks
│   ├── types/        # TypeScript types
│   └── i18n/         # Internationalization
├── docker/           # Docker deployment configurations
├── sdks/             # Client SDKs
└── images/           # Repository images/assets
```

## Technology Stack

### Backend (api/)

- **Framework**: Flask 2.3.2
- **Database**: PostgreSQL with SQLAlchemy 1.4.28
- **LLM Integration**: LangChain 0.0.250
- **AI Providers**: OpenAI, Anthropic, Hugging Face, etc.
- **Vector Databases**: Weaviate, Qdrant
- **Task Queue**: Celery (inferred from dependencies)
- **Authentication**: Flask-Login, Authlib

### Frontend (web/)

- **Framework**: Next.js 13+ with React
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: React hooks, context
- **UI Components**: Headless UI, custom components

## Key Features

### 1. Multi-LLM Support

Compatible with multiple LLM providers:

- OpenAI (GPT-4, GPT-3.5-turbo)
- Azure OpenAI Service
- Anthropic (Claude 2, Claude Instant)
- Replicate
- Hugging Face Hub
- Chinese models (ChatGLM, Llama2, MiniMax, Spark, Wenxin, Tongyi)

### 2. Data Integration & Embedding

- Automated text preprocessing and embedding
- Support for PDF, TXT files
- Sync from Notion, webpages, APIs
- Vector database integration for context enhancement

### 3. Visual Orchestration

- Visual prompt engineering interface
- Debug and test prompts visually
- Build applications in minutes without coding

### 4. Application Types

- Chat-based applications
- Form-based applications
- Plugin-enabled smart chat (web browsing, Google search, Wikipedia)

### 5. Team Collaboration

- Workspace management
- Team member collaboration
- Shared AI applications

### 6. Analytics & Monitoring

- Visual data analysis
- Log review and inspection
- Performance monitoring

## Deployment

### Docker Deployment (Recommended)

```bash
cd docker
docker compose up -d
```

Access at: http://localhost/install

### System Requirements

- CPU >= 2 Core
- RAM >= 4GB

### Kubernetes Deployment

Helm Chart available via community contribution

## Use Cases

1. **AI Chatbots**: Build chatbots with custom business data
1. **Notion AI Assistant**: Create assistants based on personal notes
1. **Prompt Generators**: Build tools like Midjourney prompt generators
1. **Personal Assistants**: Custom AI assistants with specific knowledge bases
1. **Commercial Applications**: Production-grade AI applications

## Development Workflow

### Backend Development

- API built with Flask and follows REST principles
- Database migrations managed via Flask-Migrate
- LangChain for LLM orchestration
- Background jobs for async processing

### Frontend Development

- Next.js with App Router
- Component-based architecture
- TypeScript for type safety
- Internationalization support (English, Chinese, Japanese, Spanish)

## Configuration

Environment configurations managed through:

- `.env` files for local development
- Docker environment variables in `docker-compose.yaml`
- Configuration files in respective directories

## Contributing

The project welcomes contributions:

- Code contributions via Pull Requests
- Issue reporting for bugs and feature requests
- Sharing use cases and applications built with Dify
- Community support on Discord and GitHub

## License

Available under the Dify Open Source License

## Resources

- **Website**: https://dify.ai
- **Documentation**: https://docs.dify.ai
- **Discord**: https://discord.gg/FngNHpbcY7
- **Twitter**: @dify_ai

## Recent Development Activity

Based on recent commits:

- Dataset functionality improvements
- ESLint error fixes
- Qdrant vector database integration
- Hugging Face embedding support
- Transaction management improvements for long LLM calls

## Key Concepts

- **LLMOps**: Operations framework for LLM applications (similar to MLOps)
- **Prompt Engineering**: Visual design and optimization of prompts
- **Context Enhancement**: Embedding custom data for better AI responses
- **Backend-as-a-Service**: Pre-built APIs for AI capabilities
