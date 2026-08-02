-- Knowledge Platform schema migration
-- Migration id: 0035_research_task_answer_streaming
-- Dialect: postgres
-- Allows durable Research progress streams to carry bounded, batched answer deltas.

ALTER TABLE "research_task_progress_events"
  DROP CONSTRAINT IF EXISTS "research_task_progress_event_ck";

ALTER TABLE "research_task_progress_events"
  ADD CONSTRAINT "research_task_progress_event_ck" CHECK (
    "event_type" IN (
      'research_task.answer_delta', 'research_task.canceled', 'research_task.failed',
      'research_task.paused', 'research_task.resumed', 'research_task.stage_changed',
      'research_task.started'
    )
  );
