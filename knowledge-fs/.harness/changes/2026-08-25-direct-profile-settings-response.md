# Accept direct unpublished profile activation responses

## Summary

- Accept either an asynchronous profile migration response or a direct profile response from KnowledgeFS profile update operations.
- Validate direct embedding and retrieval profile responses, then reload settings so the console receives the committed revision.
- Add regression coverage for direct unpublished retrieval profile activation.

## Verification

- `uv run --project api pytest api/tests/unit_tests/services/test_knowledge_fs_data_facade.py` (90 passed)
- `uv run --project api ruff check api/services/knowledge_fs/data_facade.py api/tests/unit_tests/services/test_knowledge_fs_data_facade.py`
- `uv run --project api ruff format --check api/services/knowledge_fs/data_facade.py api/tests/unit_tests/services/test_knowledge_fs_data_facade.py`

## Deployment note

Profile activation can synchronously perform model capability preflight. Deployments using the 10-second default `KNOWLEDGE_FS_TIMEOUT_SECONDS` may time out before KnowledgeFS returns; increase the API-side value within its supported 60-second maximum and refresh settings before retrying an ambiguously timed-out mutation.
