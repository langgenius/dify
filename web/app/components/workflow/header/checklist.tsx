import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useEdges,
  useNodes,
} from 'reactflow'
import {
  RiCloseLine,
  RiListCheck3,
} from '@remixicon/react'
import BlockIcon from '../block-icon'
import {
  useChecklist,
  useNodesInteractions,
} from '../hooks'
import type {
  CommonEdgeType,
  CommonNodeType,
} from '../types'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import {
  ChecklistSquare,
} from '@/app/components/base/icons/src/vender/line/general'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'

type WorkflowChecklistProps = {
  disabled: boolean
}
const WorkflowChecklist = ({
  disabled,
}: WorkflowChecklistProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const nodes = useNodes<CommonNodeType>()
  const edges = useEdges<CommonEdgeType>()
  const needWarningNodes = useChecklist(nodes, edges)
  const { handleNodeSelect } = useNodesInteractions()

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={{
        mainAxis: 12,
        crossAxis: 4,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => !disabled && setOpen(v => !v)}>
        <div
          className={cn(
            'relative ml-0.5 flex h-7 w-7 items-center justify-center rounded-md',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <div
            className={cn('hover:bg-state-accent-hover group flex h-full w-full cursor-pointer items-center justify-center rounded-md', open && 'bg-state-accent-hover')}
          >
            <RiListCheck3
              className={cn('group-hover:text-components-button-secondary-accent-text h-4 w-4', open ? 'text-components-button-secondary-accent-text' : 'text-components-button-ghost-text')}
            />
          </div>
          {
            !!needWarningNodes.length && (
              <div className='absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-gray-100 bg-[#F79009] text-[11px] font-semibold text-white'>
                {needWarningNodes.length}
              </div>
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[12]'>
        <div
          className='w-[420px] overflow-y-auto rounded-2xl border-[0.5px] border-black/5 bg-white shadow-lg'
          style={{
            maxHeight: 'calc(2 / 3 * 100vh)',
          }}
        >
          <div className='text-md sticky top-0 z-[1] flex h-[44px] items-center bg-white pl-4 pr-3 pt-3 font-semibold text-gray-900'>
            <div className='grow'>{t('workflow.panel.checklist')}{needWarningNodes.length ? `(${needWarningNodes.length})` : ''}</div>
            <div
              className='flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center'
              onClick={() => setOpen(false)}
            >
              <RiCloseLine className='h-4 w-4 text-gray-500' />
            </div>
          </div>
          <div className='py-2'>
            {
              !!needWarningNodes.length && (
                <>
                  <div className='px-4 text-xs text-gray-400'>{t('workflow.panel.checklistTip')}</div>
                  <div className='px-4 py-2'>
                    {
                      needWarningNodes.map(node => (
                        <div
                          key={node.id}
                          className='shadow-xs mb-2 cursor-pointer rounded-lg border-[0.5px] border-gray-200 bg-white last-of-type:mb-0'
                          onClick={() => {
                            handleNodeSelect(node.id)
                            setOpen(false)
                          }}
                        >
                          <div className='flex h-9 items-center p-2 text-xs font-medium text-gray-700'>
                            <BlockIcon
                              type={node.type}
                              className='mr-1.5'
                              toolIcon={node.toolIcon}
                            />
                            <span className='grow truncate'>
                              {node.title}
                            </span>
                          </div>
                          <div className='border-t-black/2 border-t-[0.5px]'>
                            {
                              node.unConnected && (
                                <div className='bg-gray-25 rounded-b-lg px-3 py-2'>
                                  <div className='flex text-xs leading-[18px] text-gray-500'>
                                    <AlertTriangle className='mr-2 mt-[3px] h-3 w-3 text-[#F79009]' />
                                    {t('workflow.common.needConnectTip')}
                                  </div>
                                </div>
                              )
                            }
                            {
                              node.errorMessage && (
                                <div className='bg-gray-25 rounded-b-lg px-3 py-2'>
                                  <div className='flex text-xs leading-[18px] text-gray-500'>
                                    <AlertTriangle className='mr-2 mt-[3px] h-3 w-3 text-[#F79009]' />
                                    {node.errorMessage}
                                  </div>
                                </div>
                              )
                            }
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </>
              )
            }
            {
              !needWarningNodes.length && (
                <div className='mx-4 mb-3 rounded-lg bg-gray-50 py-4 text-center text-xs text-gray-400'>
                  <ChecklistSquare className='mx-auto mb-[5px] h-8 w-8 text-gray-300' />
                  {t('workflow.panel.checklistResolved')}
                </div>
              )
            }
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(WorkflowChecklist)
