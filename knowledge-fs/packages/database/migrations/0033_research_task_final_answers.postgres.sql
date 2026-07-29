-- Knowledge Platform schema migration
-- Migration id: 0033_research_task_final_answers
-- Dialect: postgres
-- Research retrieval evidence and its final LLM synthesis are returned from the same durable row.

ALTER TABLE "research_task_partial_results"
  ADD COLUMN IF NOT EXISTS "answer" TEXT;
