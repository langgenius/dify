import type { FC } from 'react'
import type { ModelParameterRule } from '../declarations'
import { useEffect, useRef, useState } from 'react'
import Radio from '@/app/components/base/radio'
import { SimpleSelect } from '@/app/components/base/select'
import Slider from '@/app/components/base/slider'
import Switch from '@/app/components/base/switch'
import TagInput from '@/app/components/base/tag-input'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import { useLanguage } from '../hooks'
import { isNullOrUndefined } from '../utils'

export type ParameterValue = number | string | string[] | boolean | undefined

type ParameterItemProps = {
  parameterRule: ModelParameterRule
  value?: ParameterValue
  onChange?: (value: ParameterValue) => void
  onSwitch?: (checked: boolean, assignValue: ParameterValue) => void
  isInWorkflow?: boolean
}
const ParameterItem: FC<ParameterItemProps> = ({
  parameterRule,
  value,
  onChange,
  onSwitch,
  isInWorkflow,
}) => {
  const language = useLanguage()
  const [localValue, setLocalValue] = useState(value)
  const numberInputRef = useRef<HTMLInputElement>(null)

  const getDefaultValue = () => {
    let defaultValue: ParameterValue

    if (parameterRule.type === 'int' || parameterRule.type === 'float')
      defaultValue = isNullOrUndefined(parameterRule.default) ? (parameterRule.min || 0) : parameterRule.default
    else if (parameterRule.type === 'string' || parameterRule.type === 'text')
      defaultValue = parameterRule.default || ''
    else if (parameterRule.type === 'boolean')
      defaultValue = !isNullOrUndefined(parameterRule.default) ? parameterRule.default : false
    else if (parameterRule.type === 'tag')
      defaultValue = !isNullOrUndefined(parameterRule.default) ? parameterRule.default : []

    return defaultValue
  }

  const renderValue = value ?? localValue ?? getDefaultValue()

  const handleInputChange = (newValue: ParameterValue) => {
    setLocalValue(newValue)

    if (onChange && (parameterRule.name === 'stop' || !isNullOrUndefined(value) || parameterRule.required))
      onChange(newValue)
  }

  const handleNumberInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let num = +e.target.value

    if (!isNullOrUndefined(parameterRule.max) && num > parameterRule.max!) {
      num = parameterRule.max as number
      numberInputRef.current!.value = `${num}`
    }

    if (!isNullOrUndefined(parameterRule.min) && num < parameterRule.min!)
      num = parameterRule.min as number

    handleInputChange(num)
  }

  const handleNumberInputBlur = () => {
    if (numberInputRef.current)
      numberInputRef.current.value = renderValue as string
  }

  const handleSlideChange = (num: number) => {
    if (!isNullOrUndefined(parameterRule.max) && num > parameterRule.max!) {
      handleInputChange(parameterRule.max)
      numberInputRef.current!.value = `${parameterRule.max}`
      return
    }

    if (!isNullOrUndefined(parameterRule.min) && num < parameterRule.min!) {
      handleInputChange(parameterRule.min)
      numberInputRef.current!.value = `${parameterRule.min}`
      return
    }

    handleInputChange(num)
    numberInputRef.current!.value = `${num}`
  }

  const handleRadioChange = (v: boolean) => {
    handleInputChange(v)
  }

  const handleStringInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    handleInputChange(e.target.value)
  }

  const handleSelect = (option: { value: string | number, name: string }) => {
    handleInputChange(option.value)
  }

  const handleTagChange = (newSequences: string[]) => {
    handleInputChange(newSequences)
  }

  const handleSwitch = (checked: boolean) => {
    if (onSwitch) {
      const assignValue: ParameterValue = localValue || getDefaultValue()

      onSwitch(checked, assignValue)
    }
  }

  useEffect(() => {
    if ((parameterRule.type === 'int' || parameterRule.type === 'float') && numberInputRef.current)
      numberInputRef.current.value = `${renderValue}`
  }, [value])

  const renderInput = () => {
    const numberInputWithSlide = (parameterRule.type === 'int' || parameterRule.type === 'float')
      && !isNullOrUndefined(parameterRule.min)
      && !isNullOrUndefined(parameterRule.max)

    if (parameterRule.type === 'int') {
      let step = 100
      if (parameterRule.max) {
        if (parameterRule.max < 100)
          step = 1
        else if (parameterRule.max < 1000)
          step = 10
      }

      return (
        <>
          {numberInputWithSlide && (
            <Slider
              className="w-[120px]"
              value={renderValue as number}
              min={parameterRule.min}
              max={parameterRule.max}
              step={step}
              onChange={handleSlideChange}
            />
          )}
          <input
            ref={numberInputRef}
            className="system-sm-regular ml-4 block h-8 w-16 shrink-0 appearance-none rounded-lg bg-components-input-bg-normal pl-3 text-components-input-text-filled outline-none"
            type="number"
            max={parameterRule.max}
            min={parameterRule.min}
            step={numberInputWithSlide ? step : +`0.${parameterRule.precision || 0}`}
            onChange={handleNumberInputChange}
            onBlur={handleNumberInputBlur}
          />
        </>
      )
    }

    if (parameterRule.type === 'float') {
      return (
        <>
          {numberInputWithSlide && (
            <Slider
              className="w-[120px]"
              value={renderValue as number}
              min={parameterRule.min}
              max={parameterRule.max}
              step={0.1}
              onChange={handleSlideChange}
            />
          )}
          <input
            ref={numberInputRef}
            className="system-sm-regular ml-4 block h-8 w-16 shrink-0 appearance-none rounded-lg bg-components-input-bg-normal pl-3 text-components-input-text-filled outline-none"
            type="number"
            max={parameterRule.max}
            min={parameterRule.min}
            step={numberInputWithSlide ? 0.1 : +`0.${parameterRule.precision || 0}`}
            onChange={handleNumberInputChange}
            onBlur={handleNumberInputBlur}
          />
        </>
      )
    }

    if (parameterRule.type === 'boolean') {
      return (
        <Radio.Group
          className="flex w-[150px] items-center"
          value={renderValue as boolean}
          onChange={handleRadioChange}
        >
          <Radio value={true} className="w-[70px] px-[18px]">True</Radio>
          <Radio value={false} className="w-[70px] px-[18px]">False</Radio>
        </Radio.Group>
      )
    }

    if (parameterRule.type === 'string' && !parameterRule.options?.length) {
      return (
        <input
          className={cn(isInWorkflow ? 'w-[150px]' : 'w-full', 'system-sm-regular ml-4 flex h-8 appearance-none items-center rounded-lg bg-components-input-bg-normal px-3 text-components-input-text-filled outline-none')}
          value={renderValue as string}
          onChange={handleStringInputChange}
        />
      )
    }

    if (parameterRule.type === 'text') {
      return (
        <textarea
          className="system-sm-regular ml-4 h-20 w-full rounded-lg bg-components-input-bg-normal px-1 text-components-input-text-filled"
          value={renderValue as string}
          onChange={handleStringInputChange}
        />
      )
    }

    if (parameterRule.type === 'string' && !!parameterRule?.options?.length) {
      return (
        <SimpleSelect
          className="!py-0"
          wrapperClassName={cn('!h-8 w-full')}
          defaultValue={renderValue as string}
          onSelect={handleSelect}
          items={parameterRule.options.map(option => ({ value: option, name: option }))}
        />
      )
    }

    if (parameterRule.type === 'tag') {
      return (
        <div className={cn('!h-8 w-full')}>
          <TagInput
            items={renderValue as string[]}
            onChange={handleTagChange}
            customizedConfirmKey="Tab"
            isInWorkflow={isInWorkflow}
            required={parameterRule.required}
          />
        </div>
      )
    }

    return null
  }

  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="shrink-0 basis-1/2">
        <div className={cn('flex w-full shrink-0 items-center')}>
          {
            !parameterRule.required && parameterRule.name !== 'stop' && (
              <div className="mr-2 w-7">
                <Switch
                  defaultValue={!isNullOrUndefined(value)}
                  onChange={handleSwitch}
                  size="md"
                />
              </div>
            )
          }
          <div
            className="system-xs-regular mr-0.5 truncate text-text-secondary"
            title={parameterRule.label[language] || parameterRule.label.en_US}
          >
            {parameterRule.label[language] || parameterRule.label.en_US}
          </div>
          {
            parameterRule.help && (
              <Tooltip
                popupContent={(
                  <div className="w-[150px] whitespace-pre-wrap">{parameterRule.help[language] || parameterRule.help.en_US}</div>
                )}
                popupClassName="mr-1"
                triggerClassName="mr-1 w-4 h-4 shrink-0"
              />
            )
          }
        </div>
        {
          parameterRule.type === 'tag' && (
            <div className={cn(!isInWorkflow && 'w-[150px]', 'system-xs-regular text-text-tertiary')}>
              {parameterRule?.tagPlaceholder?.[language]}
            </div>
          )
        }
      </div>
      {renderInput()}
    </div>
  )
}

export default ParameterItem
