'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import React, { useCallback, useMemo } from 'react'
import produce from 'immer'
import RemoveButton from '../../../_base/components/remove-button'
import ListNoDataPlaceholder from '../../../_base/components/list-no-data-placeholder'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { noop } from 'lodash-es'
import { ReactSortable } from 'react-sortablejs'
import { v4 as uuid4 } from 'uuid'
import { RiDraggable } from '@remixicon/react'
import cn from '@/utils/classnames'

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
  onOpen = noop,
  filterVar,
}) => {
  const { t } = useTranslation()

  const listWithIds = useMemo(() => list.map((item) => {
    const id = uuid4()
    return {
      id,
      item,
    }
  }), [list])

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

  const varCount = list.length

  return (
    <ReactSortable
      className='space-y-2'
      list={listWithIds}
      setList={(newList) => { onChange(newList.map(item => item.item)) }}
      handle='.handle'
      ghostClass='opacity-50'
      animation={150}
      disabled={readonly}
    >
      {list.map((item, index) => {
        const canDrag = (() => {
          if (readonly)
            return false
          return varCount > 1
        })()
        return (
          <div className={cn('flex items-center space-x-1', 'group/var-item relative')} key={index}>
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
                onClick={handleVarRemove(index)}
              />
            )}
            {canDrag && <RiDraggable className={cn(
              'handle absolute -left-4 top-2.5 hidden h-3 w-3 cursor-pointer text-text-quaternary',
              'group-hover/var-item:block',
            )} />}
          </div>
        )
      })}
    </ReactSortable>
  )
}
export default React.memo(VarList)
