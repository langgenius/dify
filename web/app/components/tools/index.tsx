'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Button from '../base/button'
import { Plus } from '../base/icons/src/vender/line/general'
import Toast from '../base/toast'
import type { Collection, CustomCollectionBackend, Tool } from './types'
import { CollectionType, LOC } from './types'
import ToolNavList from './tool-nav-list'
import Search from './search'
import Contribute from './contribute'
import ToolList from './tool-list'
import EditCustomToolModal from './edit-custom-collection-modal'
import NoCustomTool from './info/no-custom-tool'
import NoSearchRes from './info/no-search-res'
import NoCustomToolPlaceholder from './no-custom-tool-placeholder'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import TabSlider from '@/app/components/base/tab-slider'
import { createCustomCollection, fetchCollectionList as doFetchCollectionList, fetchBuiltInToolList, fetchCustomToolList, fetchModelToolList } from '@/service/tools'
import type { AgentTool } from '@/types/app'

type Props = {
  loc: LOC
  addedTools?: AgentTool[]
  onAddTool?: (collection: Collection, payload: Tool) => void
  selectedProviderId?: string
}

const Tools: FC<Props> = ({
  loc,
  addedTools,
  onAddTool,
  selectedProviderId,
}) => {
  const { t } = useTranslation()
  const isInToolsPage = loc === LOC.tools
  const isInDebugPage = !isInToolsPage

  const [collectionList, setCollectionList] = useState<Collection[]>([])
  const [currCollectionIndex, setCurrCollectionIndex] = useState<number | null>(null)

  const [isDetailLoading, setIsDetailLoading] = useState(false)

  const fetchCollectionList = async () => {
    const list = await doFetchCollectionList()
    setCollectionList(list)
    if (list.length > 0 && currCollectionIndex === null) {
      let index = 0
      if (selectedProviderId)
        index = list.findIndex(item => item.id === selectedProviderId)

      setCurrCollectionIndex(index || 0)
    }
  }
  useEffect(() => {
    fetchCollectionList()
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

  const [query, setQuery] = useState('')
  const [toolPageCollectionType, setToolPageCollectionType] = useTabSearchParams({
    defaultTab: collectionTypeOptions[0].value,
  })
  const [appPageCollectionType, setAppPageCollectionType] = useState(collectionTypeOptions[0].value)
  const { collectionType, setCollectionType } = (() => {
    if (isInToolsPage) {
      return {
        collectionType: toolPageCollectionType,
        setCollectionType: setToolPageCollectionType,
      }
    }
    return {
      collectionType: appPageCollectionType,
      setCollectionType: setAppPageCollectionType,
    }
  })()

  const showCollectionList = (() => {
    let typeFilteredList: Collection[] = []
    if (collectionType === CollectionType.all)
      typeFilteredList = collectionList.filter(item => item.type !== CollectionType.model)
    else if (collectionType === CollectionType.builtIn)
      typeFilteredList = collectionList.filter(item => item.type === CollectionType.builtIn)
    else if (collectionType === CollectionType.custom)
      typeFilteredList = collectionList.filter(item => item.type === CollectionType.custom)
    if (query)
      return typeFilteredList.filter(item => item.name.includes(query))

    return typeFilteredList
  })()

  const hasNoCustomCollection = !collectionList.find(item => item.type === CollectionType.custom)

  useEffect(() => {
    setCurrCollectionIndex(0)
  }, [collectionType])

  const currCollection = (() => {
    if (currCollectionIndex === null)
      return null
    return showCollectionList[currCollectionIndex]
  })()

  const [currTools, setCurrentTools] = useState<Tool[]>([])
  useEffect(() => {
    if (!currCollection)
      return

    (async () => {
      setIsDetailLoading(true)
      try {
        if (currCollection.type === CollectionType.builtIn) {
          const list = await fetchBuiltInToolList(currCollection.name)
          setCurrentTools(list)
        }
        else if (currCollection.type === CollectionType.model) {
          const list = await fetchModelToolList(currCollection.name)
          setCurrentTools(list)
        }
        else {
          const list = await fetchCustomToolList(currCollection.name)
          setCurrentTools(list)
        }
      }
      catch (e) { }
      setIsDetailLoading(false)
    })()
  }, [currCollection?.name, currCollection?.type])

  const [isShowEditCollectionToolModal, setIsShowEditCollectionToolModal] = useState(false)
  const handleCreateToolCollection = () => {
    setIsShowEditCollectionToolModal(true)
  }

  const doCreateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await createCustomCollection(data)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    await fetchCollectionList()
    setIsShowEditCollectionToolModal(false)
  }

  return (
    <>
      <div className='flex h-full'>
        {/* sidebar */}
        <div className={cn(isInToolsPage ? 'sm:w-[216px] px-4' : 'sm:w-[256px] px-3', 'flex flex-col  w-16 shrink-0 pb-2')}>
          {isInToolsPage && (
            <Button className='mt-6 flex items-center !h-8 pl-4' type='primary' onClick={handleCreateToolCollection}>
              <Plus className='w-4 h-4 mr-1' />
              <div className='leading-[18px] text-[13px] font-medium truncate'>{t('tools.createCustomTool')}</div>
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

          {(collectionType === CollectionType.custom && hasNoCustomCollection)
            ? (
              <div className='grow h-0 p-2 pt-8'>
                <NoCustomTool onCreateTool={handleCreateToolCollection} />
              </div>
            )
            : (
              (showCollectionList.length > 0 || !query)
                ? <ToolNavList
                  className='mt-2 grow height-0 overflow-y-auto'
                  currentIndex={currCollectionIndex || 0}
                  list={showCollectionList}
                  onChosen={setCurrCollectionIndex}
                />
                : (
                  <div className='grow h-0 p-2 pt-8'>
                    <NoSearchRes
                      onReset={() => { setQuery('') }}
                    />
                  </div>
                )
            )}

          {loc === LOC.tools && (
            <Contribute />
          )}
        </div>

        {/* tools */}
        <div className={cn('grow h-full overflow-hidden p-2')}>
          <div className='h-full bg-white rounded-2xl'>
            {!(collectionType === CollectionType.custom && hasNoCustomCollection) && showCollectionList.length > 0 && (
              <ToolList
                collection={currCollection}
                list={currTools}
                loc={loc}
                addedTools={addedTools}
                onAddTool={onAddTool}
                onRefreshData={fetchCollectionList}
                onCollectionRemoved={() => {
                  setCurrCollectionIndex(0)
                  fetchCollectionList()
                }}
                isLoading={isDetailLoading}
              />
            )}

            {collectionType === CollectionType.custom && hasNoCustomCollection && (
              <NoCustomToolPlaceholder />
            )}
          </div>
        </div>
      </div>
      {isShowEditCollectionToolModal && (
        <EditCustomToolModal
          payload={null}
          onHide={() => setIsShowEditCollectionToolModal(false)}
          onAdd={doCreateCustomToolCollection}
        />
      )}
    </>
  )
}
export default React.memo(Tools)
