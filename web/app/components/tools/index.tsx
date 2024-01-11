'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Button from '../base/button'
import { Plus } from '../base/icons/src/vender/line/general'
import type { Collection, Tool } from './types'
import { CollectionType, LOC } from './types'
import ToolNavList from './tool-nav-list'
import Search from './search'
import Contribute from './contribute'
import ToolList from './tool-list'
import EditCustomToolModal from './edit-custom-collection-modal'
import TabSlider from '@/app/components/base/tab-slider'
import { fetchBuiltInToolList, fetchCollectionList } from '@/service/tools'
type Props = {
  loc: LOC
  addedToolNames?: string[]
  onAddTool?: (payload: Tool) => void
}

const Tools: FC<Props> = ({
  loc,
  addedToolNames,
  onAddTool,
}) => {
  const { t } = useTranslation()
  const isInToolsPage = loc === LOC.tools
  const isInDebugPage = !isInToolsPage

  const [collectionList, setCollectionList] = useState<Collection[]>([])
  const [currCollection, setCurrCollection] = useState<Collection | null>(null)

  useEffect(() => {
    (async () => {
      const list = await fetchCollectionList() as Collection[]
      setCollectionList(list)
      if (list.length > 0)
        setCurrCollection(list[0])
    })()
  }, [])

  const collectionTypeOptions = (() => {
    const res = [
      { value: CollectionType.builtIn, text: t('tools.type.builtIn') },
      { value: CollectionType.custom, text: t('tools.type.custom') },
    ]
    if (!isInToolsPage)
      res.unshift({ value: CollectionType.all, text: t('tools.type.all') })
    return res
  })()

  const [collectionType, setCollectionType] = useState<CollectionType>(collectionTypeOptions[0].value)

  const [query, setQuery] = useState('')
  const [currTools, setCurrentTools] = useState<Tool[]>([])
  useEffect(() => {
    (async () => {
      if (currCollection && currCollection.type === CollectionType.builtIn) {
        const list = await fetchBuiltInToolList(currCollection.name) as Tool[]
        setCurrentTools(list)
      }
    })()
  }, [currCollection])

  const [isAddToolCollection, setIsAddToolCollection] = useState(false)
  const [isShowEditCustomToolModal, setIsShowEditCustomToolModal] = useState(false)
  const handleCreateToolCollection = () => {
    setIsAddToolCollection(true)
    setIsShowEditCustomToolModal(true)
  }

  const handleEditToolCollection = () => {
    setIsAddToolCollection(false)
    setIsShowEditCustomToolModal(true)
  }

  return (
    <>
      <div className='flex h-full'>
        {/* sidebar */}
        <div className={cn(isInToolsPage ? 'sm:w-[216px] px-4' : 'sm:w-[256px] px-3', 'flex flex-col  w-16 shrink-0 pb-2')}>
          {isInToolsPage && (
            <Button className='mt-6 flex items-center !h-8 pl-4' type='primary' onClick={handleCreateToolCollection}>
              <Plus className='w-4 h-4 mr-1' />
              <div className='leading-[18px] text-[13px] font-medium'>{t('tools.createCustomTool')}</div>
            </Button>
          )}

          {isInDebugPage && (
            <div className='mt-6 flex space-x-1 items-center'>
              <Search
                className='grow'
                value={query}
                onChange={setQuery}
              />
              <Button className='flex items-center justify-center !w-8 !h-8 !p-0' type='primary'>
                <Plus className='w-4 h-4' onClick={handleCreateToolCollection} />
              </Button>
            </div>
          )}

          <TabSlider
            className='mt-3'
            itemWidth={isInToolsPage ? 89 : 75}
            value={collectionType}
            onChange={v => setCollectionType(v as CollectionType)}
            options={collectionTypeOptions}
          />
          {isInToolsPage && (
            <Search
              className='mt-5'
              value={query}
              onChange={setQuery}
            />
          )}

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
        <div className={cn('grow h-full overflow-hidden p-2')}>
          <div className='h-full bg-white rounded-2xl'>
            <ToolList
              collection={currCollection}
              list={currTools}
              loc={loc}
              addedToolNames={addedToolNames}
              onAddTool={onAddTool}
            />
          </div>
        </div>
      </div>
      {isShowEditCustomToolModal && (
        <EditCustomToolModal
          payload={isAddToolCollection ? null : {}}
          onHide={() => setIsShowEditCustomToolModal(false)}
        />
      )}
    </>
  )
}
export default React.memo(Tools)
