import type { WorkflowNodesMap } from '@/app/components/base/prompt-editor/types'
import { useQuery } from '@tanstack/react-query'
import { BlockEnum } from '@/app/components/workflow/types'
import { extractPluginId } from '@/app/components/workflow/utils/plugin'
import { consoleQuery } from '@/service/console'

export function useLlmModelPluginInstalled(
  nodeId: string,
  workflowNodesMap: WorkflowNodesMap | undefined,
): boolean {
  const node = workflowNodesMap?.[nodeId]
  const modelProvider = node?.type === BlockEnum.LLM ? node.modelProvider : undefined
  const modelPluginId = modelProvider ? extractPluginId(modelProvider) : undefined

  const { data: isInstalled = !modelPluginId } = useQuery(
    consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions({
      select: (response) =>
        !modelPluginId ||
        response.data.some((provider) => extractPluginId(provider.provider) === modelPluginId),
    }),
  )

  return isInstalled
}
