'use client'
import Sort from '@/app/components/base/sort'
import Header from './components/header'
import List from './components/list'
import useLegacyList from './use-legacy-list'
import Chip from '@/app/components/base/chip'
import { RiFilter3Line } from '@remixicon/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const i18nPrefix = 'app.checkLegacy'
const Page = () => {
  const { t } = useTranslation()
  const {
    sort_by,
    setOrderBy,
    published,
    setPublished,
    clearPublished,
  } = useLegacyList()

  const handleSelectPublished = useCallback(({ value }: { value: number }) => {
    setPublished(value)
  }, [setPublished])

  const renderTriggerContent = useCallback(() => {
    if(published === undefined)
      return t(`${i18nPrefix}.published`)
    return (
      <div className='flex space-x-1'>
        <div>{t(`${i18nPrefix}.published`)}</div>
        <span className='system-sm-medium text-text-secondary'>{published === 1 ? t(`${i18nPrefix}.yes`) : t(`${i18nPrefix}.no`)}</span>
      </div>
    )
  }, [published, t])

  return (
    <div className='h-full rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle px-6 pt-4'>
      <Header appNum={5} publishedNum={3}/>
      {/* Filter */}
      <div className='mb-2 mt-4 flex flex-row flex-wrap items-center gap-2'>
        <Chip
          className='min-w-[150px]'
          panelClassName='w-[270px]'
          leftIcon={<RiFilter3Line className='h-4 w-4 text-text-secondary' />}
          value={published}
          renderTriggerContent={renderTriggerContent}
          onSelect={handleSelectPublished}
          onClear={clearPublished}
          items={[
            { value: 1, name: t(`${i18nPrefix}.yes`) },
            { value: 0, name: t(`${i18nPrefix}.no`) },
          ]}
        />
        <div className='h-3.5 w-px bg-divider-regular'></div>
        <Sort
          // '-' means descending order
          order={sort_by?.startsWith('-') ? '-' : ''}
          value={sort_by?.replace('-', '') || 'created_at'}
          items={[
            { value: 'created_at', name: t(`${i18nPrefix}.createAt`) },
            { value: 'last_request', name: t(`${i18nPrefix}.lastRequest`) },
          ]}
          onSelect={setOrderBy}
        />
      </div>
      <div>
        <List list={[]} />
      </div>
    </div>
  )
}

export default Page
