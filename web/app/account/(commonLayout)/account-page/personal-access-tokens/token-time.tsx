import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function TokenTime({
  value,
  expiration = false,
}: {
  value: string | null
  expiration?: boolean
}) {
  const { t, i18n } = useTranslation(['accountSettings'])
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  if (value === null) return expiration ? t(($) => $['personalAccessToken.never']) : '—'
  const timestamp = new Date(value)
  const seconds = (timestamp.getTime() - now) / 1000
  const soon = expiration && seconds > 0 && seconds <= 7 * 86400
  const unit = Math.abs(seconds) < 3600 ? 'minute' : Math.abs(seconds) < 86400 ? 'hour' : 'day'
  const divisor = unit === 'minute' ? 60 : unit === 'hour' ? 3600 : 86400
  const text =
    expiration && !soon
      ? timestamp.toISOString().slice(0, 10)
      : new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(
          Math.round(seconds / divisor),
          unit,
        )
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            dateTime={value}
            aria-label={timestamp.toLocaleString(i18n.language)}
            className={
              soon ? 'text-text-warning focus-visible:outline-2' : 'focus-visible:outline-2'
            }
          />
        }
      >
        {text}
      </TooltipTrigger>
      <TooltipContent>{timestamp.toLocaleString(i18n.language)}</TooltipContent>
    </Tooltip>
  )
}
