import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges } from 'reactflow'
import ChangeBlock from './change-block'
import {
  canRunBySingle,
} from '@/app/components/workflow/utils'
import { useStore } from '@/app/components/workflow/store'
import {
  useNodeDataUpdate,
  useNodesExtraData,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
} from '@/app/components/workflow/hooks'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { useGetLanguage } from '@/context/i18n'

type PanelOperatorPopupProps = {
  id: string
  data: Node['data']
  onClosePopup: () => void
}
const PanelOperatorPopup = ({
  id,
  data,
  onClosePopup,
}: PanelOperatorPopupProps) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const edges = useEdges()
  const {
    handleNodeDelete,
    handleNodesDuplicate,
    handleNodeSelect,
    handleNodesCopy,
  } = useNodesInteractions()
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { nodesReadOnly } = useNodesReadOnly()
  const nodesExtraData = useNodesExtraData()
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const edge = edges.find(edge => edge.target === id)
  const author = useMemo(() => {
    if (data.type !== BlockEnum.Tool)
      return nodesExtraData[data.type].author

    if (data.provider_type === 'builtin')
      return buildInTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.author

    return customTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.author
  }, [data, nodesExtraData, buildInTools, customTools])

  const about = useMemo(() => {
    if (data.type !== BlockEnum.Tool)
      return nodesExtraData[data.type].about

    if (data.provider_type === 'builtin')
      return buildInTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.description[language]

    return customTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.description[language]
  }, [data, nodesExtraData, language, buildInTools, customTools])

  const showChangeBlock = data.type !== BlockEnum.Start && !nodesReadOnly

  return (
    <div className='w-[240px] border-[0.5px] border-gray-200 rounded-lg shadow-xl bg-white'>
      {
        (showChangeBlock || canRunBySingle(data.type)) && (
          <>
            <div className='p-1'>
              {
                canRunBySingle(data.type) && (
                  <div
                    className={`
                      flex items-center px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer
                      hover:bg-gray-50
                    `}
                    onClick={() => {
                      handleNodeSelect(id)
                      handleNodeDataUpdate({ id, data: { _isSingleRun: true } })
                      handleSyncWorkflowDraft(true)
                      onClosePopup()
                    }}
                  >
                    {t('workflow.panel.runThisStep')}
                  </div>
                )
              }
              {
                showChangeBlock && (
                  <ChangeBlock
                    nodeId={id}
                    nodeType={data.type}
                    sourceHandle={edge?.sourceHandle || 'source'}
                  />
                )
              }
            </div>
            <div className='h-[1px] bg-gray-100'></div>
          </>
        )
      }
      {
        data.type !== BlockEnum.Start && data.type !== BlockEnum.End && !nodesReadOnly && (
          <>
            <div className='p-1'>
              <div
                className='flex items-center justify-between px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
                onClick={() => {
                  onClosePopup()
                  handleNodesCopy()
                }}
              >
                {t('workflow.common.copy')}
                <ShortcutsName keys={['ctrl', 'c']} />
              </div>
              <div
                className='flex items-center justify-between px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
                onClick={() => {
                  onClosePopup()
                  handleNodesDuplicate()
                }}
              >
                {t('workflow.common.duplicate')}
                <ShortcutsName keys={['ctrl', 'd']} />
              </div>
            </div>
            <div className='h-[1px] bg-gray-100'></div>
            <div className='p-1'>
              <div
                className={`
                flex items-center justify-between px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer
                hover:bg-rose-50 hover:text-red-500
                `}
                onClick={() => handleNodeDelete(id)}
              >
                {t('common.operation.delete')}
                <ShortcutsName keys={['del']} />
              </div>
            </div>
            <div className='h-[1px] bg-gray-100'></div>
          </>
        )
      }
      <div className='p-1'>
        <a
          href={
            language === 'zh_Hans'
              ? 'https://docs.dify.ai/v/zh-hans/guides/workflow'
              : 'https://docs.dify.ai/features/workflow'
          }
          target='_blank'
          className='flex items-center px-3 h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
        >
          {t('workflow.panel.helpLink')}
        </a>
      </div>
      <div className='h-[1px] bg-gray-100'></div>
      <div className='p-1'>
        <div className='px-3 py-2 text-xs text-gray-500'>
          <div className='flex items-center mb-1 h-[22px] font-medium'>
            {t('workflow.panel.about').toLocaleUpperCase()}
          </div>
          <div className='mb-1 text-gray-700 leading-[18px]'>{about}</div>
          <div className='leading-[18px]'>
            {t('workflow.panel.createdBy')} {author}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(PanelOperatorPopup)
