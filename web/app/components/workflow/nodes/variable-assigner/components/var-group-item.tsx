'use client'
import React, { useCallback } from 'react'
import type { ChangeEvent, FC } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import type { VarGroupItem as VarGroupItemType } from '../types'
import VarReferencePicker from '../../_base/components/variable/var-reference-picker'
import VarList from '../components/var-list'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { VarType } from '@/app/components/workflow/types'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { Folder } from '@/app/components/base/icons/src/vender/line/files'
import { checkKeys } from '@/utils/var'
import Toast from '@/app/components/base/toast'

const i18nPrefix = 'workflow.nodes.variableAssigner'

type Payload = VarGroupItemType & {
  group_name?: string
}

type Props = {
  readOnly: boolean
  nodeId: string
  payload: Payload
  onChange: (newPayload: Payload) => void
  groupEnabled: boolean
  onGroupNameChange?: (value: string) => void
  canRemove?: boolean
  onRemove?: () => void
  availableVars: NodeOutPutVar[]
}

const VarGroupItem: FC<Props> = ({
  readOnly,
  nodeId,
  payload,
  onChange,
  groupEnabled,
  onGroupNameChange,
  canRemove,
  onRemove,
  availableVars,
}) => {
  const { t } = useTranslation()

  const handleAddVariable = useCallback((value: ValueSelector | string, _varKindType: VarKindType, varInfo?: Var) => {
    const chosenVariables = payload.variables
    if (chosenVariables.some(item => item.join('.') === (value as ValueSelector).join('.')))
      return

    const newPayload = produce(payload, (draft: Payload) => {
      draft.variables.push(value as ValueSelector)
      if (varInfo && varInfo.type !== VarType.any)
        draft.output_type = varInfo.type
    })
    onChange(newPayload)
  }, [onChange, payload])

  const handleListChange = useCallback((newList: ValueSelector[], changedItem?: ValueSelector) => {
    if (changedItem) {
      const chosenVariables = payload.variables
      if (chosenVariables.some(item => item.join('.') === (changedItem as ValueSelector).join('.')))
        return
    }

    const newPayload = produce(payload, (draft) => {
      draft.variables = newList
      if (newList.length === 0)
        draft.output_type = VarType.any
    })
    onChange(newPayload)
  }, [onChange, payload])

  const filterVar = useCallback((varPayload: Var) => {
    if (payload.output_type === VarType.any)
      return true
    return varPayload.type === payload.output_type
  }, [payload.output_type])

  const [isEditGroupName, {
    setTrue: setEditGroupName,
    setFalse: setNotEditGroupName,
  }] = useBoolean(false)

  const handleGroupNameChange = useCallback((e: ChangeEvent<any>) => {
    const value = e.target.value
    const { isValid, errorKey, errorMessageKey } = checkKeys([value], false)
    if (!isValid) {
      Toast.notify({
        type: 'error',
        message: t(`appDebug.varKeyError.${errorMessageKey}`, { key: errorKey }),
      })
      return
    }
    onGroupNameChange?.(value)
  }, [onGroupNameChange, t])

  return (
    <Field
      className='group'
      title={groupEnabled
        ? <div className='flex items-center'>
          <div className='flex items-center !normal-case'>
            <Folder className='mr-0.5 w-3.5 h-3.5' />
            {(!isEditGroupName)
              ? (
                <div className='flex items-center h-6 px-1 rounded-lg cursor-text hover:bg-gray-100' onClick={setEditGroupName}>
                  {payload.group_name}
                </div>
              )
              : (
                <input
                  type='text'
                  className='h-6 px-1 rounded-lg bg-white border border-gray-300 focus:outline-none'
                  // style={{
                  //   width: `${((payload.group_name?.length || 0) + 1) / 2}em`,
                  // }}
                  size={payload.group_name?.length} // to fit the input width
                  autoFocus
                  value={payload.group_name}
                  onChange={handleGroupNameChange}
                  onBlur={setNotEditGroupName}
                  maxLength={30}
                />)}

          </div>
          {canRemove && (
            <div
              className='group-hover:block hidden ml-0.5 p-1 rounded-md text-gray-500 cursor-pointer hover:bg-[#FEE4E2] hover:text-[#D92D20]'
              onClick={onRemove}
            >
              <RiDeleteBinLine
                className='w-4 h-4'
              />
            </div>
          )}
        </div>
        : t(`${i18nPrefix}.title`)!}
      operations={
        <div className='flex items-center h-6  space-x-2'>
          {payload.variables.length > 0 && (
            <div className='flex items-center h-[18px] px-1 border border-black/8 rounded-[5px] text-xs font-medium text-gray-500 capitalize'>{payload.output_type}</div>
          )}
          {
            !readOnly
              ? <VarReferencePicker
                isAddBtnTrigger
                readonly={false}
                nodeId={nodeId}
                isShowNodeName
                value={[]}
                onChange={handleAddVariable}
                defaultVarKindType={VarKindType.variable}
                filterVar={filterVar}
                availableVars={availableVars}
              />
              : undefined
          }
        </div>
      }
    >
      <VarList
        readonly={readOnly}
        nodeId={nodeId}
        list={payload.variables}
        onChange={handleListChange}
        filterVar={filterVar}
      />
    </Field>
  )
}
export default React.memo(VarGroupItem)
