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
      <div className='border-components-panel-border space-x-3 rounded-lg border px-3 pb-2 pt-5'>
        <Slider
          className={cn('!bg-util-colors-teal-teal-500 h-0.5 grow rounded-full')}
          max={1.0}
          min={0}
          step={0.1}
          value={value.value[0]}
          onChange={v => onChange({ value: [v, (10 - v * 10) / 10] })}
          trackClassName='weightedScoreSliderTrack'
        />
        <div className='mt-3 flex justify-between'>
          <div className='system-xs-semibold-uppercase text-util-colors-blue-light-blue-light-500 flex w-[90px] shrink-0 items-center'>
            <div className='mr-1 truncate uppercase' title={t('dataset.weightedScore.semantic') || ''}>
              {t('dataset.weightedScore.semantic')}
            </div>
            {formatNumber(value.value[0])}
          </div>
          <div className='system-xs-semibold-uppercase text-util-colors-teal-teal-500 flex w-[90px] shrink-0 items-center justify-end'>
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
