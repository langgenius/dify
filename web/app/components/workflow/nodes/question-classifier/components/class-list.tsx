'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { produce } from 'immer'
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
  // Todo Remove; edit topic name
  return (
    <>
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
              <div key={item.id}
                className={cn(
                  'group relative rounded-[10px] bg-components-panel-bg',
                  `-ml-${handleSideWidth} min-h-[40px] px-0 py-0`,
                )}>
                <div >
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
