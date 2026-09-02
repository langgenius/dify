-- Knowledge Platform schema migration
-- Migration id: 0049_answer_trace_query_images
-- Dialect: tidb
-- Answer traces keep the query-image references they were run with so history can show them.

ALTER TABLE `answer_traces`
  ADD COLUMN IF NOT EXISTS `query_images` JSON NULL;
