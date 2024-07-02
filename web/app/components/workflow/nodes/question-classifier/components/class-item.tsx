'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import type { Topic } from '../types'
import TextEditor from '../../_base/components/editor/text-editor'

const i18nPrefix = 'workflow.nodes.questionClassifiers'

type Props = {
  payload: Topic
  onChange: (payload: Topic) => void
  onRemove: () => void
  index: number
  readonly?: boolean
}

const ClassItem: FC<Props> = ({
  payload,
  onChange,
  onRemove,
  index,
  readonly,
}) => {
  const { t } = useTranslation()

  const handleNameChange = useCallback((value: string) => {
    onChange({ ...payload, name: value })
  }, [onChange, payload])

  return (
    <TextEditor
      isInNode
      title={<div>
        <div className='w-[200px]'>
          <div
            className='leading-4 text-xs font-semibold text-gray-700'
          >
            {`${t(`${i18nPrefix}.class`)} ${index}`}
          </div>
        </div>
      </div>}
      value={payload.name}
      onChange={handleNameChange}
      placeholder={t(`${i18nPrefix}.topicPlaceholder`)!}
      headerRight={(
        <div className='flex items-center h-full'>
          <div className='text-xs font-medium text-gray-500'>{payload.name.length}</div>
          <div className='mx-3 h-3 w-px bg-gray-200'></div>
          {!readonly && (
            <RiDeleteBinLine
              className='mr-1 w-3.5 h-3.5 text-gray-500 cursor-pointer'
              onClick={onRemove}
            />
          )}
        </div>
      )}
      readonly={readonly}
      minHeight={64}
    />
  )
}
export default React.memo(ClassItem)
