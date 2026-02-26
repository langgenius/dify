import type { ChecklistItem } from '../hooks/use-checklist'
import type {
  BlockEnum,
  CommonEdgeType,
} from '../types'
import {
  RiCloseLine,
  RiListCheck3,
} from '@remixicon/react'
import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useEdges,
} from 'reactflow'
import { Warning } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { IconR } from '@/app/components/base/icons/src/vender/line/arrows'
import {
  ChecklistSquare,
} from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { cn } from '@/utils/classnames'
import BlockIcon from '../block-icon'
import {
  useChecklist,
  useNodesInteractions,
} from '../hooks'

type WorkflowChecklistProps = {
  disabled: boolean
  showGoTo?: boolean
  onItemClick?: (item: ChecklistItem) => void
}
const WorkflowChecklist = ({
  disabled,
  showGoTo = true,
  onItemClick,
}: WorkflowChecklistProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const edges = useEdges<CommonEdgeType>()
  const nodes = useNodes()
  const needWarningNodes = useChecklist(nodes, edges)
  const { handleNodeSelect } = useNodesInteractions()

  const handleChecklistItemClick = (item: ChecklistItem) => {
    const goToEnabled = showGoTo && item.canNavigate && !item.disableGoTo
    if (!goToEnabled)
      return
    if (onItemClick)
      onItemClick(item)
    else
      handleNodeSelect(item.id)
    setOpen(false)
  }

  return (
    <PortalToFollowElem
      placement="bottom-end"
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
            className={cn('group flex h-full w-full cursor-pointer items-center justify-center rounded-md hover:bg-state-accent-hover', open && 'bg-state-accent-hover')}
          >
            <RiListCheck3
              className={cn('h-4 w-4 group-hover:text-components-button-secondary-accent-text', open ? 'text-components-button-secondary-accent-text' : 'text-components-button-ghost-text')}
            />
          </div>
          {
            !!needWarningNodes.length && (
              <div className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-gray-100 bg-[#F79009] text-[11px] font-semibold text-white">
                {needWarningNodes.length}
              </div>
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[12]">
        <div
          className="w-[420px] overflow-y-auto rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg"
          style={{
            maxHeight: 'calc(2 / 3 * 100vh)',
          }}
        >
          <div className="text-md sticky top-0 z-[1] flex h-[44px] items-center bg-components-panel-bg pl-4 pr-3 pt-3 font-semibold text-text-primary">
            <div className="grow">
              {t('panel.checklist', { ns: 'workflow' })}
              {needWarningNodes.length ? `(${needWarningNodes.length})` : ''}
            </div>
            <div
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center"
              onClick={() => setOpen(false)}
            >
              <RiCloseLine className="h-4 w-4 text-text-tertiary" />
            </div>
          </div>
          <div className="pb-2">
            {
              !!needWarningNodes.length && (
                <>
                  <div className="px-4 pt-1 text-xs text-text-tertiary">{t('panel.checklistTip', { ns: 'workflow' })}</div>
                  <div className="px-4 py-2">
                    {
                      needWarningNodes.map(node => (
                        <div
                          key={node.id}
                          className={cn(
                            'group mb-2 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xs last-of-type:mb-0',
                            showGoTo && node.canNavigate && !node.disableGoTo ? 'cursor-pointer' : 'cursor-default opacity-80',
                          )}
                          onClick={() => handleChecklistItemClick(node)}
                        >
                          <div className="flex h-9 items-center p-2 text-xs font-medium text-text-secondary">
                            <BlockIcon
                              type={node.type as BlockEnum}
                              className="mr-1.5"
                              toolIcon={node.toolIcon}
                            />
                            <span className="grow truncate">
                              {node.title}
                            </span>
                            {
                              (showGoTo && node.canNavigate && !node.disableGoTo) && (
                                <div className="flex h-4 w-[60px] shrink-0 items-center justify-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                                  <span className="whitespace-nowrap text-xs font-medium leading-4 text-primary-600">
                                    {t('panel.goTo', { ns: 'workflow' })}
                                  </span>
                                  <IconR className="h-3.5 w-3.5 text-primary-600" />
                                </div>
                              )
                            }
                          </div>
                          <div
                            className={cn(
                              'rounded-b-lg border-t-[0.5px] border-divider-regular',
                              (node.unConnected || node.errorMessage) && 'bg-gradient-to-r from-components-badge-bg-orange-soft to-transparent',
                            )}
                          >
                            {
                              node.unConnected && (
                                <div className="px-3 py-1 first:pt-1.5 last:pb-1.5">
                                  <div className="flex text-xs leading-4 text-text-tertiary">
                                    <Warning className="mr-2 mt-[2px] h-3 w-3 text-[#F79009]" />
                                    {t('common.needConnectTip', { ns: 'workflow' })}
                                  </div>
                                </div>
                              )
                            }
                            {
                              node.errorMessage && (
                                <div className="px-3 py-1 first:pt-1.5 last:pb-1.5">
                                  <div className="flex text-xs leading-4 text-text-tertiary">
                                    <Warning className="mr-2 mt-[2px] h-3 w-3 text-[#F79009]" />
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
                <div className="mx-4 mb-3 rounded-lg bg-components-panel-bg py-4 text-center text-xs text-text-tertiary">
                  <ChecklistSquare className="mx-auto mb-[5px] h-8 w-8 text-text-quaternary" />
                  {t('panel.checklistResolved', { ns: 'workflow' })}
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
