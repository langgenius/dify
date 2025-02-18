'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import ObjectValueItem from '@/app/components/workflow/panel/chat-variable-panel/components/object-value-item'

type Props = {
  list: any[]
  onChange: (list: any[]) => void
}

const ObjectValueList: FC<Props> = ({
  list,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className='w-full overflow-hidden rounded-lg border border-gray-200'>
      <div className='system-xs-medium text-text-tertiary flex h-7 items-center uppercase'>
        <div className='flex h-full w-[120px] items-center border-r border-gray-200 pl-2'>{t('workflow.chatVariable.modal.objectKey')}</div>
        <div className='flex h-full w-[96px] items-center border-r border-gray-200 pl-2'>{t('workflow.chatVariable.modal.objectType')}</div>
        <div className='flex h-full w-[230px] items-center pl-2 pr-1'>{t('workflow.chatVariable.modal.objectValue')}</div>
      </div>
      {list.map((item, index) => (
        <ObjectValueItem
          key={index}
          index={index}
          list={list}
          onChange={onChange}
        />
      ))}
    </div>
  )
}
export default React.memo(ObjectValueList)
