'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import type { Topic } from '../types'
import TextEditor from '../../_base/components/editor/text-editor'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

type Props = {
  payload: Topic
  onChange: (payload: Topic) => void
  onRemove: () => void
}

const ClassItem: FC<Props> = ({
  payload,
  onChange,
  onRemove,
}) => {
  const { t } = useTranslation()
  const [isEdit, {
    setTrue: setIsEditTrue,
    setFalse: setIsEditFalse,
  }] = useBoolean(false)

  const handleTopicChange = useCallback((value: string) => {
    onChange({ ...payload, topic: value })
  }, [onChange, payload])

  const handleClassNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...payload, name: e.target.value })
  }, [onChange, payload])
  return (
    <TextEditor
      title={<div>
        <div className='w-[200px]'>
          {isEdit
            ? (
              <input
                type='text'
                className='w-full h-4 leading-4 text-gray-900 text-xs font-normal placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
                value={payload.name}
                onChange={handleClassNameChange}
                onBlur={setIsEditFalse}
                autoFocus
                placeholder={t(`${i18nPrefix}.classNamePlaceholder`)!}
              />
            )
            : <div
              className='leading-4 text-xs font-semibold text-gray-700'
              onClick={setIsEditTrue}
            >
              {payload.name}
            </div>}
        </div>
      </div>}
      value={payload.topic}
      onChange={handleTopicChange}
      placeholder={t(`${i18nPrefix}.topicPlaceholder`)!}
      headerRight={(
        <div className='flex items-center h-full'>
          <div className='text-xs font-medium text-gray-500'>{payload.topic.length}</div>
          <div className='mx-3 h-3 w-px bg-gray-200'></div>
          <Trash03
            className='mr-1 w-3.5 h-3.5 text-gray-500 cursor-pointer'
            onClick={onRemove}
          />
        </div>
      )}
      minHeight={64}
    />
  )
}
export default React.memo(ClassItem)
