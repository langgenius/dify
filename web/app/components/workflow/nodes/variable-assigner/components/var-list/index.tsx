'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import React, { useCallback } from 'react'
import produce from 'immer'
import RemoveButton from '../../../_base/components/remove-button'
import ListNoDataPlaceholder from '../../../_base/components/list-no-data-placeholder'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'

type Props = {
  readonly: boolean
  nodeId: string
  list: ValueSelector[]
  onChange: (list: ValueSelector[], value?: ValueSelector) => void
  onOpen?: (index: number) => void
  filterVar?: (payload: Var, valueSelector: ValueSelector) => boolean
}

const VarList: FC<Props> = ({
  readonly,
  nodeId,
  list,
  onChange,
  onOpen = () => { },
  filterVar,
}) => {
  const { t } = useTranslation()
  const handleVarReferenceChange = useCallback((index: number) => {
    return (value: ValueSelector | string) => {
      const newList = produce(list, (draft) => {
        draft[index] = value as ValueSelector
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

  if (list.length === 0) {
    return (
      <ListNoDataPlaceholder>
        {t('workflow.nodes.variableAssigner.noVarTip')}
      </ListNoDataPlaceholder>
    )
  }

  return (
    <div className='space-y-2'>
      {list.map((item, index) => (
        <div className='flex items-center space-x-1' key={index}>
          <VarReferencePicker
            readonly={readonly}
            nodeId={nodeId}
            isShowNodeName
            className='grow'
            value={item}
            onChange={handleVarReferenceChange(index)}
            onOpen={handleOpen(index)}
            filterVar={filterVar}
            defaultVarKindType={VarKindType.variable}
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
