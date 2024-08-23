'use client'
import { useCountDown } from 'ahooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function Countdown() {
  const { t } = useTranslation()
  const [leftTime, setLeftTime] = useState(Number(localStorage.getItem('leftTime') || 59000))
  const [time] = useCountDown({
    leftTime,
    onEnd: () => { localStorage.removeItem('leftTime') },
  })

  const resend = async function () {
    setLeftTime(59000)
    localStorage.setItem('timeCountDown', '59000')
  }

  useEffect(() => {
    localStorage.setItem('leftTime', `${time}`)
  }, [time])

  return <p className='text-text-tertiary text-xs'>
    <span>{t('login.checkCode.didNotReceiveCode')}</span>
    {time > 0 && <span>{Math.round(time / 1000)}s</span>}
    {
      time <= 0 && <span className='text-text-accent-secondary cursor-pointer' onClick={resend}>{t('login.checkCode.resend')}</span>
    }
  </p>
}
