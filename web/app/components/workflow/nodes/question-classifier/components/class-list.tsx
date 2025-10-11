'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import { VariableSizeList as List } from 'react-window'
import { useEdgesInteractions } from '../../../hooks'
import AddButton from '../../_base/components/add-button'
import Item from './class-item'
import type { Topic } from '@/app/components/workflow/nodes/question-classifier/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { ReactSortable } from 'react-sortablejs'
import { noop } from 'lodash-es'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

const VIRTUAL_SCROLL_THRESHOLD = 10
const MAX_CONTAINER_HEIGHT = 500

const BASE_ITEM_HEIGHT = 100
const CHARS_PER_LINE_ESTIMATE = 50
const HEIGHT_PER_ADDITIONAL_LINE = 30
const MAX_ADDITIONAL_HEIGHT = 200

const HANDLE_SIDE_WIDTH = 3

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
  const listRef = useRef<List>(null)
  const nonVirtualListRef = useRef<HTMLDivElement>(null)
  const [shouldScrollToEnd, setShouldScrollToEnd] = useState(false)
  const prevListLength = useRef(list.length)

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
  }, [list, onChange])

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

  const useVirtualScrolling = topicCount > VIRTUAL_SCROLL_THRESHOLD

  useEffect(() => {
    if (shouldScrollToEnd && list.length > prevListLength.current) {
      if (useVirtualScrolling && listRef.current) {
        listRef.current.scrollToItem(list.length - 1, 'end')
      }
      else if (nonVirtualListRef.current) {
        nonVirtualListRef.current.scrollTop = nonVirtualListRef.current.scrollHeight
      }
      setShouldScrollToEnd(false)
    }
    prevListLength.current = list.length
  }, [list.length, useVirtualScrolling, shouldScrollToEnd])

  const renderItem = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const item = list[index]
    const canDrag = !readonly && topicCount >= 2

    return (
      <div
        style={style}
        key={item.id}
        className={cn(
          'group relative rounded-[10px] bg-components-panel-bg',
          `-ml-${HANDLE_SIDE_WIDTH} min-h-[40px] px-0 py-0 mb-2`,
        )}
      >
        <div>
          <Item
            className={cn(canDrag && 'handle')}
            headerClassName={cn(canDrag && 'cursor-grab')}
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
  }, [list, nodeId, readonly, topicCount, handleClassChange, handleRemoveClass, filterVar])

  const getItemSize = useCallback((index: number) => {
    const item = list[index]
    const textLength = item.name.length
    const estimatedLines = Math.floor(textLength / CHARS_PER_LINE_ESTIMATE)
    const additionalHeight = Math.min(estimatedLines * HEIGHT_PER_ADDITIONAL_LINE, MAX_ADDITIONAL_HEIGHT)
    return BASE_ITEM_HEIGHT + additionalHeight
  }, [list])

  const totalHeight = useMemo(() => {
    if (!useVirtualScrolling)
      return 0
    return list.reduce((acc, _, index) => acc + getItemSize(index), 0)
  }, [list, getItemSize, useVirtualScrolling])

  // Todo Remove; edit topic name
  return (
    <>
      {useVirtualScrolling
        ? (
            <div style={{ height: Math.min(totalHeight, MAX_CONTAINER_HEIGHT), width: '100%' }}>
              <List
                ref={listRef}
                height={Math.min(totalHeight, MAX_CONTAINER_HEIGHT)}
                itemCount={list.length}
                itemSize={getItemSize}
                width='100%'
                className='space-y-2'
              >
                {renderItem}
              </List>
            </div>
          )
        : (
            <div ref={nonVirtualListRef} className={`max-h-[${MAX_CONTAINER_HEIGHT}px] overflow-y-auto`}>
              <ReactSortable
                list={list.map(item => ({ ...item }))}
                setList={handleSortTopic}
                handle='.handle'
                ghostClass='bg-components-panel-bg'
                animation={150}
                disabled={readonly}
                className='space-y-2'
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
                      >
                        <div>
                          <Item
                            className={cn(canDrag && 'handle')}
                            headerClassName={cn(canDrag && 'cursor-grab')}
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
      {!readonly && (
        <AddButton
          onClick={handleAddClass}
          text={t(`${i18nPrefix}.addClass`)}
        />
      )}
    </>
  )
}
export default React.memo(ClassList)
