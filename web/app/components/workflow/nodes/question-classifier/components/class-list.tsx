'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import { useEdgesInteractions } from '../../../hooks'
import AddButton from '../../_base/components/add-button'
import Item from './class-item'
import type { Topic } from '@/app/components/workflow/nodes/question-classifier/types'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

type Props = {
  id: string
  list: Topic[]
  onChange: (list: Topic[]) => void
  readonly?: boolean
}

const ClassList: FC<Props> = ({
  id,
  list,
  onChange,
  readonly,
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
      handleEdgeDeleteByDeleteBranch(id, list[index].id)
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange, handleEdgeDeleteByDeleteBranch, id])

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
              index={index + 1}
              readonly={readonly}
            />
          )
        })
      }
      {!readonly && (
        <AddButton
          onClick={handleAddClass}
          text={t(`${i18nPrefix}.addClass`)}
        />
      )}

    </div>
  )
}
export default React.memo(ClassList)
