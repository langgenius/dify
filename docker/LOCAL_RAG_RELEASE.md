# Local RAG Release

## 1.13.0-codex-rag.1

Release date: 2026-05-06

Base Dify version: 1.13.0

Runtime image tags:

- `codex-rag-api:1.13.0-local`
- `codex-rag-web:1.13.0`
- `codex-rag-pgvector:pg16-bigm`

Validated environment:

- Canonical WSL workspace: `/home/koishi/projects/codex_RAG/dify/docker`
- Docker Compose start command: `docker compose up -d`
- Chat model endpoint: LM Studio OpenAI-compatible endpoint
- Embedding model: Ollama `nomic-embed-text`

Validation summary:

- API image rebuild completed successfully.
- `api`, `worker`, and `worker_beat` were recreated from the rebuilt image.
- Evaluation preflight passed with Docker CLI, compose services, eval lock, Ollama model, plugin path, and chat API checks.
- Full navigation/preflight evaluation completed with 100% chat success and 0 timeouts across the official evaluation sets.

Known residual accuracy work:

- `generalization_boost_matrix_cases` still needs answer selection improvement for the RB-IGBT efficiency improvement case.
- Ambiguous no-document-hint `Table 3` / `Figure 7` holdout cases still need bounded backtracking or clarification handling.
