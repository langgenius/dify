import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '@/app/components/main-nav/app-card-grid'

const placeholderCardIds = Array.from({ length: 16 }, (_, index) => `empty-card-${index}`)

export function ExternalAgentEmptySearch({ onClearFilters }: { onClearFilters: () => void }) {
  const { t } = useTranslation(['agentRoster'])

  return (
    <div className="relative flex h-full min-h-80 items-center justify-center overflow-hidden px-2 pt-2 pb-39 text-center system-sm-regular text-text-tertiary">
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-2 inset-y-2 grid-rows-4 gap-3 sm:inset-x-8',
          MAIN_NAV_APP_CARD_GRID_CLASS_NAME,
        )}
      >
        {placeholderCardIds.map((id) => (
          <div key={id} className="rounded-xl bg-background-default-lighter opacity-75" />
        ))}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-background-body-transparent to-background-body"
      />
      <div className="relative flex max-w-full flex-col items-center gap-3">
        <div role="status" className="flex max-w-full flex-col items-center gap-3">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-md"
          >
            <span className="i-ri-robot-line size-6" />
          </span>
          <p>{t(($) => $['external.emptySearch'])}</p>
          <p>{t(($) => $['external.emptySearchDescription'])}</p>
        </div>
        <Button size="small" variant="secondary" onClick={onClearFilters}>
          {t(($) => $['external.clearFilters'])}
        </Button>
      </div>
    </div>
  )
}
