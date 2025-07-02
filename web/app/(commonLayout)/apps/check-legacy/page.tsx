'use client'
import Sort from '@/app/components/base/sort'
import Header from './components/header'
import List from './components/list'
import useLegacyList from './use-legacy-list'
import Chip from '@/app/components/base/chip'
import { RiFile3Line } from '@remixicon/react'

const Page = () => {
  const {
    sort_by,
    setOrderBy,
    published,
    setPublished,
    clearPublished,
  } = useLegacyList()
  return (
    <div className='h-full rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle px-6 pt-4'>
      <Header appNum={5} publishedNum={3}/>
      {/* Filter */}
      <div className='mb-2 mt-4 flex flex-row flex-wrap items-center gap-2'>
        <Chip
          className='min-w-[150px]'
          panelClassName='w-[270px]'
          leftIcon={<RiFile3Line className='h-4 w-4 text-text-secondary' />}
          value={published}
          onSelect={setPublished}
          onClear={clearPublished}
          items={[
            { value: 1, name: 'Yes' },
            { value: 0, name: 'No' },
          ]}
        />
        <div className='h-3.5 w-px bg-divider-regular'></div>
        <Sort
          // '-' means descending order
          order={sort_by?.startsWith('-') ? '-' : ''}
          value={sort_by?.replace('-', '') || 'created_at'}
          items={[
            { value: 'created_at', name: 'Created At' },
            { value: 'last_request', name: 'Last request' },
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
