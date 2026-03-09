import type { ChecklistItem } from '../../hooks/use-checklist'
import type { BlockEnum } from '../../types'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import BlockIcon from '../../block-icon'
import { ItemIndicator } from './item-indicator'

type ChecklistSubItem = {
  key: string
  message: string
}

export const ChecklistNodeGroup = memo(({
  item,
  showGoTo,
  onItemClick,
}: {
  item: ChecklistItem
  showGoTo: boolean
  onItemClick: (item: ChecklistItem) => void
}) => {
  const { t } = useTranslation()
  const goToEnabled = showGoTo && item.canNavigate && !item.disableGoTo

  const subItems = useMemo(() => {
    const items: ChecklistSubItem[] = []
    for (let i = 0; i < item.errorMessages.length; i++)
      items.push({ key: `error-${i}`, message: item.errorMessages[i] })
    if (item.unConnected)
      items.push({ key: 'unconnected', message: t('common.needConnectTip', { ns: 'workflow' }) })
    return items
  }, [item.errorMessages, item.unConnected, t])

  return (
    <div className="overflow-clip rounded-[10px] bg-components-panel-on-panel-item-bg">
      <div className="flex items-center gap-2 px-2 pt-2">
        <BlockIcon
          type={item.type as BlockEnum}
          size="sm"
          toolIcon={item.toolIcon}
        />
        <span className="min-w-0 grow truncate text-sm font-medium leading-5 text-text-primary">
          {item.title}
        </span>
      </div>
      <div className="p-1">
        {subItems.map(sub => (
          <div
            key={sub.key}
            className={cn(
              'group/item flex items-center gap-2 rounded-lg px-1',
              goToEnabled && 'cursor-pointer hover:bg-state-base-hover',
            )}
            onClick={() => goToEnabled && onItemClick(item)}
          >
            <ItemIndicator />
            <span className="min-w-0 grow truncate text-xs leading-4 text-text-warning">
              {sub.message}
            </span>
            {goToEnabled && (
              <div className="flex shrink-0 items-center gap-0.5 pr-0.5 opacity-0 transition-opacity duration-150 group-hover/item:opacity-100">
                <span className="whitespace-nowrap text-xs font-medium leading-4 text-text-accent">
                  {t('panel.goToFix', { ns: 'workflow' })}
                </span>
                <span className="i-ri-arrow-right-line size-3.5 text-text-accent" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})
ChecklistNodeGroup.displayName = 'ChecklistNodeGroup'
