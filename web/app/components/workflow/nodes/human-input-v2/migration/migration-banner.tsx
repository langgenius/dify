import { Button } from '@langgenius/dify-ui/button'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'

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
      className="pointer-events-auto flex w-full min-w-0 items-center justify-center gap-2 rounded-lg border-[0.5px] border-components-badge-status-light-warning-halo bg-state-warning-hover px-3 py-2 shadow-xs"
    >
      <BlockIcon size="sm" className="shrink-0" type={BlockEnum.HumanInputV2} />
      <div className="min-w-0 truncate system-xs-regular text-text-secondary">
        {t(($) => $['nodes.humanInputMigration.banner.description'], { ns: 'workflow' })}
      </div>
      {helpLink && (
        <a
          href={helpLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 system-xs-medium text-text-secondary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          {t(($) => $['nodes.humanInputMigration.banner.learnMore'], { ns: 'workflow' })}
          <span aria-hidden className="i-ri-external-link-line size-3.5" />
        </a>
      )}
      {canEdit && (
        <Button size="small" variant="secondary" className="shrink-0 gap-0.5" onClick={onMigrate}>
          {t(($) => $['nodes.humanInputMigration.action.migrateNow'], { ns: 'workflow' })}
          <span aria-hidden className="i-ri-arrow-right-line size-3.5" />
        </Button>
      )}
    </aside>
  )
}

export default memo(HumanInputMigrationBanner)
