import type { FC } from 'react'
import { useTranslation } from '#i18n'
import { RiAlertFill } from '@remixicon/react'
import { camelCase } from 'es-toolkit/string'
import Link from 'next/link'
import * as React from 'react'
import { useMemo } from 'react'
import { Trans } from 'react-i18next'
import { cn } from '@/utils/classnames'

type DeprecationNoticeProps = {
  status: 'deleted' | 'active'
  deprecatedReason: string
  alternativePluginId: string
  alternativePluginURL: string
  className?: string
  innerWrapperClassName?: string
  iconWrapperClassName?: string
  textClassName?: string
}

const i18nPrefix = 'detailPanel.deprecation'

type DeprecatedReasonKey = 'businessAdjustments' | 'ownershipTransferred' | 'noMaintainer'
const validReasonKeys: DeprecatedReasonKey[] = ['businessAdjustments', 'ownershipTransferred', 'noMaintainer']

function isValidReasonKey(key: string): key is DeprecatedReasonKey {
  return (validReasonKeys as string[]).includes(key)
}

const DeprecationNotice: FC<DeprecationNoticeProps> = ({
  status,
  deprecatedReason,
  alternativePluginId,
  alternativePluginURL,
  className,
  innerWrapperClassName,
  iconWrapperClassName,
  textClassName,
}) => {
  const { t } = useTranslation()

  const deprecatedReasonKey = useMemo(() => {
    if (!deprecatedReason)
      return null
    const key = camelCase(deprecatedReason)
    if (isValidReasonKey(key))
      return key
    return null
  }, [deprecatedReason])

  // Check if the deprecatedReasonKey exists in i18n
  const hasValidDeprecatedReason = deprecatedReasonKey !== null

  if (status !== 'deleted')
    return null

  return (
    <div className={cn('w-full', className)}>
      <div className={cn(
        'relative flex items-start gap-x-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]',
        innerWrapperClassName,
      )}
      >
        <div className="absolute left-0 top-0 -z-10 h-full w-full bg-toast-warning-bg opacity-40" />
        <div className={cn('flex size-6 shrink-0 items-center justify-center', iconWrapperClassName)}>
          <RiAlertFill className="size-4 text-text-warning-secondary" />
        </div>
        <div className={cn('system-xs-regular grow py-1 text-text-primary', textClassName)}>
          {
            hasValidDeprecatedReason && alternativePluginId && (
              <Trans
                t={t}
                i18nKey={`${i18nPrefix}.fullMessage`}
                ns="plugin"
                components={{
                  CustomLink: (
                    <Link
                      href={alternativePluginURL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    />
                  ),
                }}
                values={{
                  deprecatedReason: deprecatedReasonKey ? t(`${i18nPrefix}.reason.${deprecatedReasonKey}`, { ns: 'plugin' }) : '',
                  alternativePluginId,
                }}
              />
            )
          }
          {
            hasValidDeprecatedReason && !alternativePluginId && (
              <span>
                {t(`${i18nPrefix}.onlyReason`, { ns: 'plugin', deprecatedReason: deprecatedReasonKey ? t(`${i18nPrefix}.reason.${deprecatedReasonKey}`, { ns: 'plugin' }) : '' })}
              </span>
            )
          }
          {
            !hasValidDeprecatedReason && (
              <span>{t(`${i18nPrefix}.noReason`, { ns: 'plugin' })}</span>
            )
          }
        </div>
      </div>
    </div>
  )
}

export default React.memo(DeprecationNotice)
