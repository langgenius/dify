import type { EvaluationResourceType } from '../../../types'
import { useMemo } from 'react'
import { useSnippetPublishedWorkflow } from '@/service/use-snippet-workflows'
import { useAppWorkflow } from '@/service/use-workflow'
import { getSnippetInputFields, getStartNodeInputFields } from './input-fields-utils'

export const usePublishedInputFields = (
  resourceType: EvaluationResourceType,
  resourceId: string,
) => {
  const { data: currentAppWorkflow, isLoading: isAppWorkflowLoading } = useAppWorkflow(resourceType === 'apps' ? resourceId : '')
  const { data: currentSnippetWorkflow, isLoading: isSnippetWorkflowLoading } = useSnippetPublishedWorkflow(resourceType === 'snippets' ? resourceId : '')

  const inputFields = useMemo(() => {
    if (resourceType === 'apps')
      return getStartNodeInputFields(currentAppWorkflow?.graph.nodes)

    if (resourceType === 'snippets')
      return getSnippetInputFields(currentSnippetWorkflow?.input_fields)

    return []
  }, [currentAppWorkflow?.graph.nodes, currentSnippetWorkflow?.input_fields, resourceType])

  return {
    inputFields,
    isInputFieldsLoading: (resourceType === 'apps' && isAppWorkflowLoading)
      || (resourceType === 'snippets' && isSnippetWorkflowLoading),
  }
}
