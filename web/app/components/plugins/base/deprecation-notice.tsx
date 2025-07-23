import React, { useMemo } from 'react'
import type { FC } from 'react'
import Link from 'next/link'
import cn from '@/utils/classnames'
import { RiAlertFill } from '@remixicon/react'
import { Trans } from 'react-i18next'
import { useMixedTranslation } from '../marketplace/hooks'
import { camelCase } from 'lodash-es'

type DeprecationNoticeProps = {
  status: 'deleted' | 'active'
  deprecatedReason: string
  alternativePluginId: string
  alternativePluginURL: string
  locale?: string
  className?: string
  innerWrapperClassName?: string
  iconWrapperClassName?: string
  textClassName?: string
}

const i18nPrefix = 'plugin.detailPanel.deprecation'

const DeprecationNotice: FC<DeprecationNoticeProps> = ({
  status,
  deprecatedReason,
  alternativePluginId,
  alternativePluginURL,
  locale,
  className,
  innerWrapperClassName,
  iconWrapperClassName,
  textClassName,
}) => {
  const { t } = useMixedTranslation(locale)

  const deprecatedReasonKey = useMemo(() => {
    if (!deprecatedReason) return ''
    return camelCase(deprecatedReason)
  }, [deprecatedReason])

  // Check if the deprecatedReasonKey exists in i18n
  const hasValidDeprecatedReason = useMemo(() => {
    if (!deprecatedReason || !deprecatedReasonKey) return false

    // Define valid reason keys that exist in i18n
    const validReasonKeys = ['businessAdjustments', 'ownershipTransferred', 'noMaintainer']
    return validReasonKeys.includes(deprecatedReasonKey)
  }, [deprecatedReason, deprecatedReasonKey])

  if (status !== 'deleted')
    return null

  return (
    <div className={cn('w-full', className)}>
      <div className={cn(
        'relative flex items-start gap-x-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]',
        innerWrapperClassName,
      )}>
        <div className='absolute left-0 top-0 -z-10 h-full w-full bg-toast-warning-bg opacity-40' />
        <div className={cn('flex size-6 shrink-0 items-center justify-center', iconWrapperClassName)}>
          <RiAlertFill className='size-4 text-text-warning-secondary' />
        </div>
        <div className={cn('system-xs-regular grow py-1 text-text-primary', textClassName)}>
          {
            hasValidDeprecatedReason && alternativePluginId && (
              <Trans
                t={t}
                i18nKey={`${i18nPrefix}.fullMessage`}
                components={{
                  CustomLink: (
                    <Link
                      href={alternativePluginURL}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='underline'
                    />
                  ),
                }}
                values={{
                  deprecatedReason: t(`${i18nPrefix}.reason.${deprecatedReasonKey}`),
                  alternativePluginId,
                }}
              />
            )
          }
          {
            hasValidDeprecatedReason && !alternativePluginId && (
              <span>
                {t(`${i18nPrefix}.onlyReason`, { deprecatedReason: t(`${i18nPrefix}.reason.${deprecatedReasonKey}`) })}
              </span>
            )
          }
          {
            !hasValidDeprecatedReason && (
              <span>{t(`${i18nPrefix}.noReason`)}</span>
            )
          }
        </div>
      </div>
    </div>
  )
}

export default React.memo(DeprecationNotice)
