'use client'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { getRelativeTime, isRelativeTimeSameOrAfter } from './utils'

type ExpirationTimeProps = {
  expirationTime: number
}

const ExpirationTime = ({
  expirationTime,
}: ExpirationTimeProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const relativeTime = getRelativeTime(expirationTime, locale)
  const isSameOrAfter = isRelativeTimeSameOrAfter(expirationTime)

  return (
    <div className="system-xs-regular mt-1 text-text-tertiary">
      {isSameOrAfter
        ? t('humanInput.expirationTimeNowOrFuture', { relativeTime, ns: 'share' })
        : t('humanInput.expirationTimePast', { relativeTime, ns: 'share' })}
    </div>
  )
}

export default ExpirationTime
