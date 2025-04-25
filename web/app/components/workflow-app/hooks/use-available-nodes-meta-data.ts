import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
import StartDefault from '@/app/components/workflow/nodes/start/default'
import EndDefault from '@/app/components/workflow/nodes/end/default'
import AnswerDefault from '@/app/components/workflow/nodes/answer/default'
import { WORKFLOW_COMMON_NODES } from '@/app/components/workflow/constants/node'
import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store/store'
import { useIsChatMode } from './use-is-chat-mode'

export const useAvailableNodesMetaData = () => {
  const { t } = useTranslation()
  const isChatMode = useIsChatMode()
  const language = useGetLanguage()

  console.log('isChatMode', isChatMode)

  const mergedNodesMetaData = useMemo(() => [
    ...WORKFLOW_COMMON_NODES,
    StartDefault,
    ...(
      isChatMode
        ? [AnswerDefault]
        : [EndDefault]
    ),
  ], [isChatMode])

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
