import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import type { CommonNodeType, NodeDefault, NodeDefaultBase } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useFeatures } from '@/app/components/base/features/hooks'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import {
  buildNodeSelectorAvailabilityContext,
  filterNodesForSelector,
  NodeSelectorScene,
} from '@/app/components/workflow/constants/node-availability'
import { BlockEnum } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'

export const useAvailableNodesMetaData = (flowType: FlowType = FlowType.appFlow) => {
  const { t } = useTranslation()
  const isSandboxFeatureEnabled = useFeatures(s => s.features.sandbox?.enabled) ?? false
  const isSandboxRuntime = useAppStore(s => s.appDetail?.runtime_type === 'sandboxed')
  const scene = useMemo(() => {
    if (flowType === FlowType.ragPipeline)
      return NodeSelectorScene.RagPipeline
    return NodeSelectorScene.Subgraph
  }, [flowType])
  const nodeAvailabilityContext = useMemo(() => buildNodeSelectorAvailabilityContext({
    scene,
    isSandboxRuntime,
    isSandboxFeatureEnabled,
  }), [scene, isSandboxFeatureEnabled, isSandboxRuntime])

  const availableNodesMetaData = useMemo<NodeDefaultBase[]>(() => {
    const toNodeDefaultBase = (
      node: NodeDefault<CommonNodeType>,
      metaData: NodeDefaultBase['metaData'],
      defaultValue: Partial<CommonNodeType>,
    ): NodeDefaultBase => {
      return {
        ...node,
        metaData,
        defaultValue,
        checkValid: (payload: CommonNodeType, translator, moreDataForCheckValid) => {
          // normalize validator signature for shared metadata storage.
          return node.checkValid(payload, translator, moreDataForCheckValid)
        },
        getOutputVars: node.getOutputVars
          ? (payload: CommonNodeType, allPluginInfoList, ragVariables, utils) => {
              // normalize output var signature for shared metadata storage.
              return node.getOutputVars!(payload, allPluginInfoList, ragVariables, utils)
            }
          : undefined,
      }
    }

    return filterNodesForSelector(WORKFLOW_COMMON_NODES, nodeAvailabilityContext).map((node) => {
      // normalize per-node defaults into a shared metadata shape.
      const typedNode = node as NodeDefault<CommonNodeType>
      const { metaData } = typedNode
      const title = t(`blocks.${metaData.type}`, { ns: 'workflow' })
      const description = t(`blocksAbout.${metaData.type}`, { ns: 'workflow' })
      return toNodeDefaultBase(typedNode, {
        ...metaData,
        title,
        description,
      }, {
        ...typedNode.defaultValue,
        type: metaData.type,
        title,
      })
    })
  }, [nodeAvailabilityContext, t])

  const availableNodesMetaDataMap = useMemo(() => availableNodesMetaData.reduce((acc, node) => {
    acc![node.metaData.type] = node
    return acc
  }, {} as AvailableNodesMetaData['nodesMap']), [availableNodesMetaData])

  return useMemo(() => {
    return {
      nodes: availableNodesMetaData,
      nodesMap: {
        ...availableNodesMetaDataMap,
        [BlockEnum.VariableAssigner]: availableNodesMetaDataMap?.[BlockEnum.VariableAggregator],
      },
    }
  }, [availableNodesMetaData, availableNodesMetaDataMap])
}
