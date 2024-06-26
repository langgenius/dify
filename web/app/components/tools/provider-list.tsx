'use client'
import { useEffect, useMemo, useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import type { Collection } from './types'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import TabSliderNew from '@/app/components/base/tab-slider-new'
import LabelFilter from '@/app/components/tools/labels/filter'
import SearchInput from '@/app/components/base/search-input'
import { DotsGrid } from '@/app/components/base/icons/src/vender/line/general'
import { Colors } from '@/app/components/base/icons/src/vender/line/others'
import { Route } from '@/app/components/base/icons/src/vender/line/mapsAndTravel'
import CustomCreateCard from '@/app/components/tools/provider/custom-create-card'
import ContributeCard from '@/app/components/tools/provider/contribute'
import ProviderCard from '@/app/components/tools/provider/card'
import ProviderDetail from '@/app/components/tools/provider/detail'
import Empty from '@/app/components/tools/add-tool-modal/empty'
import { fetchCollectionList } from '@/service/tools'

const ProviderList = () => {
  const { t } = useTranslation()

  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: 'builtin',
  })
  const options = [
    { value: 'builtin', text: t('tools.type.builtIn'), icon: <DotsGrid className='w-[14px] h-[14px] mr-1'/> },
    { value: 'api', text: t('tools.type.custom'), icon: <Colors className='w-[14px] h-[14px] mr-1'/> },
    { value: 'workflow', text: t('tools.type.workflow'), icon: <Route className='w-[14px] h-[14px] mr-1'/> },
  ]
  const [tagFilterValue, setTagFilterValue] = useState<string[]>([])
  const handleTagsChange = (value: string[]) => {
    setTagFilterValue(value)
  }
  const [keywords, setKeywords] = useState<string>('')
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
  }

  const [collectionList, setCollectionList] = useState<Collection[]>([])
  const filteredCollectionList = useMemo(() => {
    return collectionList.filter((collection) => {
      if (collection.type !== activeTab)
        return false
      if (tagFilterValue.length > 0 && (!collection.labels || collection.labels.every(label => !tagFilterValue.includes(label))))
        return false
      if (keywords)
        return collection.name.toLowerCase().includes(keywords.toLowerCase())
      return true
    })
  }, [activeTab, tagFilterValue, keywords, collectionList])
  const getProviderList = async () => {
    const list = await fetchCollectionList()
    setCollectionList([...list])
  }
  useEffect(() => {
    getProviderList()
  }, [])

  const [currentProvider, setCurrentProvider] = useState<Collection | undefined>()
  useEffect(() => {
    if (currentProvider && collectionList.length > 0) {
      const newCurrentProvider = collectionList.find(collection => collection.id === currentProvider.id)
      setCurrentProvider(newCurrentProvider)
    }
  }, [collectionList, currentProvider])

  return (
    <div className='relative flex overflow-hidden bg-gray-100 shrink-0 h-0 grow'>
      <div className='relative flex flex-col overflow-y-auto bg-gray-100 grow'>
        <div className={cn(
          'sticky top-0 flex justify-between items-center pt-4 px-12 pb-2 leading-[56px] bg-gray-100 z-20 flex-wrap gap-y-2',
          currentProvider && 'pr-6',
        )}>
          <TabSliderNew
            value={activeTab}
            onChange={(state) => {
              setActiveTab(state)
              if (state !== activeTab)
                setCurrentProvider(undefined)
            }}
            options={options}
          />
          <div className='flex items-center gap-2'>
            <LabelFilter value={tagFilterValue} onChange={handleTagsChange} />
            <SearchInput className='w-[200px]' value={keywords} onChange={handleKeywordsChange} />
          </div>
        </div>
        <div className={cn(
          'relative grid content-start grid-cols-1 gap-4 px-12 pt-2 pb-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 grow shrink-0',
          currentProvider && 'pr-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        )}>
          {activeTab === 'builtin' && <ContributeCard />}
          {activeTab === 'api' && <CustomCreateCard onRefreshData={getProviderList}/>}
          {filteredCollectionList.map(collection => (
            <ProviderCard
              active={currentProvider?.id === collection.id}
              onSelect={() => setCurrentProvider(collection)}
              key={collection.id}
              collection={collection}
            />
          ))}
          {!filteredCollectionList.length && <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'><Empty/></div>}
        </div>
      </div>
      <div className={cn(
        'shrink-0 w-0 border-l-[0.5px] border-black/8 overflow-y-auto transition-all duration-200 ease-in-out',
        currentProvider && 'w-[420px]',
      )}>
        {currentProvider && <ProviderDetail collection={currentProvider} onRefreshData={getProviderList} />}
      </div>
      <div className='absolute top-5 right-5 p-1 cursor-pointer' onClick={() => setCurrentProvider(undefined)}><RiCloseLine className='w-4 h-4'/></div>
    </div>
  )
}
ProviderList.displayName = 'ToolProviderList'
export default ProviderList
