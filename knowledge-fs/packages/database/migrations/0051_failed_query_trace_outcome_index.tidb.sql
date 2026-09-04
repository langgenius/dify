-- Knowledge Platform schema migration
-- Migration id: 0051_failed_query_trace_outcome_index
-- Dialect: tidb
-- Supports Overview outcome joins by exact trace and trigger without scanning space history.

CREATE INDEX IF NOT EXISTS `failed_queries_trace_trigger_idx`
  ON `failed_queries` (
    `tenant_id`, `knowledge_space_id`, `answer_trace_id`
  );
