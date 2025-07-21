import cn from '@/utils/classnames'
import { RiAlertFill } from '@remixicon/react'
import Link from 'next/link'
import React from 'react'
import type { FC } from 'react'
import { Trans, useTranslation } from 'react-i18next'

type DeprecationNoticeProps = {
  status: 'deleted' | 'active'
  deprecatedReason: string
  alternativePluginId: string
  className?: string
}

const DeprecationNotice: FC<DeprecationNoticeProps> = ({
  status,
  deprecatedReason,
  alternativePluginId,
  className,
}) => {
  const { t } = useTranslation()

  if (status !== 'deleted' || !deprecatedReason)
    return null

  return (
    <div className={cn('w-full', className)}>
      <div className='relative flex items-center gap-x-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]'>
        <div className='absolute left-0 top-0 -z-10 h-full w-full bg-toast-warning-bg opacity-40' />
        <div className='p-1'>
          <RiAlertFill className='size-4 text-text-warning-secondary' />
        </div>
        <div className='system-md-medium py-1 text-text-primary'>
          {
            alternativePluginId ? (
              <Trans
                i18nKey={'plugin.detailPanel.deprecation.fullMessage'}
                components={{
                  CustomLink: (
                    <Link
                      href={`/plugins/${alternativePluginId}`}
                      target='_blank'
                      rel='noopener noreferrer'
                    />
                  ),
                }}
                values={{
                  deprecatedReason,
                  alternativePluginId,
                }}
              />
            ) : (
              <span>
                {t('plugin.detailPanel.deprecation.onlyReason', { deprecatedReason })}
              </span>
            )
          }
        </div>
      </div>
    </div>
  )
}

export default React.memo(DeprecationNotice)
