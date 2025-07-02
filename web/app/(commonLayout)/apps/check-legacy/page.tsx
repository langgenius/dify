'use client'
import Sort from '@/app/components/base/sort'
import Header from './components/header'
import List from './components/list'
import useLegacyList from './use-legacy-list'
import Chip from '@/app/components/base/chip'
import { RiFilter3Line, RiLoopLeftLine } from '@remixicon/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Pagination from '@/app/components/base/pagination'
import { APP_PAGE_LIMIT } from '@/config'
import { noop } from 'lodash'

const i18nPrefix = 'app.checkLegacy'
const Page = () => {
  const { t } = useTranslation()
  const {
    list,
    total,
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
    <div className='flex grow flex-col rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle px-6 pt-4'>
      <Header appNum={5} publishedNum={3}/>
      <div className='flex grow'>
        <div className='flex flex-col'>
          {/* Filter */}
          <div className='mb-2 mt-4 flex items-center justify-between'>
            <div className='flex items-center gap-2'>
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
            <Button >
                <RiLoopLeftLine className='mr-1 h-4 w-4' />
                {t('common.operation.reset')}
              </Button>
          </div>
          <List list={list} />
          {(total && total > APP_PAGE_LIMIT)
            ? <Pagination
              className='shrink-0'
              current={1}
              onChange={noop}
              total={total}
              limit={10}
              onLimitChange={noop}
            />
            : null}
        </div>
      </div>
    </div>
  )
}

export default Page
