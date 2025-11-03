'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { produce } from 'immer'
import type { InputVar } from '../../../../types'
import FormItem from './form-item'
import cn from '@/utils/classnames'
import { InputVarType } from '@/app/components/workflow/types'
import AddButton from '@/app/components/base/button/add-button'
import { RETRIEVAL_OUTPUT_STRUCT } from '@/app/components/workflow/constants'

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
  const isArrayLikeType = [InputVarType.contexts, InputVarType.iterator].includes(inputs[0]?.type)
  const isIteratorItemFile = inputs[0]?.type === InputVarType.iterator && inputs[0]?.isFileItem

  const isContext = inputs[0]?.type === InputVarType.contexts
  const handleAddContext = useCallback(() => {
    const newValues = produce(values, (draft: any) => {
      const key = inputs[0].variable
      if (!draft[key])
        draft[key] = []
      draft[key].push(isContext ? RETRIEVAL_OUTPUT_STRUCT : '')
    })
    onChange(newValues)
  }, [values, onChange, inputs, isContext])

  return (
    <div className={cn(className, 'space-y-2')}>
      {label && (
        <div className='mb-1 flex items-center justify-between'>
          <div className='system-xs-medium-uppercase flex h-6 items-center text-text-tertiary'>{label}</div>
          {isArrayLikeType && !isIteratorItemFile && (
            <AddButton onClick={handleAddContext} />
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
