'use client'
import { useCountDown } from 'ahooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const COUNT_DOWN_TIME_MS = 59000
const COUNT_DOWN_KEY = 'leftTime'

type CountdownProps = {
  onResend?: () => void
}

export default function Countdown({ onResend }: CountdownProps) {
  const { t } = useTranslation()
  const [leftTime, setLeftTime] = useState(Number(localStorage.getItem(COUNT_DOWN_KEY) || COUNT_DOWN_TIME_MS))
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

  return <p className='text-text-tertiary text-xs'>
    <span>{t('login.checkCode.didNotReceiveCode')}</span>
    {time > 0 && <span>{Math.round(time / 1000)}s</span>}
    {
      time <= 0 && <span className='text-text-accent-secondary cursor-pointer' onClick={resend}>{t('login.checkCode.resend')}</span>
    }
  </p>
}
