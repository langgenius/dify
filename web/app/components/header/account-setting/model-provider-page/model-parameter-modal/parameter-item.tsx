import type { FC } from 'react'
import type { ModelParameterRule } from '../declarations'
import { useLanguage } from '../hooks'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import Slider from '@/app/components/base/slider'

type ParameterItemProps = {
  parameterRule: ModelParameterRule
  value: number
  onChange: (value: number) => void
  className?: string
}
const ParameterItem: FC<ParameterItemProps> = ({
  parameterRule,
  value,
  onChange,
  className,
}) => {
  const language = useLanguage()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let num = +e.target.value

    if (num > parameterRule.max)
      num = parameterRule.max

    if (num < parameterRule.min)
      num = parameterRule.min

    onChange(num)
  }

  return (
    <div className={`flex items-center justify-between h-8 ${className}`}>
      <div className='shrink-0   flex items-center w-[200px]'>
        <div
          className='mr-0.5 text-[13px] font-medium text-gray-700 truncate'
          title={parameterRule.label[language]}
        >
          {parameterRule.label[language]}
        </div>
        <Tooltip
          selector={`model-parameter-rule-${parameterRule.name}`}
          htmlContent={(
            <div className='w-[200px] whitespace-pre-wrap'>{parameterRule.help[language]}</div>
          )}
        >
          <HelpCircle className='mr-1.5 w-3.5 h-3.5 text-gray-400' />
        </Tooltip>
        {
          !parameterRule.required && (
            <Switch
              defaultValue={parameterRule.required}
              onChange={() => {}}
              size='md'
            />
          )
        }
      </div>
      {
        (parameterRule.type === 'int' || parameterRule.type === 'float') && (
          <div className='flex items-center'>
            <Slider
              className='w-[120px]'
              value={value}
              min={parameterRule.min}
              max={parameterRule.max}
              step={+`0.${parameterRule.precision}`}
              onChange={onChange}
            />
            <input
              className='shrink-0 block ml-4 pl-3 w-16 h-8 appearance-none outline-none rounded-lg bg-gray-100 text-[13px] text-gra-900'
              type='number'
              max={parameterRule.max}
              min={parameterRule.min}
              step={+`0.${parameterRule.precision}`}
              value={value}
              onChange={handleChange}
            />
          </div>
        )
      }
    </div>
  )
}

export default ParameterItem
