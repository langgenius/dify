'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Button from '../base/button'
import { Plus } from '../base/icons/src/vender/line/general'
import type { Collection } from './types'
import { CollectionType, LOC } from './types'
import ToolNavList from './tool-nav-list'
import Search from './search'
import { collectionList } from './mock-data'
import Contribute from './contribute'
import TabSlider from '@/app/components/base/tab-slider'

type Props = {
  loc: LOC
}

const Tools: FC<Props> = ({
  loc,
}) => {
  const { t } = useTranslation()
  const isInToolsPage = loc === LOC.tools

  const [currCollection, setCurrCollection] = React.useState<Collection | null>(collectionList[0])
  const collectionTypeOptions = (() => {
    const res = [
      { value: CollectionType.builtIn, text: t('tools.type.builtIn') },
      { value: CollectionType.custom, text: t('tools.type.custom') },
    ]
    if (!isInToolsPage)
      res.unshift({ value: CollectionType.all, text: t('tools.type.all') })
    return res
  })()

  const [collectionType, setCollectionType] = React.useState<CollectionType>(collectionTypeOptions[0].value)

  const [query, setQuery] = React.useState('')

  return (
    <div className='flex h-full'>
      {/* sidebar */}
      <div className={cn(isInToolsPage && 'px-4', 'flex flex-col sm:w-56 w-16 shrink-0 pb-2')}>
        <Button className='mt-6 flex items-center !h-8 pl-4' type='primary'>
          <Plus className='w-4 h-4 mr-1' />
          <div className='leading-[18px] text-[13px] font-medium'>{t('tools.createCustomTool')}</div>
        </Button>
        <TabSlider
          className='mt-3'
          itemWidth={isInToolsPage ? 93 : 48}
          value={collectionType}
          onChange={v => setCollectionType(v as CollectionType)}
          options={collectionTypeOptions}
        />
        <Search
          className='mt-5'
          value={query}
          onChange={setQuery}
        />

        <ToolNavList
          className='mt-2 grow height-0 overflow-y-auto'
          currentName={currCollection?.name || ''}
          list={collectionList}
          onChosen={setCurrCollection}
        />
        {loc === LOC.tools && (
          <Contribute />
        )}
      </div>

      {/* tools */}
      <div className='grow h-full overflow-hidden p-2'>
        <div className='h-full border-l border-gray-200 bg-white rounded-2xl'>
          content
        </div>
      </div>
    </div>
  )
}
export default React.memo(Tools)
