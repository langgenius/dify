'use client'
import { useEffect, useMemo, useState } from 'react'
// import cn from 'classnames'
import { useTranslation } from 'react-i18next'
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
    setCollectionList(list)
  }
  useEffect(() => {
    getProviderList()
  }, [])

  return (
    <div className='relative flex overflow-hidden bg-gray-100 shrink-0 h-0 grow'>
      <div className='relative flex flex-col overflow-y-auto bg-gray-100 grow'>
        <div className='sticky top-0 flex justify-between items-center pt-4 px-12 pb-2 leading-[56px] bg-gray-100 z-10 flex-wrap gap-y-2'>
          <TabSliderNew
            value={activeTab}
            onChange={setActiveTab}
            options={options}
          />
          <div className='flex items-center gap-2'>
            <LabelFilter value={tagFilterValue} onChange={handleTagsChange} />
            <SearchInput className='w-[200px]' value={keywords} onChange={handleKeywordsChange} />
          </div>
        </div>
        <div className='grid content-start grid-cols-1 gap-4 px-12 pt-2 pb-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 grow shrink-0'>
          {activeTab === 'builtin' && <ContributeCard />}
          {activeTab === 'api' && <CustomCreateCard/>}
          {filteredCollectionList.map(collection => (
            <ProviderCard
              key={collection.id}
              collection={collection}
            />
          ))}
        </div>
      </div>
      {/* <div className='shrink-0 w-[420px] overflow-y-auto'>
        <div className='h-[1200px]'>detail</div>
      </div> */}
    </div>
  )
}
ProviderList.displayName = 'ToolProviderList'
export default ProviderList
