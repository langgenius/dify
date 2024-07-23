import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DEFAULT_WEIGHTED_SCORE,
  WeightedScoreEnum,
} from '@/models/datasets'
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
  type: WeightedScoreEnum
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
  const options = [
    {
      value: WeightedScoreEnum.SemanticFirst,
      label: t('dataset.weightedScore.semanticFirst'),
    },
    {
      value: WeightedScoreEnum.KeywordFirst,
      label: t('dataset.weightedScore.keywordFirst'),
    },
    {
      value: WeightedScoreEnum.Customized,
      label: t('dataset.weightedScore.customized'),
    },
  ]

  const disabled = value.type !== WeightedScoreEnum.Customized

  const handleTypeChange = useCallback((type: WeightedScoreEnum) => {
    const result = { ...value, type }

    if (type === WeightedScoreEnum.SemanticFirst)
      result.value = [DEFAULT_WEIGHTED_SCORE.semanticFirst.semantic, DEFAULT_WEIGHTED_SCORE.semanticFirst.keyword]

    if (type === WeightedScoreEnum.KeywordFirst)
      result.value = [DEFAULT_WEIGHTED_SCORE.keywordFirst.semantic, DEFAULT_WEIGHTED_SCORE.keywordFirst.keyword]

    onChange(result)
  }, [value, onChange])

  return (
    <div>
      <div className='flex items-center mb-1 space-x-4'>
        {
          options.map(option => (
            <div
              key={option.value}
              className='flex py-1.5 max-w-[calc((100%-32px)/3)] system-sm-regular text-text-secondary cursor-pointer'
              onClick={() => handleTypeChange(option.value)}
            >
              <div
                className={cn(
                  'shrink-0 mr-2 w-4 h-4 bg-components-radio-bg border border-components-radio-border rounded-full shadow-xs',
                  value.type === option.value && 'border-[5px] border-components-radio-border-checked',
                )}
              ></div>
              <div className='truncate' title={option.label}>{option.label}</div>
            </div>
          ))
        }
      </div>
      <div className='flex items-center px-3 h-9 space-x-3 rounded-lg border border-components-panel-border'>
        <div className='shrink-0 flex items-center w-[90px] system-xs-semibold-uppercase text-util-colors-blue-blue-500'>
          <div className='mr-1 truncate uppercase' title={t('dataset.weightedScore.semantic') || ''}>
            {t('dataset.weightedScore.semantic')}
          </div>
          {formatNumber(value.value[0])}
        </div>
        <Slider
          className={cn('grow h-0.5 bg-gradient-to-r from-[#53B1FD] to-[#2ED3B7]', disabled && 'cursor-not-allowed')}
          max={1.0}
          min={0}
          step={0.1}
          value={value.value[0]}
          onChange={v => onChange({ type: value.type, value: [v, (10 - v * 10) / 10] })}
          disabled={disabled}
          thumbClassName={cn(disabled && '!cursor-not-allowed')}
          trackClassName='!bg-transparent'
        />
        <div className='shrink-0 flex items-center justify-end w-[90px] system-xs-semibold-uppercase text-util-colors-cyan-cyan-500'>
          {formatNumber(value.value[1])}
          <div className='ml-1 truncate uppercase' title={t('dataset.weightedScore.keyword') || ''}>
            {t('dataset.weightedScore.keyword')}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(WeightedScore)
