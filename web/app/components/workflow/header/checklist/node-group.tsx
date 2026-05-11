import type { ChecklistItem } from '../../hooks/use-checklist'
import type { BlockEnum } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
      items.push({ key: `error-${i}`, message: item.errorMessages[i]! })
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
        <span className="min-w-0 grow truncate text-sm leading-5 font-medium text-text-primary">
          {item.title}
        </span>
      </div>
      <div className="p-1">
        {subItems.map((sub) => {
          const content = (
            <>
              <ItemIndicator />
              <span className="min-w-0 grow truncate text-xs leading-4 text-text-warning">
                {sub.message}
              </span>
              {goToEnabled && (
                <div className="flex shrink-0 items-center gap-0.5 pr-0.5 opacity-0 transition-opacity duration-150 group-hover/item:opacity-100">
                  <span className="text-xs leading-4 font-medium whitespace-nowrap text-text-accent">
                    {t('panel.goToFix', { ns: 'workflow' })}
                  </span>
                  <span className="i-ri-arrow-right-line size-3.5 text-text-accent" aria-hidden="true" />
                </div>
              )}
            </>
          )
          const className = cn(
            'group/item flex w-full items-center gap-2 rounded-lg px-1 text-left',
            goToEnabled && 'cursor-pointer hover:bg-state-base-hover',
          )

          if (goToEnabled) {
            return (
              <button
                key={sub.key}
                type="button"
                className={cn(className, 'border-none bg-transparent')}
                title={sub.message}
                onClick={() => onItemClick(item)}
              >
                {content}
              </button>
            )
          }

          return (
            <div key={sub.key} className={className} title={sub.message}>
              {content}
            </div>
          )
        })}
      </div>
    </div>
  )
})
ChecklistNodeGroup.displayName = 'ChecklistNodeGroup'
