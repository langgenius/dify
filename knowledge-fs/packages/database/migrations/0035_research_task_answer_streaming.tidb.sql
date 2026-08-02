-- Knowledge Platform schema migration
-- Migration id: 0035_research_task_answer_streaming
-- Dialect: tidb
-- Allows durable Research progress streams to carry bounded, batched answer deltas.
-- TiDB DDL may commit before the migration marker, so both replacement steps are replay safe.

SET @kfs_0035_progress_event_constraint_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'research_task_progress_events'
      AND constraint_name = 'research_task_progress_event_ck'
  ),
  'ALTER TABLE `research_task_progress_events` DROP CHECK `research_task_progress_event_ck`',
  'DO 0'
);
PREPARE kfs_0035_progress_event_constraint_stmt
  FROM @kfs_0035_progress_event_constraint_sql;
EXECUTE kfs_0035_progress_event_constraint_stmt;
DEALLOCATE PREPARE kfs_0035_progress_event_constraint_stmt;

SET @kfs_0035_progress_event_constraint_sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tidb_check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'research_task_progress_events'
      AND constraint_name = 'research_task_progress_event_ck'
  ),
  'DO 0',
  'ALTER TABLE `research_task_progress_events` ADD CONSTRAINT `research_task_progress_event_ck` CHECK (`event_type` IN (''research_task.answer_delta'', ''research_task.canceled'', ''research_task.failed'', ''research_task.paused'', ''research_task.resumed'', ''research_task.stage_changed'', ''research_task.started''))'
);
PREPARE kfs_0035_progress_event_constraint_stmt
  FROM @kfs_0035_progress_event_constraint_sql;
EXECUTE kfs_0035_progress_event_constraint_stmt;
DEALLOCATE PREPARE kfs_0035_progress_event_constraint_stmt;
