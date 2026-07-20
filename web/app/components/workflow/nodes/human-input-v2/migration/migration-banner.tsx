import { Button } from '@langgenius/dify-ui/button'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

type HumanInputMigrationBannerProps = {
  canEdit: boolean
  helpLink?: string
  onMigrate: () => void
}

const HumanInputMigrationBanner = ({
  canEdit,
  helpLink,
  onMigrate,
}: HumanInputMigrationBannerProps) => {
  const { t } = useTranslation()

  return (
    <aside
      aria-label={t(($) => $['nodes.humanInputMigration.banner.ariaLabel'], { ns: 'workflow' })}
      className="pointer-events-auto flex max-w-[720px] items-center gap-3 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg px-4 py-3 shadow-lg"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-section-burn">
        <span aria-hidden className="i-ri-information-2-line size-4 text-text-accent" />
      </div>
      <div className="min-w-0 grow">
        <div className="system-sm-semibold text-text-primary">
          {t(($) => $['nodes.humanInputMigration.banner.title'], { ns: 'workflow' })}
        </div>
        <div className="system-xs-regular text-text-tertiary">
          {t(($) => $['nodes.humanInputMigration.banner.description'], { ns: 'workflow' })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {helpLink && (
          <a
            href={helpLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-6 items-center justify-center rounded-md px-2 text-xs font-medium text-components-button-ghost-text hover:bg-components-button-ghost-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            {t(($) => $['nodes.humanInputMigration.banner.learnMore'], { ns: 'workflow' })}
          </a>
        )}
        {canEdit && (
          <Button size="small" variant="primary" onClick={onMigrate}>
            {t(($) => $['nodes.humanInputMigration.action.migrate'], { ns: 'workflow' })}
          </Button>
        )}
      </div>
    </aside>
  )
}

export default memo(HumanInputMigrationBanner)
