import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import dataSourceEmptyDefault from '@/app/components/workflow/nodes/data-source-empty/default'
import dataSourceDefault from '@/app/components/workflow/nodes/data-source/default'
import knowledgeBaseDefault from '@/app/components/workflow/nodes/knowledge-base/default'
import { BlockEnum } from '@/app/components/workflow/types'
import { useDocLink } from '@/context/i18n'

export const useAvailableNodesMetaData = () => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  const mergedNodesMetaData = useMemo(() => [
    ...WORKFLOW_COMMON_NODES,
    {
      ...dataSourceDefault,
      defaultValue: {
        ...dataSourceDefault.defaultValue,
        _dataSourceStartToAdd: true,
      },
    },
    knowledgeBaseDefault,
    dataSourceEmptyDefault,
  ], [])

  const helpLinkUri = useMemo(() => docLink(
    '/use-dify/knowledge/knowledge-pipeline/knowledge-pipeline-orchestration',
  ), [docLink])

  const availableNodesMetaData = useMemo(() => mergedNodesMetaData.map((node) => {
    const { metaData } = node
    const title = t(`blocks.${metaData.type}`, { ns: 'workflow' })
    const description = t(`blocksAbout.${metaData.type}`, { ns: 'workflow' })
    return {
      ...node,
      metaData: {
        ...metaData,
        title,
        description,
        helpLinkUri,
      },
      defaultValue: {
        ...node.defaultValue,
        type: metaData.type,
        title,
      },
    }
  }), [mergedNodesMetaData, t])

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
