'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo, useRef } from 'react'
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
    setTimeout(() => {
      listRef.current?.scrollToItem(newList.length - 1, 'end')
    }, 100)
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
  const handleSideWidth = 3

  const useVirtualScrolling = topicCount > 10

  const renderItem = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const item = list[index]
    const canDrag = !readonly && topicCount >= 2

    return (
      <div
        style={style}
        key={item.id}
        className={cn(
          'group relative rounded-[10px] bg-components-panel-bg',
          `-ml-${handleSideWidth} min-h-[40px] px-0 py-0 mb-2`,
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
  }, [list, nodeId, readonly, topicCount, handleClassChange, handleRemoveClass, filterVar, handleSideWidth])

  const getItemSize = useCallback((index: number) => {
    const item = list[index]
    const textLength = item.name.length
    const baseHeight = 100
    const additionalHeight = Math.min(Math.floor(textLength / 50) * 30, 200)
    return baseHeight + additionalHeight
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
            <div style={{ height: Math.min(totalHeight, 500), width: '100%' }}>
              <List
                ref={listRef}
                height={Math.min(totalHeight, 500)}
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
                        `-ml-${handleSideWidth} min-h-[40px] px-0 py-0`,
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
