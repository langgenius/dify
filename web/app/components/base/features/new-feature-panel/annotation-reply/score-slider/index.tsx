'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Slider from '@/app/components/base/features/new-feature-panel/annotation-reply/score-slider/base-slider'

type Props = {
  className?: string
  value: number
  onChange: (value: number) => void
}

const ScoreSlider: FC<Props> = ({
  className,
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className={className}>
      <div className="mt-[14px] h-px">
        <Slider
          max={100}
          min={80}
          step={1}
          value={value}
          onChange={onChange}
        />
      </div>
      <div className="system-xs-semibold-uppercase mt-[10px] flex items-center justify-between">
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
