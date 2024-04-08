'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import RemoveButton from '../remove-button'
import VarReferencePicker from './var-reference-picker'
import type { ValueSelector, Var, Variable } from '@/app/components/workflow/types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'

type Props = {
  nodeId: string
  readonly: boolean
  list: Variable[]
  onChange: (list: Variable[]) => void
  isSupportConstantValue?: boolean
  onlyLeafNodeVar?: boolean
  filterVar?: (payload: Var, valueSelector: ValueSelector) => boolean
}

const VarList: FC<Props> = ({
  nodeId,
  readonly,
  list,
  onChange,
  isSupportConstantValue,
  onlyLeafNodeVar,
  filterVar,
}) => {
  const { t } = useTranslation()

  const handleVarNameChange = useCallback((index: number) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const newList = produce(list, (draft) => {
        draft[index].variable = e.target.value
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleVarReferenceChange = useCallback((index: number) => {
    return (value: ValueSelector | string, varKindType: VarKindType) => {
      const newList = produce(list, (draft) => {
        if (!isSupportConstantValue || varKindType === VarKindType.variable) {
          draft[index].value_selector = value as ValueSelector
          if (isSupportConstantValue)
            draft[index].variable_type = VarKindType.variable

          if (!draft[index].variable)
            draft[index].variable = value[value.length - 1]
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

  return (
    <div className='space-y-2'>
      {list.map((item, index) => (
        <div className='flex items-center space-x-1' key={index}>
          <input
            readOnly={readonly}
            value={list[index].variable}
            onChange={handleVarNameChange(index)}
            placeholder={t('workflow.common.variableNamePlaceholder')!}
            className='w-[120px] h-8 leading-8 px-2.5 rounded-lg border-0 bg-gray-100  text-gray-900 text-[13px]  placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
            type='text'
          />
          <VarReferencePicker
            nodeId={nodeId}
            readonly={readonly}
            isShowNodeName
            className='grow'
            value={item.variable_type === VarKindType.constant ? (item.value || '') : (item.value_selector || [])}
            isSupportConstantValue={isSupportConstantValue}
            onChange={handleVarReferenceChange(index)}
            defaultVarKindType={item.variable_type}
            onlyLeafNodeVar={onlyLeafNodeVar}
            filterVar={filterVar}
          />
          {!readonly && (
            <RemoveButton
              className='!p-2 !bg-gray-100 hover:!bg-gray-200'
              onClick={handleVarRemove(index)}
            />
          )}
        </div>
      ))}
    </div>
  )
}
export default React.memo(VarList)
