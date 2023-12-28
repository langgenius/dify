import type { FC } from 'react'
import { useState } from 'react'
import type { ModelParameterRule } from '../declarations'
import { useLanguage } from '../hooks'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import Slider from '@/app/components/base/slider'
import Radio from '@/app/components/base/radio'
import { SimpleSelect } from '@/app/components/base/select'
import TagInput from '@/app/components/base/tag-input'

export type ParameterValue = number | string | string[] | boolean | undefined
type ParameterItemProps = {
  parameterRule: ModelParameterRule
  value?: ParameterValue
  onChange?: (value: ParameterValue) => void
  className?: string
  onSwitch?: (checked: boolean, assignValue: ParameterValue) => void
}
const ParameterItem: FC<ParameterItemProps> = ({
  parameterRule,
  value,
  onChange,
  className,
  onSwitch,
}) => {
  const language = useLanguage()
  const [localValue, setLocalValue] = useState(value)
  const mergedValue = value === undefined ? localValue : value
  const renderValue = mergedValue === undefined ? parameterRule.default : mergedValue

  const handleChange = (v: ParameterValue) => {
    setLocalValue(v)
    if (value !== undefined && onChange)
      onChange(v)
  }

  const handleNumberInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let num = +e.target.value

    if (parameterRule.max !== undefined && num > parameterRule.max)
      num = parameterRule.max

    if (parameterRule.min !== undefined && num < parameterRule.min)
      num = parameterRule.min

    handleChange(num)
  }

  const handleSlideChange = (num: number) => {
    handleChange(num)
  }

  const handleRadioChange = (v: number) => {
    handleChange(v === 1)
  }

  const handleStringInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleChange(e.target.value)
  }

  const handleSelect = (option: { value: string | number; name: string }) => {
    handleChange(option.value)
  }

  const handleTagChange = (newSequences: string[]) => {
    handleChange(newSequences)
  }

  const handleSwitch = (checked: boolean) => {
    if (onSwitch) {
      let assignValue: ParameterValue = localValue

      if (localValue === undefined) {
        if (parameterRule.type === 'int' || parameterRule.type === 'float')
          assignValue = parameterRule.default !== undefined ? parameterRule.default : 0

        if (parameterRule.type === 'string' && !parameterRule.options?.length)
          assignValue = parameterRule.default || ''

        if (parameterRule.type === 'string' && parameterRule.options?.length)
          assignValue = parameterRule.options[0]

        if (parameterRule.type === 'boolean')
          assignValue = parameterRule.default !== undefined ? parameterRule.default : false

        if (parameterRule.type === 'tag')
          assignValue = parameterRule.default !== undefined ? parameterRule.default : []
      }

      onSwitch(checked, assignValue)
    }
  }

  const numberInputWithSlide = (parameterRule.type === 'int' || parameterRule.type === 'float')
    && parameterRule.min !== undefined
    && parameterRule.max !== undefined
  const numberInput = (parameterRule.type === 'int' || parameterRule.type === 'float')
    && (parameterRule.min === undefined || parameterRule.max === undefined)

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div>
        <div className='shrink-0 flex items-center w-[200px]'>
          <div
            className='mr-0.5 text-[13px] font-medium text-gray-700 truncate'
            title={parameterRule.label[language]}
          >
            {parameterRule.label[language]}
          </div>
          {
            parameterRule.help && (
              <Tooltip
                selector={`model-parameter-rule-${parameterRule.name}`}
                htmlContent={(
                  <div className='w-[200px] whitespace-pre-wrap'>{parameterRule.help[language]}</div>
                )}
              >
                <HelpCircle className='mr-1.5 w-3.5 h-3.5 text-gray-400' />
              </Tooltip>
            )
          }
          {
            !parameterRule.required && (
              <Switch
                defaultValue={value !== undefined}
                onChange={handleSwitch}
                size='md'
              />
            )
          }
        </div>
        {
          parameterRule.type === 'tag' && (
            <div className='w-[200px] text-gray-400 text-xs font-normal'>
              {parameterRule?.tagPlaceholder?.[language]}
            </div>
          )
        }
      </div>
      {
        numberInputWithSlide && (
          <div className='flex items-center'>
            <Slider
              className='w-[120px]'
              value={renderValue === undefined ? 0 : +renderValue}
              min={parameterRule.min}
              max={parameterRule.max}
              step={+`0.${parameterRule.precision || 0}`}
              onChange={handleSlideChange}
            />
            <input
              className='shrink-0 block ml-4 pl-3 w-16 h-8 appearance-none outline-none rounded-lg bg-gray-100 text-[13px] text-gra-900'
              type='number'
              max={parameterRule.max}
              min={parameterRule.min}
              step={+`0.${parameterRule.precision || 0}`}
              value={renderValue === undefined ? 0 : +renderValue}
              onChange={handleNumberInputChange}
            />
          </div>
        )
      }
      {
        parameterRule.type === 'boolean' && (
          <Radio.Group
            className='w-[200px] flex items-center'
            value={renderValue === undefined ? 1 : 0}
            onChange={handleRadioChange}
          >
            <Radio value={1} className='!mr-1 w-[94px]'>True</Radio>
            <Radio value={0} className='w-[94px]'>False</Radio>
          </Radio.Group>
        )
      }
      {
        numberInput && (
          <input
            className='flex items-center px-3 w-[200px] h-8 appearance-none outline-none rounded-lg bg-gray-100 text-[13px] text-gra-900'
            value={(renderValue === undefined ? '' : renderValue) as string}
            onChange={handleNumberInputChange}
          />
        )
      }
      {
        parameterRule.type === 'string' && !parameterRule.options?.length && (
          <input
            className='flex items-center px-3 w-[200px] h-8 appearance-none outline-none rounded-lg bg-gray-100 text-[13px] text-gra-900'
            value={(renderValue === undefined ? '' : renderValue) as string}
            onChange={handleStringInputChange}
          />
        )
      }
      {
        parameterRule.type === 'string' && parameterRule?.options?.length && (
          <SimpleSelect
            className='!py-0'
            wrapperClassName='!w-[200px] !h-8'
            defaultValue={renderValue as string}
            onSelect={handleSelect}
            items={parameterRule.options.map(option => ({ value: option, name: option }))}
          />
        )
      }
      {
        parameterRule.type === 'tag' && (
          <div className='w-[200px]'>
            <TagInput
              items={renderValue === undefined ? [] : (renderValue as string[])}
              onChange={handleTagChange}
              customizedConfirmKey='Tab'
            />
          </div>
        )
      }
    </div>
  )
}

export default ParameterItem
