'use client'
import { useCountDown } from 'ahooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export const COUNT_DOWN_TIME_MS = 59000
export const COUNT_DOWN_KEY = 'leftTime'

type CountdownProps = {
  onResend?: () => void
}

export default function Countdown({ onResend }: CountdownProps) {
  const { t } = useTranslation()
  const [leftTime, setLeftTime] = useState(() => Number(localStorage.getItem(COUNT_DOWN_KEY) || COUNT_DOWN_TIME_MS))
  const [time] = useCountDown({
    leftTime,
    onEnd: () => {
      setLeftTime(0)
      localStorage.removeItem(COUNT_DOWN_KEY)
    },
  })

  const resend = async function () {
    setLeftTime(COUNT_DOWN_TIME_MS)
    localStorage.setItem(COUNT_DOWN_KEY, `${COUNT_DOWN_TIME_MS}`)
    onResend?.()
  }

  useEffect(() => {
    localStorage.setItem(COUNT_DOWN_KEY, `${time}`)
  }, [time])

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
        time <= 0 && <span className="system-xs-medium cursor-pointer text-text-accent-secondary" onClick={resend}>{t('checkCode.resend', { ns: 'login' })}</span>
      }
    </p>
  )
}
