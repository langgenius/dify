'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import { produce } from 'immer'
import { useTranslation } from 'react-i18next'
import VarItem from './var-item'
import { ChangeType, type InputVar, type MoreInfo } from '@/app/components/workflow/types'
import { ReactSortable } from 'react-sortablejs'
import { RiDraggable } from '@remixicon/react'
import cn from '@/utils/classnames'
import { hasDuplicateStr } from '@/utils/var'
import Toast from '@/app/components/base/toast'

type Props = {
  readonly: boolean
  list: InputVar[]
  onChange: (list: InputVar[], moreInfo?: { index: number; payload: MoreInfo }) => void
}

const VarList: FC<Props> = ({
  readonly,
  list,
  onChange,
}) => {
  const { t } = useTranslation()

  const handleVarChange = useCallback((index: number) => {
    return (payload: InputVar, moreInfo?: MoreInfo) => {
      const newList = produce(list, (draft) => {
        draft[index] = payload
      })
      let errorMsgKey = ''
      let typeName = ''
      if (hasDuplicateStr(newList.map(item => item.variable))) {
        errorMsgKey = 'appDebug.varKeyError.keyAlreadyExists'
        typeName = 'appDebug.variableConfig.varName'
      }
      else if (hasDuplicateStr(newList.map(item => item.label as string))) {
        errorMsgKey = 'appDebug.varKeyError.keyAlreadyExists'
        typeName = 'appDebug.variableConfig.labelName'
      }

      if (errorMsgKey) {
        Toast.notify({
          type: 'error',
          message: t(errorMsgKey, { key: t(typeName) }),
        })
        return false
      }
      onChange(newList, moreInfo ? { index, payload: moreInfo } : undefined)
      return true
    }
  }, [list, onChange])

  const handleVarRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList, {
        index,
        payload: {
          type: ChangeType.remove,
          payload: {
            beforeKey: list[index].variable,
          },
        },
      })
    }
  }, [list, onChange])

  const listWithIds = useMemo(() => list.map((item) => {
    return {
      id: item.variable,
      variable: { ...item },
    }
  }), [list])

  const varCount = list.length

  if (list.length === 0) {
    return (
      <div className='flex h-[42px] items-center justify-center rounded-md bg-components-panel-bg text-xs font-normal leading-[18px] text-text-tertiary'>
        {t('workflow.nodes.start.noVarTip')}
      </div>
    )
  }

  const canDrag = !readonly && varCount > 1

  return (
    <ReactSortable
      className='space-y-1'
      list={listWithIds}
      setList={(list) => { onChange(list.map(item => item.variable)) }}
      handle='.handle'
      ghostClass='opacity-50'
      animation={150}
    >
      {listWithIds.map((itemWithId, index) => (
        <div key={itemWithId.id} className='group relative'>
          <VarItem
            className={cn(canDrag && 'handle')}
            readonly={readonly}
            payload={itemWithId.variable}
            onChange={handleVarChange(index)}
            onRemove={handleVarRemove(index)}
            varKeys={list.map(item => item.variable)}
            canDrag={canDrag}
          />
          {canDrag && <RiDraggable className={cn(
            'handle absolute left-3 top-2.5 hidden h-3 w-3 cursor-pointer text-text-tertiary',
            'group-hover:block',
          )} />}
        </div>
      ))}
    </ReactSortable>
  )
}
export default React.memo(VarList)
