import React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Tooltip from '@/app/components/base/tooltip'
import LinkedAppsPanel from '@/app/components/base/linked-apps-panel'
import NoLinkedAppsPanel from '../no-linked-apps-panel'
import { RiInformation2Line } from '@remixicon/react'
import type { RelatedAppResponse } from '@/models/datasets'

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
    <div className='flex items-center gap-x-0.5 p-2 pb-0'>
      <div className='flex grow flex-col px-2 pb-1.5 pt-1'>
        <div className='system-md-semibold-uppercase text-text-secondary'>
          {documentCount ?? '--'}
        </div>
        <div className='system-2xs-medium-uppercase text-text-tertiary'>
          {t('common.datasetMenus.documents')}
        </div>
      </div>
      <div className='py-2 pl-0.5 pr-1.5'>
        <Divider className='text-test-divider-regular h-full w-fit' />
      </div>
      <div className='flex grow flex-col px-2 pb-1.5 pt-1'>
        <div className='system-md-semibold-uppercase text-text-secondary'>
          {relatedAppsTotal ?? '--'}
        </div>
        <Tooltip
          position='top-start'
          noDecoration
          needsDelay
          popupContent={
            hasRelatedApps ? (
              <LinkedAppsPanel
                relatedApps={relatedApps.data}
                isMobile={!expand}
              />
            ) : <NoLinkedAppsPanel />
          }
        >
          <div className='system-2xs-medium-uppercase flex cursor-pointer items-center gap-x-0.5 text-text-tertiary'>
            <span>{t('common.datasetMenus.relatedApp')}</span>
            <RiInformation2Line className='size-3' />
          </div>
        </Tooltip>
      </div>
    </div>
  )
}

export default React.memo(Statistics)
