'use client'
import type { FC } from 'react'
import type { Topic } from '@/app/components/workflow/nodes/question-classifier/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { RiDraggable } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactSortable } from 'react-sortablejs'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
import { cn } from '@/utils/classnames'
import { useEdgesInteractions } from '../../../hooks'
import AddButton from '../../_base/components/add-button'
import Item from './class-item'

const i18nPrefix = 'nodes.questionClassifiers'

// Layout constants
const HANDLE_SIDE_WIDTH = 3 // Width offset for drag handle spacing

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
      draft.push({ id: `${Date.now()}`, name: '' })
    })
    onChange(newList)
    setShouldScrollToEnd(true)
    if (collapsed)
      setCollapsed(false)
  }, [list, onChange, collapsed])

  const handleRemoveClass = useCallback((index: number) => {
    return () => {
      handleEdgeDeleteByDeleteBranch(nodeId, list[index].id)
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange, handleEdgeDeleteByDeleteBranch, nodeId])

  const topicCount = list.length

  // Scroll to the newly added item after the list updates
  useEffect(() => {
    if (shouldScrollToEnd && list.length > prevListLength.current)
      setShouldScrollToEnd(false)
    prevListLength.current = list.length
  }, [list.length, shouldScrollToEnd])

  const handleCollapse = useCallback(() => {
    setCollapsed(!collapsed)
  }, [collapsed])

  return (
    <>
      <div className="mb-2 flex items-center justify-between" onClick={handleCollapse}>
        <div className="flex cursor-pointer items-center text-xs font-semibold uppercase text-text-secondary">
          {t(`${i18nPrefix}.class`, { ns: 'workflow' })}
          {' '}
          <span className="text-text-destructive">*</span>
          {list.length > 0 && (
            <ArrowDownRoundFill
              className={cn(
                'h-4 w-4 text-text-quaternary transition-transform duration-200',
                collapsed && '-rotate-90',
              )}
            />
          )}
        </div>
      </div>

      {!collapsed && (
        <div
          ref={listContainerRef}
          className={cn('overflow-y-visible', `pl-${HANDLE_SIDE_WIDTH}`)}
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
                const canDrag = (() => {
                  if (readonly)
                    return false

                  return topicCount >= 2
                })()
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'group relative rounded-[10px] bg-components-panel-bg',
                      `-ml-${HANDLE_SIDE_WIDTH} min-h-[40px] px-0 py-0`,
                    )}
                    style={{
                      // Performance hint for browser
                      contain: 'layout style paint',
                    }}
                  >
                    <div>
                      {canDrag && (
                        <RiDraggable className={cn(
                          'handle absolute left-2 top-3 hidden h-3 w-3 cursor-pointer text-text-tertiary',
                          'group-hover:block',
                        )}
                        />
                      )}
                      <Item
                        className={cn(canDrag && 'handle')}
                        headerClassName={cn(canDrag && 'cursor-grab group-hover:pl-5')}
                        nodeId={nodeId}
                        key={list[index].id}
                        payload={item}
                        onChange={handleClassChange(index)}
                        onRemove={handleRemoveClass(index)}
                        index={index + 1}
                        readonly={readonly}
                        filterVar={filterVar}
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
