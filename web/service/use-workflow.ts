import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { consoleQuery } from '@/service/console'

// These hooks compose the per-resource generated mutations so the cache policies
// registered in `service/console/policies/` still run for each resource kind.
// Their callers show their own failure messages.

type UpdateVersionParams = {
  resource:
    | Omit<Extract<EditorResource, { kind: 'app' }>, 'mode' | 'collaborationEnabled'>
    | Exclude<EditorResource, { kind: 'app' }>
  versionId: string
  title: string
  releaseNotes: string
}

export const useUpdateWorkflow = () => {
  const { mutateAsync: updateAppVersion } = useMutation(
    consoleQuery.apps.byAppId.workflows.byWorkflowId.patch.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const { mutateAsync: updatePipelineVersion } = useMutation(
    consoleQuery.rag.pipelines.byPipelineId.workflows.byWorkflowId.patch.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const { mutateAsync: updateSnippetVersion } = useMutation(
    consoleQuery.snippets.bySnippetId.workflows.byWorkflowId.patch.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const mutateAsync = useCallback(
    ({ resource, versionId, title, releaseNotes }: UpdateVersionParams) => {
      const body = { marked_name: title, marked_comment: releaseNotes }
      switch (resource.kind) {
        case 'app':
          return updateAppVersion({
            params: { app_id: resource.appId, workflow_id: versionId },
            body,
          })
        case 'knowledge-pipeline':
          return updatePipelineVersion({
            params: { pipeline_id: resource.pipelineId, workflow_id: versionId },
            body,
          })
        case 'snippet':
          return updateSnippetVersion({
            params: { snippet_id: resource.snippetId, workflow_id: versionId },
            body,
          })
      }
    },
    [updateAppVersion, updatePipelineVersion, updateSnippetVersion],
  )
  return { mutateAsync }
}

export const useDeleteWorkflow = (resource: EditorResource) => {
  const { mutateAsync: deleteAppVersion } = useMutation(
    consoleQuery.apps.byAppId.workflows.byWorkflowId.delete.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const { mutateAsync: deletePipelineVersion } = useMutation(
    consoleQuery.rag.pipelines.byPipelineId.workflows.byWorkflowId.delete.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const { mutateAsync: deleteSnippetVersion } = useMutation(
    consoleQuery.snippets.bySnippetId.workflows.byWorkflowId.delete.mutationOptions({
      meta: { errorToast: false },
    }),
  )

  return useCallback(
    (versionId: string) => {
      switch (resource.kind) {
        case 'app':
          return deleteAppVersion({ params: { app_id: resource.appId, workflow_id: versionId } })
        case 'knowledge-pipeline':
          return deletePipelineVersion({
            params: { pipeline_id: resource.pipelineId, workflow_id: versionId },
          })
        case 'snippet':
          return deleteSnippetVersion({
            params: { snippet_id: resource.snippetId, workflow_id: versionId },
          })
      }
    },
    [resource, deleteAppVersion, deletePipelineVersion, deleteSnippetVersion],
  )
}
