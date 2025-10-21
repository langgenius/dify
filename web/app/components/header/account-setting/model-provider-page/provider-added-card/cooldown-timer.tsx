import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLatest } from 'ahooks'
import SimplePieChart from '@/app/components/base/simple-pie-chart'
import Tooltip from '@/app/components/base/tooltip'

export type CooldownTimerProps = {
  secondsRemaining?: number
  onFinish?: () => void
}

const CooldownTimer = ({ secondsRemaining, onFinish }: CooldownTimerProps) => {
  const { t } = useTranslation()

  const targetTime = useRef<number>(Date.now())
  const [currentTime, setCurrentTime] = useState(targetTime.current)
  const displayTime = useMemo(
    () => Math.ceil((targetTime.current - currentTime) / 1000),
    [currentTime],
  )

  const countdownTimeout = useRef<number>(undefined)
  const clearCountdown = useCallback(() => {
    if (countdownTimeout.current) {
      window.clearTimeout(countdownTimeout.current)
      countdownTimeout.current = undefined
    }
  }, [])

  const onFinishRef = useLatest(onFinish)

  const countdown = useCallback(() => {
    clearCountdown()
    countdownTimeout.current = window.setTimeout(() => {
      const now = Date.now()
      if (now <= targetTime.current) {
        setCurrentTime(Date.now())
        countdown()
      }
      else {
        onFinishRef.current?.()
        clearCountdown()
      }
    }, 1000)
  }, [clearCountdown, onFinishRef])

  useEffect(() => {
    const now = Date.now()
    targetTime.current = now + (secondsRemaining ?? 0) * 1000
    setCurrentTime(now)
    countdown()
    return clearCountdown
  }, [clearCountdown, countdown, secondsRemaining])

  return displayTime
    ? (
      <Tooltip popupContent={t('common.modelProvider.apiKeyRateLimit', { seconds: displayTime })}>
        <SimplePieChart percentage={Math.round(displayTime / 60 * 100)} className='h-3 w-3' />
      </Tooltip>
    )
    : null
}

export default memo(CooldownTimer)
