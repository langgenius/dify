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

  const helpLinkUri = useMemo(() => {
    if (language === 'zh_Hans')
      return 'https://docs.dify.ai/zh-hans/guides/knowledge-base/knowledge-pipeline/knowledge-pipeline-orchestration#%E6%AD%A5%E9%AA%A4%E4%B8%80%EF%BC%9A%E6%95%B0%E6%8D%AE%E6%BA%90%E9%85%8D%E7%BD%AE'
    if (language === 'ja_JP')
      return 'https://docs.dify.ai/ja-jp/guides/knowledge-base/knowledge-pipeline/knowledge-pipeline-orchestration#%E3%82%B9%E3%83%86%E3%83%83%E3%83%971%EF%BC%9A%E3%83%87%E3%83%BC%E3%82%BF%E3%82%BD%E3%83%BC%E3%82%B9%E3%81%AE%E8%A8%AD%E5%AE%9A'

    return 'https://docs.dify.ai/en/guides/knowledge-base/knowledge-pipeline/knowledge-pipeline-orchestration#step-1%3A-data-source'
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
