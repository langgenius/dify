'use client'
import React, { useCallback } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type { VarGroupItem as VarGroupItemType } from '../types'
import VarReferencePicker from '../../_base/components/variable/var-reference-picker'
import VarList from '../components/var-list'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { VarType } from '@/app/components/workflow/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'

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
}

const VarGroupItem: FC<Props> = ({
  readOnly,
  nodeId,
  payload,
  onChange,
  groupEnabled,
  onGroupNameChange,
}) => {
  const { t } = useTranslation()

  const handleAddVariable = useCallback((value: ValueSelector | string, _varKindType: VarKindType, varInfo?: Var) => {
    const newPayload = produce(payload, (draft: Payload) => {
      draft.variables.push(value as ValueSelector)
      if (varInfo && varInfo.type !== VarType.any)
        draft.output_type = varInfo.type
    })
    onChange(newPayload)
  }, [onChange, payload])

  const handleListChange = useCallback((newList: ValueSelector[]) => {
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
  return (
    <Field
      title={groupEnabled ? payload.group_name! : t(`${i18nPrefix}.title`)}
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
