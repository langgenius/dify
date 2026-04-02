import type { ChecklistItem } from '../../hooks/use-checklist'
import type {
  CommonEdgeType,
} from '../../types'
import {
  memo,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useEdges,
} from 'reactflow'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { cn } from '@/utils/classnames'
import {
  useChecklist,
  useNodesInteractions,
} from '../../hooks'
import { ChecklistNodeGroup } from './node-group'
import { ChecklistPluginGroup } from './plugin-group'

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

  const { pluginItems, nodeItems } = useMemo(() => {
    const plugins: ChecklistItem[] = []
    const regular: ChecklistItem[] = []
    for (const item of needWarningNodes) {
      if (item.isPluginMissing)
        plugins.push(item)
      else
        regular.push(item)
    }
    return { pluginItems: plugins, nodeItems: regular }
  }, [needWarningNodes])

  const handleItemClick = (item: ChecklistItem) => {
    if (onItemClick)
      onItemClick(item)
    else
      handleNodeSelect(item.id)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={newOpen => !disabled && setOpen(newOpen)}>
      <PopoverTrigger
        render={(
          <button
            type="button"
            className={cn(
              'relative ml-0.5 flex h-7 w-7 items-center justify-center rounded-md border-none bg-transparent p-0',
              disabled && 'cursor-not-allowed opacity-50',
            )}
            disabled={disabled || undefined}
          >
            <span
              className={cn('group flex h-full w-full items-center justify-center rounded-md hover:bg-state-accent-hover', open && 'bg-state-accent-hover')}
            >
              <span
                className={cn('i-ri-list-check-3 h-4 w-4 group-hover:text-components-button-secondary-accent-text', open ? 'text-components-button-secondary-accent-text' : 'text-components-button-ghost-text')}
              />
            </span>
            {!!needWarningNodes.length && (
              <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-gray-100 bg-text-warning-secondary text-[11px] font-semibold text-white">
                {needWarningNodes.length}
              </span>
            )}
          </button>
        )}
      />
      <PopoverContent
        placement="bottom-start"
        sideOffset={12}
        alignOffset={-30}
        popupClassName="w-[420px] rounded-2xl bg-background-default-subtle"
      >
        <div
          className="overflow-y-auto"
          style={{ maxHeight: 'calc(2 / 3 * 100vh)' }}
        >
          <div className="flex flex-col gap-0.5 px-3 pb-1 pt-3.5">
            <div className="flex items-start px-1">
              <div className="min-w-0 grow pr-8">
                <h2 className="text-base font-semibold leading-6 text-text-primary">
                  {t('panel.checklist', { ns: 'workflow' })}
                  {needWarningNodes.length > 0 && `(${needWarningNodes.length})`}
                </h2>
              </div>
              <PopoverClose className="-mr-0.5 -mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg">
                <span className="i-ri-close-line size-4 text-text-tertiary" />
              </PopoverClose>
            </div>
            {needWarningNodes.length > 0 && (
              <p className="px-1 text-xs leading-4 text-text-tertiary">
                {t('panel.checklistDescription', { ns: 'workflow' })}
              </p>
            )}
          </div>

          {needWarningNodes.length > 0
            ? (
                <div className="flex flex-col gap-1 px-4 pb-4 pt-1">
                  {pluginItems.length > 0 && (
                    <ChecklistPluginGroup items={pluginItems} />
                  )}
                  {nodeItems.map(item => (
                    <ChecklistNodeGroup
                      key={item.id}
                      item={item}
                      showGoTo={showGoTo}
                      onItemClick={handleItemClick}
                    />
                  ))}
                </div>
              )
            : (
                <div className="mx-4 mb-3 rounded-lg py-4 text-center text-xs text-text-tertiary">
                  <span className="i-custom-vender-line-general-checklist-square mx-auto mb-[5px] block h-8 w-8 text-text-quaternary" />
                  {t('panel.checklistResolved', { ns: 'workflow' })}
                </div>
              )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default memo(WorkflowChecklist)
