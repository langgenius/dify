'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import TextEditor from '../../_base/components/editor/text-editor'
import AddButton from '../../_base/components/add-button'
import type { Topic } from '@/app/components/workflow/nodes/question-classifier/types'
type Props = {
  list: Topic[]
  onChange: (list: Topic[]) => void
}

const ClassList: FC<Props> = ({
  list,
  onChange,
}) => {
  const handleTopicChange = useCallback((index: number) => {
    return (value: string) => {
      const newList = produce(list, (draft) => {
        draft[index].topic = value
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleAddTopic = useCallback(() => {
    const newList = produce(list, (draft) => {
      draft.push({ id: '', name: 'topic aaa', topic: 'aaa' })
    })
    onChange(newList)
  }, [list, onChange])

  // Todo Remove; edit topic name
  return (
    <div className='space-y-2'>
      {
        list.map((item, index) => {
          return (
            <TextEditor
              title={<div>
                {/* can edit */}
                <div>{item.name}</div>
              </div>}
              key={index}
              value={item.topic}
              onChange={handleTopicChange(index)}
            />
          )
        })
      }
      <AddButton
        onClick={handleAddTopic}
        text='Add Class'
      />
    </div>
  )
}
export default React.memo(ClassList)
