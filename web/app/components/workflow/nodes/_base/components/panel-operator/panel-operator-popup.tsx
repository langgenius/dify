import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges } from 'reactflow'
import { useNodeHelpLink } from '../../hooks/use-node-help-link'
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
import { CollectionType } from '@/app/components/tools/types'
import { canFindTool } from '@/utils'

type PanelOperatorPopupProps = {
  id: string
  data: Node['data']
  onClosePopup: () => void
  showHelpLink?: boolean
}
const PanelOperatorPopup = ({
  id,
  data,
  onClosePopup,
  showHelpLink,
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
  const workflowTools = useStore(s => s.workflowTools)
  const edge = edges.find(edge => edge.target === id)
  const author = useMemo(() => {
    if (data.type !== BlockEnum.Tool)
      return nodesExtraData[data.type].author

    if (data.provider_type === CollectionType.builtIn)
      return buildInTools.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.author

    if (data.provider_type === CollectionType.workflow)
      return workflowTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.author

    return customTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.author
  }, [data, nodesExtraData, buildInTools, customTools, workflowTools])

  const about = useMemo(() => {
    if (data.type !== BlockEnum.Tool)
      return nodesExtraData[data.type].about

    if (data.provider_type === CollectionType.builtIn)
      return buildInTools.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.description[language]

    if (data.provider_type === CollectionType.workflow)
      return workflowTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.description[language]

    return customTools.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.description[language]
  }, [data, nodesExtraData, language, buildInTools, customTools, workflowTools])

  const showChangeBlock = data.type !== BlockEnum.Start && !nodesReadOnly && data.type !== BlockEnum.Iteration && data.type !== BlockEnum.Loop

  const link = useNodeHelpLink(data.type)

  return (
    <div className='w-[240px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl'>
      {
        (showChangeBlock || canRunBySingle(data.type)) && (
          <>
            <div className='p-1'>
              {
                canRunBySingle(data.type) && (
                  <div
                    className={`
                      flex h-8 cursor-pointer items-center rounded-lg px-3 text-sm text-text-secondary
                      hover:bg-state-base-hover
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
                    nodeData={data}
                    sourceHandle={edge?.sourceHandle || 'source'}
                  />
                )
              }
            </div>
            <div className='h-[1px] bg-divider-regular'></div>
          </>
        )
      }
      {
        data.type !== BlockEnum.Start && !nodesReadOnly && (
          <>
            <div className='p-1'>
              <div
                className='flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
                onClick={() => {
                  onClosePopup()
                  handleNodesCopy(id)
                }}
              >
                {t('workflow.common.copy')}
                <ShortcutsName keys={['ctrl', 'c']} />
              </div>
              <div
                className='flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
                onClick={() => {
                  onClosePopup()
                  handleNodesDuplicate(id)
                }}
              >
                {t('workflow.common.duplicate')}
                <ShortcutsName keys={['ctrl', 'd']} />
              </div>
            </div>
            <div className='h-[1px] bg-divider-regular'></div>
            <div className='p-1'>
              <div
                className={`
                flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary
                hover:bg-state-destructive-hover hover:text-red-500
                `}
                onClick={() => handleNodeDelete(id)}
              >
                {t('common.operation.delete')}
                <ShortcutsName keys={['del']} />
              </div>
            </div>
            <div className='h-[1px] bg-divider-regular'></div>
          </>
        )
      }
      {
        showHelpLink && link && (
          <>
            <div className='p-1'>
              <a
                href={link}
                target='_blank'
                className='flex h-8 cursor-pointer items-center rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'
              >
                {t('workflow.panel.helpLink')}
              </a>
            </div>
            <div className='h-[1px] bg-divider-regular'></div>
          </>
        )
      }
      <div className='p-1'>
        <div className='px-3 py-2 text-xs text-text-tertiary'>
          <div className='mb-1 flex h-[22px] items-center font-medium'>
            {t('workflow.panel.about').toLocaleUpperCase()}
          </div>
          <div className='mb-1 leading-[18px] text-text-secondary'>{about}</div>
          <div className='leading-[18px]'>
            {t('workflow.panel.createdBy')} {author}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(PanelOperatorPopup)
