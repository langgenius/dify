import type { ModelParameterRule } from '../declarations'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import Radio from '@/app/components/base/radio'
import Switch from '@/app/components/base/switch'
import TagInput from '@/app/components/base/tag-input'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger, SelectValue } from '@/app/components/base/ui/select'
import { Slider } from '@/app/components/base/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { BlockEnum } from '@/app/components/workflow/types'
import { useLanguage } from '../hooks'
import { isNullOrUndefined } from '../utils'

export type ParameterValue = number | string | string[] | boolean | undefined

type ParameterItemProps = {
  parameterRule: ModelParameterRule
  value?: ParameterValue
  onChange?: (value: ParameterValue) => void
  onSwitch?: (checked: boolean, assignValue: ParameterValue) => void
  isInWorkflow?: boolean
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
}

function ParameterItem({
  parameterRule,
  value,
  onChange,
  onSwitch,
  isInWorkflow,
  nodesOutputVars,
  availableNodes = [],
}: ParameterItemProps) {
  const { t } = useTranslation()
  const language = useLanguage()
  const [localValue, setLocalValue] = useState(value)
  const numberInputRef = useRef<HTMLInputElement>(null)

  const workflowNodesMap = useMemo(() => {
    if (!isInWorkflow || !availableNodes.length)
      return undefined

    return availableNodes.reduce<Record<string, Pick<Node['data'], 'title' | 'type'>>>((acc, node) => {
      acc[node.id] = {
        title: node.data.title,
        type: node.data.type,
      }
      if (node.data.type === BlockEnum.Start) {
        acc.sys = {
          title: t('blocks.start', { ns: 'workflow' }),
          type: BlockEnum.Start,
        }
      }
      return acc
    }, {})
  }, [availableNodes, isInWorkflow, t])

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
  const sliderLabel = parameterRule.label[language] || parameterRule.label.en_US

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

  const handleTagChange = (newSequences: string[]) => {
    handleInputChange(newSequences)
  }

  const handleSwitch = (checked: boolean) => {
    if (onSwitch) {
      const assignValue: ParameterValue = localValue ?? getDefaultValue()

      onSwitch(checked, assignValue)
    }
  }

  useEffect(() => {
    if ((parameterRule.type === 'int' || parameterRule.type === 'float') && numberInputRef.current)
      numberInputRef.current.value = `${renderValue}`
  }, [value, parameterRule.type, renderValue])

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
              onValueChange={handleSlideChange}
              aria-label={sliderLabel}
            />
          )}
          <input
            ref={numberInputRef}
            className="ml-4 block h-8 w-16 shrink-0 appearance-none rounded-lg bg-components-input-bg-normal pl-3 system-sm-regular text-components-input-text-filled outline-hidden"
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
              onValueChange={handleSlideChange}
              aria-label={sliderLabel}
            />
          )}
          <input
            ref={numberInputRef}
            className="ml-4 block h-8 w-16 shrink-0 appearance-none rounded-lg bg-components-input-bg-normal pl-3 system-sm-regular text-components-input-text-filled outline-hidden"
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
      if (isInWorkflow && nodesOutputVars) {
        return (
          <div className="ml-4 w-[200px] rounded-lg bg-components-input-bg-normal px-2 py-1">
            <PromptEditor
              compact
              className="min-h-[22px] text-[13px]"
              value={renderValue as string}
              onChange={(text) => { handleInputChange(text) }}
              workflowVariableBlock={{
                show: true,
                variables: nodesOutputVars,
                workflowNodesMap,
              }}
              editable
            />
          </div>
        )
      }

      return (
        <input
          className={cn(isInWorkflow ? 'w-[150px]' : 'w-full', 'ml-4 flex h-8 appearance-none items-center rounded-lg bg-components-input-bg-normal px-3 system-sm-regular text-components-input-text-filled outline-hidden')}
          value={renderValue as string}
          onChange={handleStringInputChange}
        />
      )
    }

    if (parameterRule.type === 'text') {
      if (isInWorkflow && nodesOutputVars) {
        return (
          <div className="ml-4 w-full rounded-lg bg-components-input-bg-normal px-2 py-1">
            <PromptEditor
              compact
              className="min-h-[56px] text-[13px]"
              value={renderValue as string}
              onChange={(text) => { handleInputChange(text) }}
              workflowVariableBlock={{
                show: true,
                variables: nodesOutputVars,
                workflowNodesMap,
              }}
              editable
            />
          </div>
        )
      }

      return (
        <textarea
          className="ml-4 h-20 w-full rounded-lg bg-components-input-bg-normal px-1 system-sm-regular text-components-input-text-filled"
          value={renderValue as string}
          onChange={handleStringInputChange}
        />
      )
    }

    if (parameterRule.type === 'string' && !!parameterRule.options?.length) {
      return (
        <Select
          value={renderValue as string}
          onValueChange={v => handleInputChange(v ?? undefined)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {parameterRule.options!.map(option => (
              <SelectItem key={option} value={option}>
                <SelectItemText>{option}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (parameterRule.type === 'tag') {
      return (
        <div className={cn('h-8! w-full')}>
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
                  checked={!isNullOrUndefined(value)}
                  onCheckedChange={handleSwitch}
                  size="md"
                />
              </div>
            )
          }
          <div
            className="mr-0.5 truncate system-xs-regular text-text-secondary"
            title={sliderLabel}
          >
            {sliderLabel}
          </div>
          {
            parameterRule.help && (
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <span className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center">
                      <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary" />
                    </span>
                  )}
                />
                <TooltipContent className="mr-1">
                  <div className="w-[150px] whitespace-pre-wrap">{parameterRule.help[language] || parameterRule.help.en_US}</div>
                </TooltipContent>
              </Tooltip>
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
