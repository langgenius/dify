'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { produce } from 'immer'
import RemoveButton from '../remove-button'
import VarReferencePicker from './var-reference-picker'
import Input from '@/app/components/base/input'
import type { ValueSelector, Var, Variable } from '@/app/components/workflow/types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { checkKeys, replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'
import type { ToastHandle } from '@/app/components/base/toast'
import Toast from '@/app/components/base/toast'
import { ReactSortable } from 'react-sortablejs'
import { v4 as uuid4 } from 'uuid'
import { RiDraggable } from '@remixicon/react'
import cn from '@/utils/classnames'
import { useDebounceFn } from 'ahooks'

type Props = {
  nodeId: string
  readonly: boolean
  list: Variable[]
  onChange: (list: Variable[]) => void
  onVarNameChange?: (oldName: string, newName: string) => void
  isSupportConstantValue?: boolean
  onlyLeafNodeVar?: boolean
  filterVar?: (payload: Var, valueSelector: ValueSelector) => boolean
  isSupportFileVar?: boolean
}

const VarList: FC<Props> = ({
  nodeId,
  readonly,
  list,
  onChange,
  onVarNameChange,
  isSupportConstantValue,
  onlyLeafNodeVar,
  filterVar,
  isSupportFileVar = true,
}) => {
  const { t } = useTranslation()
  const [toastHandle, setToastHandle] = useState<ToastHandle>()

  const listWithIds = useMemo(() => list.map((item) => {
    const id = uuid4()
    return {
      id,
      variable: { ...item },
    }
  }), [list])

  const { run: validateVarInput } = useDebounceFn((list: Variable[], newKey: string) => {
    const { isValid, errorKey, errorMessageKey } = checkKeys([newKey], true)
    if (!isValid) {
      setToastHandle(Toast.notify({
        type: 'error',
        message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: errorKey }),
      }))
      return
    }
    if (list.some(item => item.variable?.trim() === newKey.trim())) {
      setToastHandle(Toast.notify({
        type: 'error',
        message: t('appDebug.varKeyError.keyAlreadyExists', { key: newKey }),
      }))
    }
    else {
      toastHandle?.clear?.()
    }
  }, { wait: 500 })

  const handleVarNameChange = useCallback((index: number) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      replaceSpaceWithUnderscoreInVarNameInput(e.target)

      const newKey = e.target.value

      toastHandle?.clear?.()
      validateVarInput(list.toSpliced(index, 1), newKey)

      onVarNameChange?.(list[index].variable, newKey)
      const newList = produce(list, (draft) => {
        draft[index].variable = newKey
      })
      onChange(newList)
    }
  }, [list, onVarNameChange, onChange, validateVarInput])

  const handleVarReferenceChange = useCallback((index: number) => {
    return (value: ValueSelector | string, varKindType: VarKindType, varInfo?: Var) => {
      const newList = produce(list, (draft) => {
        if (!isSupportConstantValue || varKindType === VarKindType.variable) {
          draft[index].value_selector = value as ValueSelector
          draft[index].value_type = varInfo?.type
          if (isSupportConstantValue)
            draft[index].variable_type = VarKindType.variable

          if (!draft[index].variable) {
            const variables = draft.map(v => v.variable)
            let newVarName = value[value.length - 1]
            let count = 1
            while (variables.includes(newVarName)) {
              newVarName = `${value[value.length - 1]}_${count}`
              count++
            }
            draft[index].variable = newVarName
          }
        }
        else {
          draft[index].variable_type = VarKindType.constant
          draft[index].value_selector = value as ValueSelector
          draft[index].value = value as string
        }
      })
      onChange(newList)
    }
  }, [isSupportConstantValue, list, onChange])

  const handleVarRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange])

  const varCount = list.length

  return (
    <ReactSortable
      className='space-y-2'
      list={listWithIds}
      setList={(list) => { onChange(list.map(item => item.variable)) }}
      handle='.handle'
      ghostClass='opacity-50'
      animation={150}
    >
      {list.map((variable, index) => {
        const canDrag = (() => {
          if (readonly)
            return false
          return varCount > 1
        })()
        return (
          <div className={cn('flex items-center space-x-1', 'group relative')} key={index}>
            <Input
              wrapperClassName='w-[120px]'
              disabled={readonly}
              value={variable.variable}
              onChange={handleVarNameChange(index)}
              placeholder={t('workflow.common.variableNamePlaceholder')!}
            />
            <VarReferencePicker
              nodeId={nodeId}
              readonly={readonly}
              isShowNodeName
              className='grow'
              value={variable.variable_type === VarKindType.constant ? (variable.value || '') : (variable.value_selector || [])}
              isSupportConstantValue={isSupportConstantValue}
              onChange={handleVarReferenceChange(index)}
              defaultVarKindType={variable.variable_type}
              onlyLeafNodeVar={onlyLeafNodeVar}
              filterVar={filterVar}
              isSupportFileVar={isSupportFileVar}
            />
            {!readonly && (
              <RemoveButton onClick={handleVarRemove(index)}/>
            )}
            {canDrag && <RiDraggable className={cn(
              'handle absolute -left-4 top-2.5 hidden h-3 w-3 cursor-pointer text-text-quaternary',
              'group-hover:block',
            )} />}
          </div>
        )
      })}
    </ReactSortable>
  )
}
export default React.memo(VarList)
