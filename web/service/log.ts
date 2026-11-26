import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracingListResponse } from '@/types/workflow'
import { consoleClient } from './console'

// The app, knowledge pipeline or snippet that owns a workflow run. An `EditorResource` fits.
export type WorkflowRunOwner =
  | Readonly<{ kind: 'app'; appId: string }>
  | Readonly<{ kind: 'knowledge-pipeline'; pipelineId: string }>
  | Readonly<{ kind: 'snippet'; snippetId: string }>

export const getRunOwnerId = (owner: WorkflowRunOwner): string => {
  switch (owner.kind) {
    case 'app':
      return owner.appId
    case 'knowledge-pipeline':
      return owner.pipelineId
    case 'snippet':
      return owner.snippetId
  }
}

const getRunDetail = (owner: WorkflowRunOwner, runId: string) => {
  switch (owner.kind) {
    case 'app':
      return consoleClient.apps.byAppId.workflowRuns.byRunId.get({
        params: { app_id: owner.appId, run_id: runId },
      })
    case 'knowledge-pipeline':
      return consoleClient.rag.pipelines.byPipelineId.workflowRuns.byRunId.get({
        params: { pipeline_id: owner.pipelineId, run_id: runId },
      })
    case 'snippet':
      return consoleClient.snippets.bySnippetId.workflowRuns.byRunId.get({
        params: { snippet_id: owner.snippetId, run_id: runId },
      })
  }
}

const getNodeExecutions = (owner: WorkflowRunOwner, runId: string) => {
  switch (owner.kind) {
    case 'app':
      return consoleClient.apps.byAppId.workflowRuns.byRunId.nodeExecutions.get({
        params: { app_id: owner.appId, run_id: runId },
      })
    case 'knowledge-pipeline':
      return consoleClient.rag.pipelines.byPipelineId.workflowRuns.byRunId.nodeExecutions.get({
        params: { pipeline_id: owner.pipelineId, run_id: runId },
      })
    case 'snippet':
      return consoleClient.snippets.bySnippetId.workflowRuns.byRunId.nodeExecutions.get({
        params: { snippet_id: owner.snippetId, run_id: runId },
      })
  }
}

export const fetchRunDetail = (
  owner: WorkflowRunOwner,
  runId: string,
): Promise<WorkflowRunDetailResponse> =>
  // The generated response schemas leave out fields the run panel reads, so keep the hand-written type.
  getRunDetail(owner, runId) as Promise<unknown> as Promise<WorkflowRunDetailResponse>

export const fetchTracingList = (
  owner: WorkflowRunOwner,
  runId: string,
): Promise<NodeTracingListResponse> =>
  // The generated response schemas leave out fields the run panel reads, so keep the hand-written type.
  getNodeExecutions(owner, runId) as Promise<unknown> as Promise<NodeTracingListResponse>
