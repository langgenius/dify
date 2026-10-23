# KnowledgeFS contract pin

These JSON artifacts are the reviewed boundary to the standalone private KnowledgeFS repository. Dify CI needs only this directory and the Python runtime; it does not clone KnowledgeFS or run TypeScript tooling.

Run `uv run --project api python api/dev/generate_knowledge_fs_contract.py --check` to verify every artifact digest, the Capability v2 profile and signed public-key vector, and the Dify product/issuer declarations against the exported OpenAPI and capability policy.

After committing and reviewing a KnowledgeFS change, run:

```sh
uv run --project api python api/dev/generate_knowledge_fs_contract.py \
  --update-lock --knowledge-fs-root /path/to/knowledge-fs
```

Updates require a clean, committed source checkout. The schema-6 lock records the exact commit and root tree from `source-provenance.json`, plus SHA-256 hashes of all exported JSON artifacts and both Dify operation manifests. Review and commit the artifacts, provenance, operation manifests, and lock together. No TypeScript implementation is vendored here. KnowledgeFS owns its build, type checks, coverage, and runtime tests in its separate CI.
