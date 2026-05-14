'use client'
import type { FC } from 'react'
import type { Topic } from '@/app/components/workflow/nodes/question-classifier/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RiDraggable } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
import { useEdgesInteractions } from '../../../hooks'
import AddButton from '../../_base/components/add-button'
import Item from './class-item'
import { getDefaultClassLabel, isDefaultClassLabel } from './class-label-utils'

const i18nPrefix = 'nodes.questionClassifiers'
const INLINE_LABEL_HINT_STORAGE_KEY = 'question-classifier-inline-label-hint-dismissed'

type Props = {
  nodeId: string
  list: Topic[]
  onChange: (list: Topic[]) => void
  readonly?: boolean
  filterVar: (payload: Var, valueSelector: ValueSelector) => boolean
  handleSortTopic?: (newTopics: (Topic & { id: string })[]) => void
}

const ClassList: FC<Props> = ({
  nodeId,
  list,
  onChange,
  readonly,
  filterVar,
  handleSortTopic = noop,
}) => {
  const { t } = useTranslation()
  const { handleEdgeDeleteByDeleteBranch } = useEdgesInteractions()
  const listContainerRef = useRef<HTMLDivElement>(null)
  const [shouldScrollToEnd, setShouldScrollToEnd] = useState(false)
  const prevListLength = useRef(list.length)
  const [collapsed, setCollapsed] = useState(false)
  const [isRenameHintDismissed, setIsRenameHintDismissed] = useState(() => {
    if (typeof window === 'undefined')
      return true

    try {
      return window.localStorage.getItem(INLINE_LABEL_HINT_STORAGE_KEY) === 'true'
    }
    catch {
      return false
    }
  })

  const handleClassChange = useCallback((index: number) => {
    return (value: Topic) => {
      const newList = produce(list, (draft) => {
        draft[index] = value
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleAddClass = useCallback(() => {
    const newList = produce(list, (draft) => {
      draft.push({
        id: `${Date.now()}`,
        name: '',
        label: getDefaultClassLabel(t, draft.length + 1),
      })
    })
    onChange(newList)
    setShouldScrollToEnd(true)
    if (collapsed)
      setCollapsed(false)
  }, [collapsed, list, onChange, t])

  const handleRemoveClass = useCallback((index: number) => {
    return () => {
      handleEdgeDeleteByDeleteBranch(nodeId, list[index]!.id)
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange, handleEdgeDeleteByDeleteBranch, nodeId])

  const topicCount = list.length

  useEffect(() => {
    if (shouldScrollToEnd && list.length > prevListLength.current)
      setShouldScrollToEnd(false)
    prevListLength.current = list.length
  }, [list.length, shouldScrollToEnd])

  const handleCollapse = useCallback(() => {
    setCollapsed(!collapsed)
  }, [collapsed])

  const dismissRenameHint = useCallback(() => {
    if (isRenameHintDismissed)
      return

    setIsRenameHintDismissed(true)
    try {
      window.localStorage.setItem(INLINE_LABEL_HINT_STORAGE_KEY, 'true')
    }
    catch {
    }
  }, [isRenameHintDismissed])

  const shouldShowRenameHint = !readonly && !isRenameHintDismissed && list.some((item, index) => {
    return isDefaultClassLabel(item.label, index + 1, t)
  })

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className="flex cursor-pointer items-center border-none bg-transparent p-0 text-left text-xs font-semibold text-text-secondary uppercase focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          onClick={handleCollapse}
        >
          {t(`${i18nPrefix}.class`, { ns: 'workflow' })}
          {' '}
          <span className="text-text-destructive">*</span>
          {list.length > 0 && (
            <ArrowDownRoundFill
              className={cn(
                'h-4 w-4 text-text-quaternary transition-transform duration-200',
                collapsed && '-rotate-90',
              )}
              aria-hidden="true"
            />
          )}
        </button>
      </div>
      {shouldShowRenameHint && (
        <div className="mb-2 rounded-lg border border-divider-subtle bg-components-panel-bg px-3 py-2 text-xs text-text-tertiary">
          {t(`${i18nPrefix}.renameHint`, { ns: 'workflow' })}
        </div>
      )}

      {!collapsed && (
        <div
          ref={listContainerRef}
          className="overflow-y-visible pl-3"
        >
          <ReactSortable
            list={list.map(item => ({ ...item }))}
            setList={handleSortTopic}
            handle=".handle"
            ghostClass="bg-components-panel-bg"
            animation={150}
            disabled={readonly}
            className="space-y-2"
          >
            {
              list.map((item, index) => {
                const canDrag = !readonly && topicCount >= 2
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'group relative -ml-3 min-h-[40px] rounded-[10px] bg-components-panel-bg px-0 py-0',
                    )}
                    style={{
                      // Performance hint for browser
                      contain: 'layout style paint',
                    }}
                  >
                    <div>
                      {canDrag && (
                        <RiDraggable className={cn(
                          'handle absolute top-3 left-2 hidden h-3 w-3 cursor-pointer text-text-tertiary',
                          'group-hover:block',
                        )}
                        />
                      )}
                      <Item
                        className={cn(canDrag && 'handle')}
                        headerClassName={cn(canDrag && 'cursor-grab group-hover:pl-5')}
                        nodeId={nodeId}
                        key={list[index]!.id}
                        payload={item}
                        onChange={handleClassChange(index)}
                        onRemove={handleRemoveClass(index)}
                        index={index + 1}
                        readonly={readonly}
                        filterVar={filterVar}
                        onLabelEditStart={dismissRenameHint}
                      />
                    </div>
                  </div>
                )
              })
            }
          </ReactSortable>
        </div>
      )}
      {!readonly && !collapsed && (
        <div className="mt-2">
          <AddButton
            onClick={handleAddClass}
            text={t(`${i18nPrefix}.addClass`, { ns: 'workflow' })}
          />
        </div>
      )}
    </>
  )
}
export default React.memo(ClassList)
