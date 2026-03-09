import type { WorkflowNodesMap } from '@/app/components/base/prompt-editor/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { extractPluginId } from '@/app/components/workflow/utils/plugin'
import { useProviderContextSelector } from '@/context/provider-context'

export function useLlmModelPluginInstalled(
  nodeId: string,
  workflowNodesMap: WorkflowNodesMap | undefined,
): boolean {
  const node = workflowNodesMap?.[nodeId]
  const modelProvider = node?.type === BlockEnum.LLM
    ? node.modelProvider
    : undefined
  const modelPluginId = modelProvider ? extractPluginId(modelProvider) : undefined

  return useProviderContextSelector((state) => {
    if (!modelPluginId)
      return true
    return state.modelProviders.some(p =>
      extractPluginId(p.provider) === modelPluginId,
    )
  })
}
