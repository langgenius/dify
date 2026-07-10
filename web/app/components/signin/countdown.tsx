'use client'
import { useCountDown } from 'ahooks'
import { useIsClient } from 'foxact/use-is-client'
import { Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { COUNT_DOWN_TIME_MS, useCountdownLeftTimeValue, useSetCountdownLeftTime } from './storage'

type CountdownProps = {
  onResend?: () => void
}

export default function Countdown({ onResend }: CountdownProps) {
  const isClient = useIsClient()

  if (!isClient)
    return <CountdownFallback />

  return (
    <Suspense fallback={<CountdownFallback />}>
      <CountdownContent onResend={onResend} />
    </Suspense>
  )
}

function CountdownFallback() {
  const { t } = useTranslation()

  return (
    <p className="system-xs-regular text-text-tertiary">
      <span>{t($ => $['checkCode.didNotReceiveCode'], { ns: 'login' })}</span>
    </p>
  )
}

function CountdownContent({ onResend }: CountdownProps) {
  const { t } = useTranslation()
  const storedLeftTime = useCountdownLeftTimeValue()
  const setStoredLeftTime = useSetCountdownLeftTime()
  const [leftTime, setLeftTime] = useState(() => Number(storedLeftTime || COUNT_DOWN_TIME_MS))
  const [time] = useCountDown({
    leftTime,
    onEnd: () => {
      setLeftTime(0)
      setStoredLeftTime(null)
    },
  })

  const resend = async function () {
    setLeftTime(COUNT_DOWN_TIME_MS)
    setStoredLeftTime(`${COUNT_DOWN_TIME_MS}`)
    onResend?.()
  }

  useEffect(() => {
    setStoredLeftTime(`${time}`)
  }, [setStoredLeftTime, time])

  return (
    <p className="system-xs-regular text-text-tertiary">
      <span>{t($ => $['checkCode.didNotReceiveCode'], { ns: 'login' })}</span>
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
            {t($ => $['checkCode.resend'], { ns: 'login' })}
          </button>
        )
      }
    </p>
  )
}
