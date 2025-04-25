import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
import knowledgeBaseDefault from '@/app/components/workflow/nodes/knowledge-base/default'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'

export const useAvailableNodesMetaData = () => {
  const { t } = useTranslation()
  const language = useGetLanguage()

  const mergedNodesMetaData = useMemo(() => [
    ...WORKFLOW_COMMON_NODES,
    knowledgeBaseDefault,
  ], [])

  const prefixLink = useMemo(() => {
    if (language === 'zh_Hans')
      return 'https://docs.dify.ai/zh-hans/guides/workflow/node/'

    return 'https://docs.dify.ai/guides/workflow/node/'
  }, [language])

  const availableNodesMetaData = useMemo(() => mergedNodesMetaData.map((node) => {
    return {
      ...node,
      defaultValue: {
        ...node.defaultValue,
        type: node.type,
      },
      title: t(`workflow.blocks.${node.type}`),
      description: t(`workflow.blocksAbout.${node.type}`),
      helpLinkUri: `${prefixLink}${node.helpLinkUri}`,

    }
  }), [mergedNodesMetaData, t, prefixLink])

  const availableNodesMetaDataMap = useMemo(() => availableNodesMetaData.reduce((acc, node) => {
    acc![node.type] = node
    return acc
  }, {} as AvailableNodesMetaData['nodesMap']), [availableNodesMetaData])

  return useMemo(() => {
    return {
      nodes: availableNodesMetaData,
      nodesMap: availableNodesMetaDataMap,
    }
  }, [availableNodesMetaData, availableNodesMetaDataMap])
}
