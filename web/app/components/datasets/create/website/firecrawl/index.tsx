'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import Header from './header'
import UrlInput from './base/url-input'
import OptionsWrap from './base/options-wrap'
import Options from './options'
import { useModalContext } from '@/context/modal-context'
import type { CrawlOptions } from '@/models/datasets'
type Props = {

}
const DEFAULT_CRAWL_OPTIONS: CrawlOptions = {
  crawl_sub_pages: true,
  only_main_content: true,
  includes: '',
  excludes: '',
  limit: 100,
  max_depth: 3,
}
const FireCrawl: FC<Props> = () => {
  const { setShowAccountSettingModal } = useModalContext()
  const handleSetting = useCallback(() => {
    setShowAccountSettingModal({
      payload: 'data-source',
    })
  }, [setShowAccountSettingModal])

  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>(DEFAULT_CRAWL_OPTIONS)

  const handleRun = useCallback((url: string) => {
    console.log(url)
  }, [])
  return (
    <div>
      <Header onSetting={handleSetting} />
      <div className='mt-2 p-3 pb-4 rounded-xl border border-gray-200'>
        <UrlInput onRun={handleRun} />

        <OptionsWrap className='mt-3 space-y-2'>
          <Options className='mt-2' payload={crawlOptions} onChange={setCrawlOptions} />
        </OptionsWrap>
      </div>
    </div>
  )
}
export default React.memo(FireCrawl)
