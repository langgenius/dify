'use client'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { formatRelativeTimeInZone } from './utils'

type ExpirationTimeProps = {
  expirationTime: number
}

const ExpirationTime = ({
  expirationTime,
}: ExpirationTimeProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const relativeTime = formatRelativeTimeInZone(expirationTime, locale)

  return (
    <div className="system-xs-regular mt-1 text-text-tertiary">
      {t('humanInput.expirationTime', { relativeTime, ns: 'share' })}
    </div>
  )
}

export default ExpirationTime
