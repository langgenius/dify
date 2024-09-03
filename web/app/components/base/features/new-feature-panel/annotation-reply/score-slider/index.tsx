'use client'
import type { FC } from 'react'
import React from 'react'
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
      <div className='h-[1px] mt-[14px]'>
        <Slider
          max={100}
          min={80}
          step={1}
          value={value}
          onChange={onChange}
        />
      </div>
      <div className='mt-[10px] flex justify-between items-center leading-4 text-xs font-normal '>
        <div className='flex space-x-1 text-[#00A286]'>
          <div>0.8</div>
          <div>·</div>
          <div>{t('appDebug.feature.annotation.scoreThreshold.easyMatch')}</div>
        </div>
        <div className='flex space-x-1 text-[#0057D8]'>
          <div>1.0</div>
          <div>·</div>
          <div>{t('appDebug.feature.annotation.scoreThreshold.accurateMatch')}</div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(ScoreSlider)
