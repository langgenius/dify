'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { produce } from 'immer'
import { useTranslation } from 'react-i18next'
import type { OutputVar } from '../../../code/types'
import RemoveButton from '../remove-button'
import VarTypePicker from './var-type-picker'
import Input from '@/app/components/base/input'
import type { VarType } from '@/app/components/workflow/types'
import { checkKeys, replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'
import type { ToastHandle } from '@/app/components/base/toast'
import Toast from '@/app/components/base/toast'
import { useDebounceFn } from 'ahooks'

type Props = {
  readonly: boolean
  outputs: OutputVar
  outputKeyOrders: string[]
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
  const [toastHandler, setToastHandler] = useState<ToastHandle>()

  const list = outputKeyOrders.map((key) => {
    return {
      variable: key,
      variable_type: outputs[key]?.type,
    }
  })

  const { run: validateVarInput } = useDebounceFn((existingVariables: typeof list, newKey: string) => {
    const { isValid, errorKey, errorMessageKey } = checkKeys([newKey], true)
    if (!isValid) {
      setToastHandler(Toast.notify({
        type: 'error',
        message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: errorKey }),
      }))
      return
    }
    if (existingVariables.some(key => key.variable?.trim() === newKey.trim())) {
      setToastHandler(Toast.notify({
        type: 'error',
        message: t('appDebug.varKeyError.keyAlreadyExists', { key: newKey }),
      }))
    }
    else {
      toastHandler?.clear?.()
    }
  }, { wait: 500 })

  const handleVarNameChange = useCallback((index: number) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const oldKey = list[index].variable

      replaceSpaceWithUnderscoreInVarNameInput(e.target)
      const newKey = e.target.value

      toastHandler?.clear?.()
      validateVarInput(list.toSpliced(index, 1), newKey)

      const newOutputs = produce(outputs, (draft) => {
        draft[newKey] = draft[oldKey]
        delete draft[oldKey]
      })
      onChange(newOutputs, index, newKey)
    }
  }, [list, onChange, outputs, outputKeyOrders, validateVarInput])

  const handleVarTypeChange = useCallback((index: number) => {
    return (value: string) => {
      const key = list[index].variable
      const newOutputs = produce(outputs, (draft) => {
        draft[key].type = value as VarType
      })
      onChange(newOutputs)
    }
  }, [list, onChange, outputs, outputKeyOrders])

  const handleVarRemove = useCallback((index: number) => {
    return () => {
      onRemove(index)
    }
  }, [onRemove])

  return (
    <div className='space-y-2'>
      {list.map((item, index) => (
        <div className='flex items-center space-x-1' key={index}>
          <Input
            readOnly={readonly}
            value={item.variable}
            onChange={handleVarNameChange(index)}
            wrapperClassName='grow'
          />
          <VarTypePicker
            readonly={readonly}
            value={item.variable_type}
            onChange={handleVarTypeChange(index)}
          />
          <RemoveButton
            className='!bg-gray-100 !p-2 hover:!bg-gray-200'
            onClick={handleVarRemove(index)}
          />
        </div>
      ))}
    </div>
  )
}
export default React.memo(OutputVarList)
