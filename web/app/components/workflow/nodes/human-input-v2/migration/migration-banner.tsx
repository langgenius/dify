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
  const { t } = useTranslation(['workflow', 'common'])

  return (
    <div
      role="note"
      aria-label={t(($) => $['nodes.humanInputMigration.banner.ariaLabel'], { ns: 'workflow' })}
      className="me-1 mt-1 flex min-h-10 shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-lg bg-state-warning-hover p-2 system-xs-medium text-text-secondary shadow-md inset-ring-[0.5px] inset-ring-state-warning-active backdrop-blur-[5px]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <BlockIcon size="sm" className="shrink-0" type={BlockEnum.HumanInputV2} />
        <span>
          {t(($) => $['nodes.humanInputMigration.banner.description'], { ns: 'workflow' })}
        </span>
        {helpLink && (
          <a
            href={helpLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-xs underline decoration-text-quaternary decoration-dotted underline-offset-2 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            {t(($) => $['nodes.humanInputMigration.banner.learnMore'], { ns: 'workflow' })}
            <span className="sr-only">
              {' '}
              ({t(($) => $['operation.openInNewTab'], { ns: 'common' })})
            </span>
            <span aria-hidden className="i-ri-external-link-line size-3" />
          </a>
        )}
      </div>
      {canEdit && (
        <Button
          size="small"
          variant="secondary-accent"
          className="shrink-0 gap-0.5"
          onClick={onMigrate}
        >
          {t(($) => $['nodes.humanInputMigration.action.migrateNow'], { ns: 'workflow' })}
          <span aria-hidden className="i-ri-arrow-right-line size-3.5" />
        </Button>
      )}
    </div>
  )
}

export default memo(HumanInputMigrationBanner)
