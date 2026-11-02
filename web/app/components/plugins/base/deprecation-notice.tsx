import type { FC } from 'react'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
import { camelCase } from 'es-toolkit/string'
import * as React from 'react'
import { useMemo } from 'react'
import { Trans } from 'react-i18next'
import { useTranslation } from '#i18n'
import Link from '@/next/link'

type DeprecationNoticeProps = {
  status: 'deleted' | 'active'
  deprecatedReason: string
  alternativePluginId: string
  alternativePluginURL: string
  className?: string
}

const i18nPrefix = 'detailPanel.deprecation'

type DeprecatedReasonKey = 'businessAdjustments' | 'ownershipTransferred' | 'noMaintainer'
const validReasonKeys: DeprecatedReasonKey[] = [
  'businessAdjustments',
  'ownershipTransferred',
  'noMaintainer',
]

function isValidReasonKey(key: string): key is DeprecatedReasonKey {
  return (validReasonKeys as string[]).includes(key)
}

const DeprecationNotice: FC<DeprecationNoticeProps> = ({
  status,
  deprecatedReason,
  alternativePluginId,
  alternativePluginURL,
  className,
}) => {
  const { t } = useTranslation(['plugin'])

  const deprecatedReasonKey = useMemo(() => {
    if (!deprecatedReason) return null
    const key = camelCase(deprecatedReason)
    if (isValidReasonKey(key)) return key
    return null
  }, [deprecatedReason])

  // Check if the deprecatedReasonKey exists in i18n
  const hasValidDeprecatedReason = deprecatedReasonKey !== null

  if (status !== 'deleted') return null

  return (
    <Alert type="warning" className={className}>
      <AlertTitle>
        {hasValidDeprecatedReason && alternativePluginId && (
          <Trans
            t={t}
            i18nKey={($) => $[`${i18nPrefix}.fullMessage`]}
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
              deprecatedReason: deprecatedReasonKey
                ? t(($) => $[`${i18nPrefix}.reason.${deprecatedReasonKey}`], { ns: 'plugin' })
                : '',
              alternativePluginId,
            }}
          />
        )}
        {hasValidDeprecatedReason && !alternativePluginId && (
          <span>
            {t(($) => $[`${i18nPrefix}.onlyReason`], {
              ns: 'plugin',
              deprecatedReason: deprecatedReasonKey
                ? t(($) => $[`${i18nPrefix}.reason.${deprecatedReasonKey}`], { ns: 'plugin' })
                : '',
            })}
          </span>
        )}
        {!hasValidDeprecatedReason && (
          <span>{t(($) => $[`${i18nPrefix}.noReason`], { ns: 'plugin' })}</span>
        )}
      </AlertTitle>
    </Alert>
  )
}

export default React.memo(DeprecationNotice)
