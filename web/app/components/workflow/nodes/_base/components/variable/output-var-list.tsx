'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import type { OutputVar } from '../../../code/types'
import RemoveButton from '../remove-button'
import VarTypePicker from './var-type-picker'
import type { VarType } from '@/app/components/workflow/types'
import { checkKeys } from '@/utils/var'
import Toast from '@/app/components/base/toast'

type Props = {
  readonly: boolean
  outputs: OutputVar
  outputKeyOrders: string[]
  onOutputKeyOrdersChange?: (newOutputKeyOrders: string[]) => void
  onChange: (payload: OutputVar, changedIndex?: number, newKey?: string) => void
  onRemove: (index: number) => void
}

const OutputVarList: FC<Props> = ({
  readonly,
  outputs,
  outputKeyOrders,
  onChange,
  onRemove,
}) => {
  const { t } = useTranslation()
  const [list, setList] = useState<{ variable: string; variable_type: VarType }[]>([])

  useEffect(() => {
    const l = outputKeyOrders.map((key) => {
      return {
        variable: key,
        variable_type: outputs[key]?.type,
      }
    })
    setList(l)
  }, [outputKeyOrders, outputs])

  const handleVarNameChange = useCallback((index: number) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const newKey = e.target.value
      const newList = list.map((o, i) => {
        return i === index ? { ...o, variable: newKey } : o
      })
      setList(newList)
    }
  }, [list])

  const handleVarNameBlur = useCallback((index: number) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const oldKey = outputKeyOrders[index]
      const newKey = e.target.value

      if (oldKey === newKey)
        return

      const { isValid, errorKey, errorMessageKey } = checkKeys([newKey], true)
      if (!isValid) {
        Toast.notify({
          type: 'error',
          message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: errorKey }),
        })
        // reset list, when not isValid
        const l = list.map((o, i) => {
          return i === index
            ? { ...o, variable: oldKey }
            : o
        })
        setList(l)
        return
      }

      if (list.filter((_, i) => i !== index).map(item => item.variable?.trim()).includes(newKey.trim())) {
        Toast.notify({
          type: 'error',
          message: t('appDebug.varKeyError.keyAlreadyExists', { key: newKey }),
        })
        // reset list, when keyAlreadyExists
        const l = list.map((o, i) => {
          return i === index
            ? { ...o, variable: oldKey }
            : o
        })
        setList(l)
        return
      }

      const newOutputs = produce(outputs, (draft) => {
        draft[newKey] = draft[oldKey]
        delete draft[oldKey]
      })
      onChange(newOutputs, index, newKey)
    }
  }, [onChange, outputs, outputKeyOrders, list, t])

  const handleVarTypeChange = useCallback((index: number) => {
    return (value: string) => {
      const key = outputKeyOrders[index]
      const newOutputs = produce(outputs, (draft) => {
        draft[key].type = value as VarType
      })
      onChange(newOutputs)
    }
  }, [onChange, outputs, outputKeyOrders])

  const handleVarRemove = useCallback((index: number) => {
    return () => {
      onRemove(index)
    }
  }, [onRemove])

  return (
    <div className='space-y-2'>
      {list.map((item, index) => (
        <div className='flex items-center space-x-1' key={index}>
          <input
            readOnly={readonly}
            value={item.variable}
            onChange={handleVarNameChange(index)}
            onBlur={handleVarNameBlur(index)}
            className='w-0 grow h-8 leading-8 px-2.5 rounded-lg border-0 bg-gray-100  text-gray-900 text-[13px] placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
            type='text' />
          <VarTypePicker
            readonly={readonly}
            value={item.variable_type}
            onChange={handleVarTypeChange(index)}
          />
          <RemoveButton
            className='!p-2 !bg-gray-100 hover:!bg-gray-200'
            onClick={handleVarRemove(index)}
          />
        </div>
      ))}
    </div>
  )
}
export default React.memo(OutputVarList)
