import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import { BlockEnum } from '@/app/components/workflow/types'

export const useAvailableNodesMetaData = () => {
  const { t } = useTranslation()

  const availableNodesMetaData = useMemo(() => WORKFLOW_COMMON_NODES.map((node) => {
    const { metaData } = node
    const title = t(`blocks.${metaData.type}`, { ns: 'workflow' })
    const description = t(`blocksAbout.${metaData.type}`, { ns: 'workflow' })
    return {
      ...node,
      metaData: {
        ...metaData,
        title,
        description,
      },
      defaultValue: {
        ...node.defaultValue,
        type: metaData.type,
        title,
      },
    }
  }), [t])

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
