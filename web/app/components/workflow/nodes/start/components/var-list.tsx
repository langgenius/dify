'use client'
import type { FC } from 'react'
import type { InputVar, MoreInfo } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { useKeyboardSortable } from '@/app/components/base/keyboard-sortable/use-keyboard-sortable'
import { ChangeType } from '@/app/components/workflow/types'
import { hasDuplicateStr } from '@/utils/var'
import VarItem from './var-item'

type Props = Readonly<{
  readonly: boolean
  list: InputVar[]
  onChange: (list: InputVar[], moreInfo?: { index: number; payload: MoreInfo }) => void
}>

const VarList: FC<Props> = ({ readonly, list, onChange }) => {
  const { t } = useTranslation()

  const handleVarChange = useCallback(
    (index: number) => {
      return (payload: InputVar, moreInfo?: MoreInfo) => {
        const newList = produce(list, (draft) => {
          draft[index] = payload
        })
        let errorMsgKey: 'varKeyError.keyAlreadyExists' | '' = ''
        let typeName: 'variableConfig.varName' | 'variableConfig.labelName' | '' = ''
        if (hasDuplicateStr(newList.map((item) => item.variable))) {
          errorMsgKey = 'varKeyError.keyAlreadyExists'
          typeName = 'variableConfig.varName'
        } else if (hasDuplicateStr(newList.map((item) => item.label as string))) {
          errorMsgKey = 'varKeyError.keyAlreadyExists'
          typeName = 'variableConfig.labelName'
        }

        if (errorMsgKey && typeName) {
          toast.error(
            t(($) => $[errorMsgKey], {
              ns: 'appDebug',
              key: t(($) => $[typeName], { ns: 'appDebug' }),
            }),
          )
          return false
        }
        onChange(newList, moreInfo ? { index, payload: moreInfo } : undefined)
        return true
      }
    },
    [list, onChange],
  )

  const handleVarRemove = useCallback(
    (index: number) => {
      return () => {
        const newList = produce(list, (draft) => {
          draft.splice(index, 1)
        })
        onChange(newList, {
          index,
          payload: {
            type: ChangeType.remove,
            payload: {
              beforeKey: list[index]!.variable,
            },
          },
        })
      }
    },
    [list, onChange],
  )

  const keyboardSort = useKeyboardSortable({
    items: list,
    onChange,
    disabled: readonly,
    getItemLabel: (item) => item.variable,
  })

  const listWithIds = useMemo(
    () =>
      keyboardSort.items.map((item) => ({
        id: item.variable,
        variable: { ...item },
      })),
    [keyboardSort.items],
  )

  const varCount = list.length

  if (list.length === 0) {
    return (
      <div className="flex h-10.5 items-center justify-center rounded-md bg-components-panel-bg text-xs leading-4.5 font-normal text-text-tertiary">
        {t(($) => $['nodes.start.noVarTip'], { ns: 'workflow' })}
      </div>
    )
  }

  const canDrag = !readonly && varCount > 1

  return (
    <>
      {keyboardSort.announcement}
      <ReactSortable
        className="space-y-1"
        list={listWithIds}
        disabled={readonly || keyboardSort.isSorting}
        setList={(list) => {
          if (
            keyboardSort.isSorting ||
            list.every((item, index) => item.id === listWithIds[index]?.id)
          )
            return
          onChange(list.map((item) => item.variable))
        }}
        handle=".handle"
        ghostClass="opacity-50"
        animation={150}
      >
        {listWithIds.map((itemWithId, index) => (
          <div key={itemWithId.id} className="group relative">
            {canDrag && (
              <IconButton
                {...keyboardSort.getHandleProps(index)}
                className="handle pointer-events-none absolute top-1 left-1.5 size-6 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100 aria-pressed:pointer-events-auto aria-pressed:opacity-100"
              >
                <span aria-hidden="true" className="i-ri-draggable size-3" />
              </IconButton>
            )}
            <VarItem
              className={cn(canDrag && 'handle')}
              readonly={readonly}
              payload={itemWithId.variable}
              onChange={handleVarChange(keyboardSort.getItemKey(index))}
              onRemove={handleVarRemove(keyboardSort.getItemKey(index))}
              varKeys={list.map((item) => item.variable)}
              canDrag={canDrag}
            />
          </div>
        ))}
      </ReactSortable>
    </>
  )
}
export default React.memo(VarList)
