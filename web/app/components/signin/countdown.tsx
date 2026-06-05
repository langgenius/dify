'use client'
import { useCountDown } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocalStorage } from '@/hooks/use-local-storage'

export const COUNT_DOWN_TIME_MS = 59000
export const COUNT_DOWN_KEY = 'leftTime'

type CountdownProps = {
  onResend?: () => void
}

export default function Countdown({ onResend }: CountdownProps) {
  const { t } = useTranslation()
  const [storedTime, setStoredTime] = useLocalStorage<string>(COUNT_DOWN_KEY, `${COUNT_DOWN_TIME_MS}`, { raw: true })
  const [leftTime, setLeftTime] = useState(() => Number(storedTime || COUNT_DOWN_TIME_MS))
  const [time] = useCountDown({
    leftTime,
    onEnd: () => {
      setLeftTime(0)
      setStoredTime('0')
    },
  })

  const resend = async function () {
    setLeftTime(COUNT_DOWN_TIME_MS)
    setStoredTime(`${COUNT_DOWN_TIME_MS}`)
    onResend?.()
  }

  // Sync countdown time to localStorage
  if (time !== undefined && `${time}` !== storedTime)
    setStoredTime(`${time}`)

  return (
    <p className="system-xs-regular text-text-tertiary">
      <span>{t('checkCode.didNotReceiveCode', { ns: 'login' })}</span>
      {time > 0 && (
        <span>
          {Math.round(time / 1000)}
          s
        </span>
      )}
      {
        time <= 0 && (
          <button
            type="button"
            className="cursor-pointer border-none bg-transparent p-0 text-left system-xs-medium text-text-accent-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            onClick={resend}
          >
            {t('checkCode.resend', { ns: 'login' })}
          </button>
        )
      }
    </p>
  )
}
