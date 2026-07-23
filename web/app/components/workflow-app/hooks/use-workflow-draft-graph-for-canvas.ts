import type { Node, WorkflowDataUpdater } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import startPlaceholderDefault from '@/app/components/workflow/nodes/start-placeholder/default'
import { BlockEnum } from '@/app/components/workflow/types'
import { generateNewNode } from '@/app/components/workflow/utils'
import { AppModeEnum } from '@/types/app'

type HydrateWorkflowDraftGraphOptions = {
  localStartPlaceholderNodes?: Node[]
}

const hasWorkflowEntryNode = (nodes: Node[] = []): boolean => {
  return nodes.some(
    (node) =>
      node?.data?.type === BlockEnum.Start ||
      node?.data?.type === BlockEnum.TriggerSchedule ||
      node?.data?.type === BlockEnum.TriggerWebhook ||
      node?.data?.type === BlockEnum.TriggerPlugin,
  )
}

const hasStartPlaceholderNode = (nodes: Node[] = []): boolean => {
  return nodes.some((node) => node?.data?.type === BlockEnum.StartPlaceholder)
}

export const useWorkflowDraftGraphForCanvas = (appMode?: AppModeEnum | string) => {
  const { t } = useTranslation()

  const getNodesWithLocalStartPlaceholder = useCallback(
    (nodes: Node[] = [], localStartPlaceholderNodes?: Node[]) => {
      if (
        appMode !== AppModeEnum.WORKFLOW ||
        hasWorkflowEntryNode(nodes) ||
        hasStartPlaceholderNode(nodes)
      )
        return nodes

      if (localStartPlaceholderNodes?.length) return [...localStartPlaceholderNodes, ...nodes]

      const { newNode: startPlaceholderNode } = generateNewNode({
        data: {
          ...startPlaceholderDefault.defaultValue,
          selected: true,
          type: startPlaceholderDefault.metaData.type,
          title: t(($) => $[`blocks.${startPlaceholderDefault.metaData.type}`], { ns: 'workflow' }),
          desc: '',
        },
        position: START_INITIAL_POSITION,
      })

      return [startPlaceholderNode, ...nodes]
    },
    [appMode, t],
  )

  const getWorkflowDraftGraphForCanvas = useCallback(
    (
      graph?: Partial<WorkflowDataUpdater>,
      options?: HydrateWorkflowDraftGraphOptions,
    ): WorkflowDataUpdater => {
      const nodes = getNodesWithLocalStartPlaceholder(
        graph?.nodes || [],
        options?.localStartPlaceholderNodes,
      )

      return {
        nodes,
        edges: graph?.edges || [],
        viewport: graph?.viewport || { x: 0, y: 0, zoom: 1 },
      }
    },
    [getNodesWithLocalStartPlaceholder],
  )

  return {
    getWorkflowDraftGraphForCanvas,
  }
}
