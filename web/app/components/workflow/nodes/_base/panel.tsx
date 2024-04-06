import type {
  FC,
  ReactElement,
} from 'react'
import {
  cloneElement,
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import NextStep from './components/next-step'
import PanelOperator from './components/panel-operator'
import {
  DescriptionInput,
  TitleInput,
} from './components/title-description-input'
import { useResizePanel } from './hooks/use-resize-panel'
import {
  XClose,
} from '@/app/components/base/icons/src/vender/line/general'
import BlockIcon from '@/app/components/workflow/block-icon'
import {
  useNodeDataUpdate,
  useNodesExtraData,
  useNodesInteractions,
  useNodesReadOnly,
  useNodesSyncDraft,
  useToolIcon,
} from '@/app/components/workflow/hooks'
import { canRunBySingle } from '@/app/components/workflow/utils'
import { Play } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import type { Node } from '@/app/components/workflow/types'

type BasePanelProps = {
  children: ReactElement
} & Node

const BasePanel: FC<BasePanelProps> = ({
  id,
  data,
  children,
}) => {
  const { t } = useTranslation()
  const initPanelWidth = localStorage.getItem('workflow-node-panel-width') || 420
  const { handleNodeSelect } = useNodesInteractions()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { nodesReadOnly } = useNodesReadOnly()
  const nodesExtraData = useNodesExtraData()
  const availableNextNodes = nodesExtraData[data.type].availableNextNodes
  const toolIcon = useToolIcon(data)

  const handleResized = useCallback((width: number) => {
    localStorage.setItem('workflow-node-panel-width', `${width}`)
  }, [])

  const {
    triggerRef,
    containerRef,
  } = useResizePanel({
    direction: 'horizontal',
    triggerDirection: 'left',
    minWidth: 420,
    maxWidth: 720,
    onResized: handleResized,
  })

  const {
    handleNodeDataUpdate,
    handleNodeDataUpdateWithSyncDraft,
  } = useNodeDataUpdate()

  const handleTitleBlur = useCallback((title: string) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { title } })
  }, [handleNodeDataUpdateWithSyncDraft, id])
  const handleDescriptionChange = useCallback((desc: string) => {
    handleNodeDataUpdateWithSyncDraft({ id, data: { desc } })
  }, [handleNodeDataUpdateWithSyncDraft, id])

  return (
    <div className='relative mr-2 h-full'>
      <div
        ref={triggerRef}
        className='absolute top-1/2 -translate-y-1/2 -left-2 w-3 h-6 cursor-col-resize resize-x'>
        <div className='w-1 h-6 bg-gray-300 rounded-sm'></div>
      </div>
      <div
        ref={containerRef}
        className='relative h-full bg-white shadow-lg border-[0.5px] border-gray-200 rounded-2xl overflow-y-auto'
        style={{
          width: `${initPanelWidth}px`,
        }}
      >
        <div className='sticky top-0 bg-white border-b-[0.5px] border-black/5 z-10'>
          <div className='flex items-center px-4 pt-4 pb-1'>
            <BlockIcon
              className='shrink-0 mr-1'
              type={data.type}
              toolIcon={toolIcon}
              size='md'
            />
            <TitleInput
              value={data.title || ''}
              onBlur={handleTitleBlur}
            />
            <div className='shrink-0 flex items-center text-gray-500'>
              {
                canRunBySingle(data.type) && !nodesReadOnly && (
                  <TooltipPlus
                    popupContent={t('workflow.panel.runThisStep')}
                  >
                    <div
                      className='flex items-center justify-center mr-1 w-6 h-6 rounded-md hover:bg-black/5 cursor-pointer'
                      onClick={() => {
                        handleNodeDataUpdate({ id, data: { _isSingleRun: true } })
                        handleSyncWorkflowDraft(true)
                      }}
                    >
                      <Play className='w-4 h-4 text-gray-500' />
                    </div>
                  </TooltipPlus>
                )
              }
              <PanelOperator id={id} data={data} />
              <div className='mx-3 w-[1px] h-3.5 bg-gray-200' />
              <div
                className='flex items-center justify-center w-6 h-6 cursor-pointer'
                onClick={() => handleNodeSelect(id, true)}
              >
                <XClose className='w-4 h-4' />
              </div>
            </div>
          </div>
          <div className='p-2'>
            <DescriptionInput
              value={data.desc || ''}
              onChange={handleDescriptionChange}
            />
          </div>
        </div>
        <div className='py-2'>
          {cloneElement(children, { id, data })}
        </div>
        {
          !!availableNextNodes.length && (
            <div className='p-4 border-t-[0.5px] border-t-black/5'>
              <div className='flex items-center mb-1 text-gray-700 text-[13px] font-semibold'>
                {t('workflow.panel.nextStep').toLocaleUpperCase()}
              </div>
              <div className='mb-2 text-xs text-gray-400'>
                {t('workflow.panel.addNextStep')}
              </div>
              <NextStep selectedNode={{ id, data } as Node} />
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(BasePanel)
