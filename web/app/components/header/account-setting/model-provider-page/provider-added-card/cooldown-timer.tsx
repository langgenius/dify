import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SimplePieChart from '@/app/components/base/simple-pie-chart'

type CooldownTimerProps = {
  secondsRemaining?: number
  onFinish?: () => void
}

const CooldownTimer = ({ secondsRemaining = 0, onFinish }: CooldownTimerProps) => {
  const { t } = useTranslation()

  const [countdown, setCountdown] = useState({ secondsRemaining, displayTime: secondsRemaining })
  if (countdown.secondsRemaining !== secondsRemaining) {
    setCountdown({ secondsRemaining, displayTime: secondsRemaining })
  }

  const onCountdownFinish = useEffectEvent(() => {
    onFinish?.()
  })

  useEffect(() => {
    if (secondsRemaining <= 0) return

    const targetTime = Date.now() + secondsRemaining * 1000
    const interval = window.setInterval(() => {
      const displayTime = Math.max(0, Math.ceil((targetTime - Date.now()) / 1000))
      setCountdown({ secondsRemaining, displayTime })
      if (displayTime === 0) {
        window.clearInterval(interval)
        onCountdownFinish()
      }
    }, 1000)

    return () => window.clearInterval(interval)
  }, [secondsRemaining])

  const { displayTime } = countdown

  return displayTime ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <SimplePieChart percentage={Math.round((displayTime / 60) * 100)} className="size-3" />
        }
      />
      <TooltipContent>
        {t(($) => $['modelProvider.apiKeyRateLimit'], { ns: 'common', seconds: displayTime })}
      </TooltipContent>
    </Tooltip>
  ) : null
}

export default CooldownTimer
