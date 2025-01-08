import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import './weighted-score.css'
import Slider from '@/app/components/base/slider'
import cn from '@/utils/classnames'

const formatNumber = (value: number) => {
  if (value > 0 && value < 1)
    return `0.${value * 10}`
  else if (value === 1)
    return '1.0'

  return value
}

type Value = {
  value: number[]
}

type WeightedScoreProps = {
  value: Value
  onChange: (value: Value) => void
}
const WeightedScore = ({
  value,
  onChange = () => {},
}: WeightedScoreProps) => {
  const { t } = useTranslation()

  return (
    <div>
      <div className='px-3 pt-5 pb-2 space-x-3 rounded-lg border border-components-panel-border'>
        <Slider
          className={cn('grow h-0.5 !bg-util-colors-teal-teal-500 rounded-full')}
          max={1.0}
          min={0}
          step={0.1}
          value={value.value[0]}
          onChange={v => onChange({ value: [v, (10 - v * 10) / 10] })}
          trackClassName='weightedScoreSliderTrack'
        />
        <div className='flex justify-between mt-3'>
          <div className='shrink-0 flex items-center w-[90px] system-xs-semibold-uppercase text-util-colors-blue-light-blue-light-500'>
            <div className='mr-1 truncate uppercase' title={t('dataset.weightedScore.semantic') || ''}>
              {t('dataset.weightedScore.semantic')}
            </div>
            {formatNumber(value.value[0])}
          </div>
          <div className='shrink-0 flex items-center justify-end w-[90px] system-xs-semibold-uppercase text-util-colors-teal-teal-500'>
            {formatNumber(value.value[1])}
            <div className='ml-1 truncate uppercase' title={t('dataset.weightedScore.keyword') || ''}>
              {t('dataset.weightedScore.keyword')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(WeightedScore)
