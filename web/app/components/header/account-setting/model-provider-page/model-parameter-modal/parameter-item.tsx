import type { FC } from 'react'
import { useState } from 'react'
import type { ModelParameterRule } from '../declarations'
import { useLanguage } from '../hooks'
import { isNullOrUndefined } from '../utils'
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
  const mergedValue = isNullOrUndefined(value) ? localValue : value

  const getDefaultValue = () => {
    let defaultValue: ParameterValue

    if (parameterRule.type === 'int' || parameterRule.type === 'float') {
      if (isNullOrUndefined(parameterRule.default)) {
        if (parameterRule.min)
          defaultValue = parameterRule.min
        else
          defaultValue = 0
      }
      else {
        defaultValue = parameterRule.default
      }
    }

    if (parameterRule.type === 'string' && !parameterRule.options?.length)
      defaultValue = parameterRule.default || ''

    if (parameterRule.type === 'string' && parameterRule.options?.length)
      defaultValue = parameterRule.default || ''

    if (parameterRule.type === 'boolean')
      defaultValue = !isNullOrUndefined(parameterRule.default) ? parameterRule.default : false

    if (parameterRule.type === 'tag')
      defaultValue = !isNullOrUndefined(parameterRule.default) ? parameterRule.default : []

    return defaultValue
  }
  const renderValue = isNullOrUndefined(mergedValue) ? getDefaultValue() : mergedValue

  const handleChange = (v: ParameterValue) => {
    setLocalValue(v)

    if (onChange) {
      if (parameterRule.name === 'stop')
        onChange(v)
      else if (!isNullOrUndefined(value))
        onChange(v)
    }
  }

  const handleNumberInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let num = +e.target.value

    if (!isNullOrUndefined(parameterRule.max) && num > parameterRule.max!)
      num = parameterRule.max as number

    if (!isNullOrUndefined(parameterRule.min) && num < parameterRule.min!)
      num = parameterRule.min as number

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

      if (isNullOrUndefined(localValue))
        assignValue = getDefaultValue()

      onSwitch(checked, assignValue)
    }
  }

  const numberInputWithSlide = (parameterRule.type === 'int' || parameterRule.type === 'float')
    && !isNullOrUndefined(parameterRule.min)
    && !isNullOrUndefined(parameterRule.max)
  const numberInput = (parameterRule.type === 'int' || parameterRule.type === 'float')
    && (isNullOrUndefined(parameterRule.min) || isNullOrUndefined(parameterRule.max))

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
            !parameterRule.required && parameterRule.name !== 'stop' && (
              <Switch
                defaultValue={!isNullOrUndefined(value)}
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
              value={renderValue as number}
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
              value={renderValue as string}
              onChange={handleNumberInputChange}
            />
          </div>
        )
      }
      {
        parameterRule.type === 'boolean' && (
          <Radio.Group
            className='w-[200px] flex items-center'
            value={renderValue ? 1 : 0}
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
            type='number'
            className='flex items-center px-3 w-[200px] h-8 appearance-none outline-none rounded-lg bg-gray-100 text-[13px] text-gra-900'
            value={renderValue as string}
            onChange={handleNumberInputChange}
          />
        )
      }
      {
        parameterRule.type === 'string' && !parameterRule.options?.length && (
          <input
            className='flex items-center px-3 w-[200px] h-8 appearance-none outline-none rounded-lg bg-gray-100 text-[13px] text-gra-900'
            value={renderValue as string}
            onChange={handleStringInputChange}
          />
        )
      }
      {
        parameterRule.type === 'string' && !!parameterRule?.options?.length && (
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
              items={renderValue as string[]}
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
