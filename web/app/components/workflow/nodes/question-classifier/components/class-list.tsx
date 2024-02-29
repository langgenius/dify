'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import AddButton from '../../_base/components/add-button'
import Item from './class-item'
import type { Topic } from '@/app/components/workflow/nodes/question-classifier/types'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

type Props = {
  list: Topic[]
  onChange: (list: Topic[]) => void
}

const ClassList: FC<Props> = ({
  list,
  onChange,
}) => {
  const { t } = useTranslation()

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
      draft.push({ id: '', name: t(`${i18nPrefix}.class`) + (list.length + 1), topic: '' })
    })
    onChange(newList)
  }, [list, onChange])

  const handleRemoveClass = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange])

  // Todo Remove; edit topic name
  return (
    <div className='space-y-2'>
      {
        list.map((item, index) => {
          return (
            <Item
              key={index}
              payload={item}
              onChange={handleClassChange(index)}
              onRemove={handleRemoveClass(index)}
            />
          )
        })
      }
      <AddButton
        onClick={handleAddClass}
        text={t(`${i18nPrefix}.addClass`)}
      />
    </div>
  )
}
export default React.memo(ClassList)
