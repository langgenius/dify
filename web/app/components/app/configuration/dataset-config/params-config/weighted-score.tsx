import { memo } from 'react'
import { WeightedScoreEnum } from '@/models/datasets'
import Slider from '@/app/components/base/slider'
import cn from '@/utils/classnames'

const formatNumber = (value: number) => {
  if (value > 0 && value < 1)
    return `0.${value * 10}`
  else if (value === 1)
    return '1.0'

  return value
}

type WeightedScoreProps = {
  type?: WeightedScoreEnum
  onTypeChange?: (type: WeightedScoreEnum) => void
  value?: number
  onValueChange?: (value: number) => void
}
const WeightedScore = ({
  type = WeightedScoreEnum.Customized,
  onTypeChange = () => {},
  value = 0,
  onValueChange = () => {},
}: WeightedScoreProps) => {
  const options = [
    {
      value: WeightedScoreEnum.SemanticFirst,
      label: 'Semantic first',
    },
    {
      value: WeightedScoreEnum.KeywordFirst,
      label: 'Keyword first',
    },
    {
      value: WeightedScoreEnum.Customized,
      label: 'Customized',
    },
  ]

  const disabled = type !== WeightedScoreEnum.Customized

  return (
    <div>
      <div className='flex items-center mb-1 space-x-4'>
        {
          options.map(option => (
            <div
              key={option.value}
              className='flex py-1.5 max-w-[calc((100%-32px)/3)] system-sm-regular text-text-secondary cursor-pointer'
              onClick={() => onTypeChange(option.value)}
            >
              <div
                className={cn(
                  'shrink-0 mr-2 w-4 h-4 bg-components-radio-bg border border-components-radio-border rounded-full shadow-xs',
                  type === option.value && 'border-[5px] border-components-radio-border-checked',
                )}
              ></div>
              <div className='truncate' title={option.label}>{option.label}</div>
            </div>
          ))
        }
      </div>
      <div className='flex items-center px-3 h-9 space-x-3 rounded-lg border border-components-panel-border'>
        <div className='shrink-0 flex items-center w-[86px] system-xs-semibold-uppercase text-util-colors-blue-blue-500'>
          <div className='mr-1 truncate' title='SEMANTIC'>SEMANTIC</div>
          {formatNumber(value)}
        </div>
        <Slider
          className={cn('grow', disabled && 'cursor-not-allowed')}
          max={1.0}
          min={0}
          step={0.1}
          value={value}
          onChange={onValueChange}
          disabled={disabled}
          thumbClassName={cn(disabled && '!cursor-not-allowed')}
        />
        <div className='shrink-0 flex items-center w-[86px] system-xs-semibold-uppercase text-util-colors-cyan-cyan-500'>
          {formatNumber((10 - value * 10) / 10)}
          <div className='ml-1 truncate' title='SEMANTIC'>KEYWORD</div>
        </div>
      </div>
    </div>
  )
}

export default memo(WeightedScore)
