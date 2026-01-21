'use client'
import type { FC } from 'react'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import { RiDraggable } from '@remixicon/react'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import Toast from '@/app/components/base/toast'
import { ChangeType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import { hasDuplicateStr } from '@/utils/var'
import VarItem from './var-item'

type Props = {
  readonly: boolean
  list: InputVar[]
  onChange: (list: InputVar[], moreInfo?: { index: number, payload: MoreInfo }) => void
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
      let errorMsgKey: 'varKeyError.keyAlreadyExists' | '' = ''
      let typeName: 'variableConfig.varName' | 'variableConfig.labelName' | '' = ''
      if (hasDuplicateStr(newList.map(item => item.variable))) {
        errorMsgKey = 'varKeyError.keyAlreadyExists'
        typeName = 'variableConfig.varName'
      }
      else if (hasDuplicateStr(newList.map(item => item.label as string))) {
        errorMsgKey = 'varKeyError.keyAlreadyExists'
        typeName = 'variableConfig.labelName'
      }

      if (errorMsgKey && typeName) {
        Toast.notify({
          type: 'error',
          message: t(errorMsgKey, { ns: 'appDebug', key: t(typeName, { ns: 'appDebug' }) }),
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
      <div className="flex h-[42px] items-center justify-center rounded-md bg-components-panel-bg text-xs font-normal leading-[18px] text-text-tertiary">
        {t('nodes.start.noVarTip', { ns: 'workflow' })}
      </div>
    )
  }

  const canDrag = !readonly && varCount > 1

  return (
    <ReactSortable
      className="space-y-1"
      list={listWithIds}
      setList={(list) => { onChange(list.map(item => item.variable)) }}
      handle=".handle"
      ghostClass="opacity-50"
      animation={150}
    >
      {listWithIds.map((itemWithId, index) => (
        <div key={itemWithId.id} className="group relative">
          <VarItem
            className={cn(canDrag && 'handle')}
            readonly={readonly}
            payload={itemWithId.variable}
            onChange={handleVarChange(index)}
            onRemove={handleVarRemove(index)}
            varKeys={list.map(item => item.variable)}
            canDrag={canDrag}
          />
          {canDrag && (
            <RiDraggable className={cn(
              'handle absolute left-3 top-2.5 hidden h-3 w-3 cursor-pointer text-text-tertiary',
              'group-hover:block',
            )}
            />
          )}
        </div>
      ))}
    </ReactSortable>
  )
}
export default React.memo(VarList)
