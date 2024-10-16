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
    <div className='w-full border border-gray-200 rounded-lg overflow-hidden'>
      <div className='flex items-center h-7 system-xs-medium text-text-tertiary uppercase'>
        <div className='w-[120px] flex items-center h-full pl-2 border-r border-gray-200'>{t('workflow.chatVariable.modal.objectKey')}</div>
        <div className='w-[96px] flex items-center h-full pl-2 border-r border-gray-200'>{t('workflow.chatVariable.modal.objectType')}</div>
        <div className='w-[230px] flex items-center h-full pl-2 pr-1'>{t('workflow.chatVariable.modal.objectValue')}</div>
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
