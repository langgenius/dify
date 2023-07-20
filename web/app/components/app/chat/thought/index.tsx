'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import type { ThoughtItem } from '../type'
import s from './style.module.css'
import { DataSet, Search, ThoughtList, WebReader } from '@/app/components/base/icons/src/public/thought'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'

export type IThoughtProps = {
  list: ThoughtItem[]
}

const getIcon = (toolId: string) => {
  switch (toolId) {
    case 'dataset':
      return <DataSet />
    case 'web_reader':
      return <WebReader />
    default:
      return <Search />
  }
}

const Thought: FC<IThoughtProps> = ({
  list,
}) => {
  const { t } = useTranslation()
  const [isShowDetail, setIsShowDetail] = React.useState(false)

  const renderItem = (item: ThoughtItem) => (
    <div className='flex space-x-1 items-center h-6' key={item.id}>
      <div className='shrink-0'>{getIcon(item.tool)}</div>
      <div>{item.thought}</div>
    </div>
  )
  return (
    <div className={cn(s.wrap, 'inline-block mb-2 px-2 py-0.5 rounded-md text-xs text-gray-500 font-medium')} >
      <div className='flex items-center h-6 space-x-1 cursor-pointer' onClick={() => setIsShowDetail(!isShowDetail)} >
        <ThoughtList />
        <div>{t(`explore.universalChat.thought.${isShowDetail ? 'hide' : 'show'}`)}{t('explore.universalChat.thought.processOfThought')}</div>
        <ChevronDown className={isShowDetail ? 'rotate-180' : '' } />
      </div>
      {isShowDetail && (
        <div>
          {list.map(item => renderItem(item))}
        </div>
      )}
    </div>
  )
}
export default React.memo(Thought)
