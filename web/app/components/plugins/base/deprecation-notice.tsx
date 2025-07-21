import React, { useMemo } from 'react'
import type { FC } from 'react'
import Link from 'next/link'
import cn from '@/utils/classnames'
import { RiAlertFill } from '@remixicon/react'
import { Trans, useTranslation } from 'react-i18next'
import { snakeCase2CamelCase } from '@/utils/format'

type DeprecationNoticeProps = {
  status: 'deleted' | 'active'
  deprecatedReason: string
  alternativePluginId: string
  urlPrefix: string
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
  urlPrefix,
  className,
  innerWrapperClassName,
  iconWrapperClassName,
  textClassName,
}) => {
  const { t } = useTranslation()

  const deprecatedReasonKey = useMemo(() => {
    if (!deprecatedReason) return ''
    return snakeCase2CamelCase(deprecatedReason)
  }, [deprecatedReason])

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
            deprecatedReason && alternativePluginId && (
              <Trans
                i18nKey={`${i18nPrefix}.fullMessage`}
                components={{
                  CustomLink: (
                    <Link
                      href={`${urlPrefix}/plugins/${alternativePluginId}`}
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
            deprecatedReason && !alternativePluginId && (
              <span>
                {t(`${i18nPrefix}.onlyReason`, { deprecatedReason: t(`${i18nPrefix}.reason.${deprecatedReasonKey}`) })}
              </span>
            )
          }
          {
            !deprecatedReason && (
              <span>{t(`${i18nPrefix}.noReason`)}</span>
            )
          }
        </div>
      </div>
    </div>
  )
}

export default React.memo(DeprecationNotice)
