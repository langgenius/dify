import type { RelatedAppResponse } from '@/models/datasets'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiInformation2Line } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from '#i18n'
import LinkedAppsPanel from '@/app/components/base/linked-apps-panel'
import NoLinkedAppsPanel from '../no-linked-apps-panel'

type StatisticsProps = {
  expand: boolean
  documentCount?: number
  relatedApps?: RelatedAppResponse
}

const Statistics = ({
  expand,
  documentCount,
  relatedApps,
}: StatisticsProps) => {
  const { t } = useTranslation()

  const relatedAppsTotal = relatedApps?.total
  const hasRelatedApps = relatedApps?.data && relatedApps.data.length > 0

  return (
    <div className="flex items-start gap-x-0.5 px-1 pt-2">
      <div className="flex min-w-0 flex-col rounded-lg px-2 pt-1 pb-1.5">
        <div className="system-md-semibold-uppercase text-text-secondary">
          {documentCount ?? '--'}
        </div>
        <div className="truncate system-2xs-medium-uppercase text-text-tertiary">
          {t('datasetMenus.documents', { ns: 'common' })}
        </div>
      </div>
      <div className="flex h-[42px] w-[15px] shrink-0 items-center justify-center">
        <div className="h-7 w-px rotate-[15deg] bg-divider-subtle" />
      </div>
      <div className="flex min-w-0 flex-col rounded-lg px-2 pt-1 pb-1.5">
        <div className="system-md-semibold-uppercase text-text-secondary">
          {relatedAppsTotal ?? '--'}
        </div>
        <Popover>
          <PopoverTrigger
            openOnHover
            aria-label={t('datasetMenus.relatedApp', { ns: 'common' })}
            render={(
              <button
                type="button"
                className="flex max-w-full cursor-pointer items-center gap-x-0.5 rounded-sm system-2xs-medium-uppercase text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
              >
                <span className="truncate">{t('datasetMenus.relatedApp', { ns: 'common' })}</span>
                <RiInformation2Line className="size-3 shrink-0" />
              </button>
            )}
          />
          <PopoverContent
            placement="top-start"
            popupClassName="border-0 bg-transparent p-0 shadow-none"
          >
            {hasRelatedApps
              ? (
                  <LinkedAppsPanel
                    relatedApps={relatedApps.data}
                    isMobile={!expand}
                  />
                )
              : <NoLinkedAppsPanel />}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

export default React.memo(Statistics)
