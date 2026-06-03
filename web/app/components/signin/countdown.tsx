'use client'
import { useCountDown } from 'ahooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocalStorage } from '@/hooks/use-local-storage'

export const COUNT_DOWN_TIME_MS = 59000
export const COUNT_DOWN_KEY = 'leftTime'

type CountdownProps = {
  onResend?: () => void
}

export default function Countdown({ onResend }: CountdownProps) {
  const { t } = useTranslation()
  const [storedLeftTime, setStoredLeftTime] = useLocalStorage<number>(COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS)
  const [leftTime, setLeftTime] = useState(storedLeftTime)
  const [time] = useCountDown({
    leftTime,
    onEnd: () => {
      setLeftTime(0)
      setStoredLeftTime(null)
    },
  })

  const resend = async function () {
    setLeftTime(COUNT_DOWN_TIME_MS)
    setStoredLeftTime(COUNT_DOWN_TIME_MS)
    onResend?.()
  }

  useEffect(() => {
    setStoredLeftTime(time)
  }, [setStoredLeftTime, time])

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
