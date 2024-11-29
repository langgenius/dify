'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import React, { useCallback } from 'react'
import produce from 'immer'
import { RiDeleteBinLine } from '@remixicon/react'
import OperationSelector from '../operation-selector'
import { AssignerNodeInputType, WriteMode } from '../../types'
import type { AssignerNodeOperation } from '../../types'
import ListNoDataPlaceholder from '@/app/components/workflow/nodes/_base/components/list-no-data-placeholder'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import type { ValueSelector, Var, VarType } from '@/app/components/workflow/types'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import ActionButton from '@/app/components/base/action-button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'

type Props = {
  readonly: boolean
  nodeId: string
  list: AssignerNodeOperation[]
  onChange: (list: AssignerNodeOperation[], value?: ValueSelector) => void
  onOpen?: (index: number) => void
  filterVar?: (payload: Var, valueSelector: ValueSelector) => boolean
  filterToAssignedVar?: (payload: Var, assignedVarType: VarType, write_mode: WriteMode) => boolean
  getAssignedVarType?: (valueSelector: ValueSelector) => VarType
  getToAssignedVarType?: (assignedVarType: VarType, write_mode: WriteMode) => VarType
  writeModeTypes?: WriteMode[]
  writeModeTypesArr?: WriteMode[]
  writeModeTypesNum?: WriteMode[]
}

const VarList: FC<Props> = ({
  readonly,
  nodeId,
  list,
  onChange,
  onOpen = () => { },
  filterVar,
  filterToAssignedVar,
  getAssignedVarType,
  getToAssignedVarType,
  writeModeTypes,
  writeModeTypesArr,
  writeModeTypesNum,
}) => {
  const { t } = useTranslation()
  const handleAssignedVarChange = useCallback((index: number) => {
    return (value: ValueSelector | string) => {
      const newList = produce(list, (draft) => {
        draft[index].variable_selector = value as ValueSelector
        draft[index].operation = WriteMode.overwrite
        draft[index].value = undefined
      })
      onChange(newList, value as ValueSelector)
    }
  }, [list, onChange])

  const handleOperationChange = useCallback((index: number) => {
    return (item: { value: string | number }) => {
      const newList = produce(list, (draft) => {
        draft[index].operation = item.value as WriteMode
        draft[index].value = '' // Clear value when operation changes
        if (item.value === WriteMode.set || item.value === WriteMode.increment || item.value === WriteMode.decrement
          || item.value === WriteMode.multiply || item.value === WriteMode.divide)
          draft[index].input_type = AssignerNodeInputType.constant
        else
          draft[index].input_type = AssignerNodeInputType.variable
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleToAssignedVarChange = useCallback((index: number) => {
    return (value: ValueSelector | string | number) => {
      const newList = produce(list, (draft) => {
        draft[index].value = value as ValueSelector
      })
      onChange(newList, value as ValueSelector)
    }
  }, [list, onChange])

  const handleVarRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleOpen = useCallback((index: number) => {
    return () => onOpen(index)
  }, [onOpen])

  const handleFilterToAssignedVar = useCallback((index: number) => {
    return (payload: Var, valueSelector: ValueSelector) => {
      const item = list[index]
      const assignedVarType = item.variable_selector ? getAssignedVarType?.(item.variable_selector) : undefined

      if (!filterToAssignedVar || !item.variable_selector || !assignedVarType || !item.operation)
        return true

      return filterToAssignedVar(
        payload,
        assignedVarType,
        item.operation,
      )
    }
  }, [list, filterToAssignedVar, getAssignedVarType])

  if (list.length === 0) {
    return (
      <ListNoDataPlaceholder>
        {t('workflow.nodes.assigner.noVarTip')}
      </ListNoDataPlaceholder>
    )
  }

  return (
    <div className='flex flex-col items-start gap-4 self-stretch'>
      {list.map((item, index) => {
        const assignedVarType = item.variable_selector ? getAssignedVarType?.(item.variable_selector) : undefined
        const toAssignedVarType = (assignedVarType && item.operation && getToAssignedVarType)
          ? getToAssignedVarType(assignedVarType, item.operation)
          : undefined

        return (
          <div className='flex items-start gap-1 self-stretch' key={index}>
            <div className='flex flex-col items-start gap-1 flex-grow'>
              <div className='flex items-center gap-1 self-stretch'>
                <VarReferencePicker
                  readonly={readonly}
                  nodeId={nodeId}
                  isShowNodeName
                  value={item.variable_selector || []}
                  onChange={handleAssignedVarChange(index)}
                  onOpen={handleOpen(index)}
                  filterVar={filterVar}
                  placeholder={t('workflow.nodes.assigner.selectAssignedVariable') as string}
                  minWidth={352}
                  popupFor='assigned'
                  className='w-full'
                />
                <OperationSelector
                  value={item.operation}
                  placeholder='Operation'
                  disabled={!item.variable_selector || item.variable_selector.length === 0}
                  onSelect={handleOperationChange(index)}
                  assignedVarType={assignedVarType}
                  writeModeTypes={writeModeTypes}
                  writeModeTypesArr={writeModeTypesArr}
                  writeModeTypesNum={writeModeTypesNum}
                />
              </div>
              {item.operation !== WriteMode.clear && item.operation !== WriteMode.set
                && !writeModeTypesNum?.includes(item.operation)
                && (
                  <VarReferencePicker
                    readonly={readonly || !item.variable_selector || !item.operation}
                    nodeId={nodeId}
                    isShowNodeName
                    value={item.value}
                    onChange={handleToAssignedVarChange(index)}
                    filterVar={handleFilterToAssignedVar(index)}
                    valueTypePlaceHolder={toAssignedVarType}
                    placeholder={t('workflow.nodes.assigner.setParameter') as string}
                    minWidth={352}
                    popupFor='toAssigned'
                    className='w-full'
                  />
                )
              }
              {item.operation === WriteMode.set && assignedVarType && (
                <>
                  {assignedVarType === 'number' && (
                    <Input
                      type="number"
                      value={item.value as number}
                      onChange={e => handleToAssignedVarChange(index)(Number(e.target.value))}
                      className='w-full'
                    />
                  )}
                  {assignedVarType === 'string' && (
                    <Textarea
                      value={item.value as string}
                      onChange={e => handleToAssignedVarChange(index)(e.target.value)}
                      className='w-full'
                    />
                  )}
                  {assignedVarType === 'object' && (
                    <CodeEditor
                      value={item.value as string}
                      language={CodeLanguage.json}
                      onChange={value => handleToAssignedVarChange(index)(value)}
                      className='w-full'
                      readOnly={readonly}
                    />
                  )}
                </>
              )}
              {writeModeTypesNum?.includes(item.operation)
                && <Input
                  type="number"
                  value={item.value as number}
                  onChange={e => handleToAssignedVarChange(index)(Number(e.target.value))}
                  placeholder="Enter number value..."
                  className='w-full'
                />
              }
            </div>
            <ActionButton
              size='l'
              className='flex-shrink-0 group hover:!bg-state-destructive-hover'
              onClick={handleVarRemove(index)}
            >
              <RiDeleteBinLine className='text-text-tertiary w-4 h-4 group-hover:text-text-destructive' />
            </ActionButton>
          </div>
        )
      },
      )}
    </div>
  )
}
export default React.memo(VarList)
