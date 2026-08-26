import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { VersionTimelineDot } from './version-timeline-dot'

export function CurrentDraftItem({
  isActive,
  isLast,
  onSelect,
}: {
  isActive: boolean
  isLast: boolean
  onSelect: () => void
}) {
  const { t: tWorkflow } = useTranslation('workflow')

  return (
    <button
      type="button"
      aria-current={isActive ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-1 rounded-lg py-1 pr-1.5 pl-2 text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        isActive ? 'bg-state-accent-active' : 'hover:bg-state-base-hover',
      )}
    >
      <VersionTimelineDot isActive={isActive} isFirst isLast={isLast} />
      <div className="min-w-0 flex-1 py-1">
        <p
          className={cn(
            'truncate system-sm-semibold',
            isActive ? 'text-text-accent' : 'text-text-secondary',
          )}
        >
          {tWorkflow(($) => $['versionHistory.currentDraft'])}
        </p>
      </div>
    </button>
  )
}
