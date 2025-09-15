import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
import knowledgeBaseDefault from '@/app/components/workflow/nodes/knowledge-base/default'
import dataSourceDefault from '@/app/components/workflow/nodes/data-source/default'
import dataSourceEmptyDefault from '@/app/components/workflow/nodes/data-source-empty/default'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import { BlockEnum } from '@/app/components/workflow/types'

export const useAvailableNodesMetaData = () => {
  const { t } = useTranslation()
  const language = useGetLanguage()

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

  const prefixLink = useMemo(() => {
    if (language === 'zh_Hans')
      return 'https://docs.dify.ai/zh-hans/guides/workflow/node/'

    return 'https://docs.dify.ai/guides/workflow/node/'
  }, [language])

  const availableNodesMetaData = useMemo(() => mergedNodesMetaData.map((node) => {
    const { metaData } = node
    const title = t(`workflow.blocks.${metaData.type}`)
    const description = t(`workflow.blocksAbout.${metaData.type}`)
    return {
      ...node,
      metaData: {
        ...metaData,
        title,
        description,
        helpLinkUri: `${prefixLink}${metaData.helpLinkUri}`,
      },
      defaultValue: {
        ...node.defaultValue,
        type: metaData.type,
        title,
      },
    }
  }), [mergedNodesMetaData, t, prefixLink])

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
