import type { WorkflowRunDetailResponse } from '@/models/log'
import type { NodeTracing } from '@/types/workflow'
import {
  toNodeTracing,
  toWorkflowRunDetail,
} from '@/app/components/workflow/utils/workflow-response'
import { consoleClient } from './console'

export type WorkflowRunOwner =
  | Readonly<{ kind: 'app'; appId: string }>
  | Readonly<{ kind: 'knowledge-pipeline'; pipelineId: string }>
  | Readonly<{ kind: 'snippet'; snippetId: string }>

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

export const fetchRunDetail = async (
  owner: WorkflowRunOwner,
  runId: string,
): Promise<WorkflowRunDetailResponse> => toWorkflowRunDetail(await getRunDetail(owner, runId))

export const fetchTracingList = async (
  owner: WorkflowRunOwner,
  runId: string,
): Promise<NodeTracing[]> => (await getNodeExecutions(owner, runId)).data.flatMap(toNodeTracing)
