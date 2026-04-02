# OSOP Workflow Examples for Dify

[OSOP](https://github.com/osopcloud/osop-spec) (Open Standard for Orchestration Protocols) is a YAML-based workflow definition format that provides a portable, platform-agnostic way to describe AI agent pipelines.

## Why OSOP + Dify?

Dify workflows are powerful but live inside the Dify platform. OSOP lets you describe those same workflows in a standard YAML format so they can be:

- **Shared** across teams without requiring Dify access
- **Compared** with workflows built in other tools (n8n, LangGraph, CrewAI, etc.)
- **Version-controlled** as plain text alongside your application code
- **Validated** using the OSOP CLI before import

## Files in this directory

| File | Description |
|------|-------------|
| `dify-rag-chatbot.osop.yaml` | A retrieval-augmented generation chatbot pipeline: question → vector retrieval → rerank → cited answer → feedback loop |

## Quick start

```bash
# Install the OSOP CLI
pip install osop

# Validate the workflow
osop validate dify-rag-chatbot.osop.yaml

# Render a visual graph
osop render dify-rag-chatbot.osop.yaml -o workflow.png
```

## Learn more

- [OSOP Specification](https://github.com/osopcloud/osop-spec)
- [OSOP Examples](https://github.com/osopcloud/osop-examples) — 30+ workflow templates
- [OSOP Visual Editor](https://github.com/osopcloud/osop-editor)
