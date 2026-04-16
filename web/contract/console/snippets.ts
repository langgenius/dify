import type {
  CreateSnippetPayload,
  IncrementSnippetUseCountResponse,
  PublishSnippetWorkflowResponse,
  Snippet,
  SnippetDraftConfig,
  SnippetDraftNodeRunPayload,
  SnippetDraftRunPayload,
  SnippetDraftSyncPayload,
  SnippetDraftSyncResponse,
  SnippetImportPayload,
  SnippetIterationNodeRunPayload,
  SnippetListResponse,
  SnippetLoopNodeRunPayload,
  SnippetWorkflow,
  UpdateSnippetPayload,
  WorkflowNodeExecution,
  WorkflowNodeExecutionListResponse,
  WorkflowRunDetail,
  WorkflowRunPagination,
} from '@/types/snippet'
import { type } from '@orpc/contract'
import { base } from '../base'

export const listCustomizedSnippetsContract = base
  .route({
    path: '/workspaces/current/customized-snippets',
    method: 'GET',
  })
  .input(type<{
    query: {
      page: number
      limit: number
      keyword?: string
      creator_id?: string
      is_published?: boolean
    }
  }>())
  .output(type<SnippetListResponse>())

export const createCustomizedSnippetContract = base
  .route({
    path: '/workspaces/current/customized-snippets',
    method: 'POST',
  })
  .input(type<{
    body: CreateSnippetPayload
  }>())
  .output(type<Snippet>())

export const getCustomizedSnippetContract = base
  .route({
    path: '/workspaces/current/customized-snippets/{snippetId}',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
    }
  }>())
  .output(type<Snippet>())

export const updateCustomizedSnippetContract = base
  .route({
    path: '/workspaces/current/customized-snippets/{snippetId}',
    method: 'PATCH',
  })
  .input(type<{
    params: {
      snippetId: string
    }
    body: UpdateSnippetPayload
  }>())
  .output(type<Snippet>())

export const deleteCustomizedSnippetContract = base
  .route({
    path: '/workspaces/current/customized-snippets/{snippetId}',
    method: 'DELETE',
  })
  .input(type<{
    params: {
      snippetId: string
    }
  }>())
  .output(type<unknown>())

export const exportCustomizedSnippetContract = base
  .route({
    path: '/workspaces/current/customized-snippets/{snippetId}/export',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
    }
    query: {
      include_secret?: 'true' | 'false'
    }
  }>())
  .output(type<string>())

export const importCustomizedSnippetContract = base
  .route({
    path: '/workspaces/current/customized-snippets/imports',
    method: 'POST',
  })
  .input(type<{
    body: SnippetImportPayload
  }>())
  .output(type<unknown>())

export const confirmSnippetImportContract = base
  .route({
    path: '/workspaces/current/customized-snippets/imports/{importId}/confirm',
    method: 'POST',
  })
  .input(type<{
    params: {
      importId: string
    }
  }>())
  .output(type<unknown>())

export const checkSnippetDependenciesContract = base
  .route({
    path: '/workspaces/current/customized-snippets/{snippetId}/check-dependencies',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
    }
  }>())
  .output(type<unknown>())

export const incrementSnippetUseCountContract = base
  .route({
    path: '/workspaces/current/customized-snippets/{snippetId}/use-count/increment',
    method: 'POST',
  })
  .input(type<{
    params: {
      snippetId: string
    }
  }>())
  .output(type<IncrementSnippetUseCountResponse>())

export const getSnippetDraftWorkflowContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/draft',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
    }
  }>())
  .output(type<SnippetWorkflow>())

export const syncSnippetDraftWorkflowContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/draft',
    method: 'POST',
  })
  .input(type<{
    params: {
      snippetId: string
    }
    body: SnippetDraftSyncPayload
  }>())
  .output(type<SnippetDraftSyncResponse>())

export const getSnippetDraftConfigContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/draft/config',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
    }
  }>())
  .output(type<SnippetDraftConfig>())

export const getSnippetPublishedWorkflowContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/publish',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
    }
  }>())
  .output(type<SnippetWorkflow>())

export const publishSnippetWorkflowContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/publish',
    method: 'POST',
  })
  .input(type<{
    params: {
      snippetId: string
    }
  }>())
  .output(type<PublishSnippetWorkflowResponse>())

export const getSnippetDefaultBlockConfigsContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/default-workflow-block-configs',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
    }
  }>())
  .output(type<unknown>())

export const listSnippetWorkflowRunsContract = base
  .route({
    path: '/snippets/{snippetId}/workflow-runs',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
    }
    query: {
      last_id?: string
      limit?: number
    }
  }>())
  .output(type<WorkflowRunPagination>())

export const getSnippetWorkflowRunDetailContract = base
  .route({
    path: '/snippets/{snippetId}/workflow-runs/{runId}',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
      runId: string
    }
  }>())
  .output(type<WorkflowRunDetail>())

export const listSnippetWorkflowRunNodeExecutionsContract = base
  .route({
    path: '/snippets/{snippetId}/workflow-runs/{runId}/node-executions',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
      runId: string
    }
  }>())
  .output(type<WorkflowNodeExecutionListResponse>())

export const runSnippetDraftNodeContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/draft/nodes/{nodeId}/run',
    method: 'POST',
  })
  .input(type<{
    params: {
      snippetId: string
      nodeId: string
    }
    body: SnippetDraftNodeRunPayload
  }>())
  .output(type<WorkflowNodeExecution>())

export const getSnippetDraftNodeLastRunContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/draft/nodes/{nodeId}/last-run',
    method: 'GET',
  })
  .input(type<{
    params: {
      snippetId: string
      nodeId: string
    }
  }>())
  .output(type<WorkflowNodeExecution>())

export const runSnippetDraftIterationNodeContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/draft/iteration/nodes/{nodeId}/run',
    method: 'POST',
  })
  .input(type<{
    params: {
      snippetId: string
      nodeId: string
    }
    body: SnippetIterationNodeRunPayload
  }>())
  .output(type<unknown>())

export const runSnippetDraftLoopNodeContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/draft/loop/nodes/{nodeId}/run',
    method: 'POST',
  })
  .input(type<{
    params: {
      snippetId: string
      nodeId: string
    }
    body: SnippetLoopNodeRunPayload
  }>())
  .output(type<unknown>())

export const runSnippetDraftWorkflowContract = base
  .route({
    path: '/snippets/{snippetId}/workflows/draft/run',
    method: 'POST',
  })
  .input(type<{
    params: {
      snippetId: string
    }
    body: SnippetDraftRunPayload
  }>())
  .output(type<unknown>())

export const stopSnippetWorkflowTaskContract = base
  .route({
    path: '/snippets/{snippetId}/workflow-runs/tasks/{taskId}/stop',
    method: 'POST',
  })
  .input(type<{
    params: {
      snippetId: string
      taskId: string
    }
  }>())
  .output(type<unknown>())
