-- Knowledge Platform schema migration
-- Migration id: 0053_answer_trace_source
-- Dialect: postgres
-- Answer traces record which caller produced them (console retrieval test, workflow node, service
-- API, agent, MCP) so retrieval history can distinguish and filter them. NULL means retrieval_test.

ALTER TABLE "answer_traces"
  ADD COLUMN IF NOT EXISTS "source" TEXT;

CREATE INDEX IF NOT EXISTS "answer_traces_space_source_created_idx"
  ON "answer_traces" ("knowledge_space_id", "source", "created_at", "id");
