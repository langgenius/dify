'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Slider } from '@/app/components/base/ui/slider'

type Props = {
  className?: string
  value: number
  onChange: (value: number) => void
}

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value))
    return min

  return Math.min(Math.max(value, min), max)
}

const ScoreSlider: FC<Props> = ({
  className,
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const safeValue = clamp(value, 80, 100)

  return (
    <div className={className}>
      <div className="relative mt-[14px]">
        <Slider
          className="w-full"
          value={safeValue}
          min={80}
          max={100}
          step={1}
          onValueChange={onChange}
          aria-label={t('feature.annotation.scoreThreshold.title', { ns: 'appDebug' })}
        />
        <div
          className="pointer-events-none absolute top-[-16px] text-text-primary system-sm-semibold"
          style={{
            left: `calc(4px + ${(safeValue - 80) / 20} * (100% - 8px))`,
            transform: 'translateX(-50%)',
          }}
        >
          {(safeValue / 100).toFixed(2)}
        </div>
      </div>
      <div className="mt-[10px] flex items-center justify-between system-xs-semibold-uppercase">
        <div className="flex space-x-1 text-util-colors-cyan-cyan-500">
          <div>0.8</div>
          <div>·</div>
          <div>{t('feature.annotation.scoreThreshold.easyMatch', { ns: 'appDebug' })}</div>
        </div>
        <div className="flex space-x-1 text-util-colors-blue-blue-500">
          <div>1.0</div>
          <div>·</div>
          <div>{t('feature.annotation.scoreThreshold.accurateMatch', { ns: 'appDebug' })}</div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(ScoreSlider)
