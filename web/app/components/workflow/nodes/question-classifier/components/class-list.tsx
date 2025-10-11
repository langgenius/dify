'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import { useEdgesInteractions } from '../../../hooks'
import AddButton from '../../_base/components/add-button'
import Item from './class-item'
import type { Topic } from '@/app/components/workflow/nodes/question-classifier/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { ReactSortable } from 'react-sortablejs'
import { noop } from 'lodash-es'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

// Layout constants
const MAX_CONTAINER_HEIGHT = 500 // Maximum height in pixels for scrollable containers
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

  // Scroll to the newly added item after the list updates
  useEffect(() => {
    if (shouldScrollToEnd && list.length > prevListLength.current) {
      if (listContainerRef.current) {
        // Scroll the container to bottom
        listContainerRef.current.scrollTop = listContainerRef.current.scrollHeight
      }
      setShouldScrollToEnd(false)
    }
    prevListLength.current = list.length
  }, [list.length, shouldScrollToEnd])

  // Todo Remove; edit topic name
  return (
    <>
      <div
        ref={listContainerRef}
        className='max-h-[500px] overflow-y-auto'
        style={{
          // Performance optimizations for large lists
          willChange: 'scroll-position',
          contain: 'layout style paint',
        }}
      >
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
                  style={{
                    // Performance hint for browser
                    contain: 'layout style paint',
                  }}
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
