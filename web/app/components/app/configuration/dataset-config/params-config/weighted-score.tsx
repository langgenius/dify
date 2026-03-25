import { noop } from 'es-toolkit/function'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Slider from '@/app/components/base/slider'
import { cn } from '@/utils/classnames'
import './weighted-score.css'

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
  readonly?: boolean
}
const WeightedScore = ({
  value,
  onChange = noop,
  readonly = false,
}: WeightedScoreProps) => {
  const { t } = useTranslation()

  return (
    <div>
      <div className="space-x-3 rounded-lg border border-components-panel-border px-3 pb-2 pt-5">
        <Slider
          className={cn('h-0.5 grow rounded-full !bg-util-colors-teal-teal-500')}
          max={1.0}
          min={0}
          step={0.1}
          value={value.value[0]}
          onChange={v => !readonly && onChange({ value: [v, (10 - v * 10) / 10] })}
          trackClassName="weightedScoreSliderTrack"
          disabled={readonly}
        />
        <div className="mt-3 flex justify-between">
          <div className="system-xs-semibold-uppercase flex w-[90px] shrink-0 items-center text-util-colors-blue-light-blue-light-500">
            <div className="mr-1 truncate uppercase" title={t('weightedScore.semantic', { ns: 'dataset' }) || ''}>
              {t('weightedScore.semantic', { ns: 'dataset' })}
            </div>
            {formatNumber(value.value[0])}
          </div>
          <div className="system-xs-semibold-uppercase flex w-[90px] shrink-0 items-center justify-end text-util-colors-teal-teal-500">
            {formatNumber(value.value[1])}
            <div className="ml-1 truncate uppercase" title={t('weightedScore.keyword', { ns: 'dataset' }) || ''}>
              {t('weightedScore.keyword', { ns: 'dataset' })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(WeightedScore)
