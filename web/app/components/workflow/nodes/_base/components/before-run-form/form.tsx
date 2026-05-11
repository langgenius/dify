'use client'
import type { FC } from 'react'
import type { InputVar } from '../../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { RETRIEVAL_OUTPUT_STRUCT } from '@/app/components/workflow/constants'
import { InputVarType } from '@/app/components/workflow/types'
import FormItem from './form-item'

export type Props = {
  className?: string
  label?: string
  inputs: InputVar[]
  values: Record<string, string>
  onChange: (newValues: Record<string, any>) => void
}

const Form: FC<Props> = ({
  className,
  label,
  inputs,
  values,
  onChange,
}) => {
  const { t } = useTranslation()
  const mapKeysWithSameValueSelector = useMemo(() => {
    const keysWithSameValueSelector = (key: string) => {
      const targetValueSelector = inputs.find(
        item => item.variable === key,
      )?.value_selector
      if (!targetValueSelector)
        return [key]

      const result: string[] = []
      inputs.forEach((item) => {
        if (item.value_selector?.join('.') === targetValueSelector.join('.'))
          result.push(item.variable)
      })
      return result
    }

    const m = new Map()
    for (const input of inputs)
      m.set(input.variable, keysWithSameValueSelector(input.variable))

    return m
  }, [inputs])
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  }, [values])
  const handleChange = useCallback((key: string) => {
    const mKeys = mapKeysWithSameValueSelector.get(key) ?? [key]
    return (value: any) => {
      const newValues = produce(valuesRef.current, (draft) => {
        for (const k of mKeys)
          draft[k] = value
      })
      onChange(newValues)
    }
  }, [valuesRef, onChange, mapKeysWithSameValueSelector])
  const isArrayLikeType = [InputVarType.contexts, InputVarType.iterator].includes(inputs[0]?.type!)
  const isIteratorItemFile = inputs[0]?.type === InputVarType.iterator && inputs[0]?.isFileItem

  const isContext = inputs[0]?.type === InputVarType.contexts
  const handleAddContext = useCallback(() => {
    const newValues = produce(values, (draft: any) => {
      const key = inputs[0]!.variable
      if (!draft[key])
        draft[key] = []
      draft[key].push(isContext ? RETRIEVAL_OUTPUT_STRUCT : '')
    })
    onChange(newValues)
  }, [values, onChange, inputs, isContext])

  return (
    <div className={cn(className, 'space-y-2')}>
      {label && (
        <div className="mb-1 flex items-center justify-between">
          <div className="flex h-6 items-center system-xs-medium-uppercase text-text-tertiary">{label}</div>
          {isArrayLikeType && !isIteratorItemFile && (
            <button
              type="button"
              aria-label={`${t('operation.add', { ns: 'common' })} ${label}`}
              className="cursor-pointer rounded-md border-none bg-transparent p-1 select-none hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              onClick={handleAddContext}
            >
              <span className="i-ri-add-line h-4 w-4 text-text-tertiary" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {inputs.map((input, index) => {
        return (
          <FormItem
            inStepRun
            key={index}
            payload={input}
            value={values[input.variable]}
            onChange={handleChange(input.variable)}
          />
        )
      })}
    </div>
  )
}
export default React.memo(Form)
