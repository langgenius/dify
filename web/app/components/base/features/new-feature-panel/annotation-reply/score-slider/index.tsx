'use client'
import type { FC } from 'react'
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderLabel,
  SliderThumb,
  SliderTrack,
  SliderValue,
} from '@langgenius/dify-ui/slider'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  className?: string
  value: number
  onChange: (value: number) => void
}>

const clamp = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min

  return Math.min(Math.max(value, min), max)
}

const SCORE_MIN = 0
const SCORE_MAX = 1

const ScoreSlider: FC<Props> = ({ className, value, onChange }) => {
  const { t } = useTranslation(['appDebug'])
  const safeValue = clamp(value, SCORE_MIN, SCORE_MAX)

  return (
    <div className={className}>
      <Slider
        className="mt-3.5 flex w-full"
        value={safeValue}
        min={SCORE_MIN}
        max={SCORE_MAX}
        step={0.01}
        largeStep={0.1}
        format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
        onValueChange={onChange}
      >
        <SliderLabel className="sr-only">
          {t(($) => $['feature.annotation.scoreThreshold.title'], { ns: 'appDebug' })}
        </SliderLabel>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb>
              <SliderValue className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 system-sm-semibold whitespace-nowrap text-text-primary" />
            </SliderThumb>
          </SliderTrack>
        </SliderControl>
      </Slider>
      <div className="mt-2.5 flex items-center justify-between system-xs-semibold-uppercase">
        <div className="flex space-x-1 text-util-colors-cyan-cyan-500">
          <div>0.0</div>
          <div>·</div>
          <div>
            {t(($) => $['feature.annotation.scoreThreshold.easyMatch'], { ns: 'appDebug' })}
          </div>
        </div>
        <div className="flex space-x-1 text-util-colors-blue-blue-500">
          <div>1.0</div>
          <div>·</div>
          <div>
            {t(($) => $['feature.annotation.scoreThreshold.accurateMatch'], { ns: 'appDebug' })}
          </div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(ScoreSlider)
