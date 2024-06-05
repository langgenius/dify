'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import Header from './header'
import UrlInput from './base/url-input'
import OptionsWrap from './base/options-wrap'
import { useModalContext } from '@/context/modal-context'
type Props = {

}

const FireCrawl: FC<Props> = () => {
  const { setShowAccountSettingModal } = useModalContext()
  const handleSetting = useCallback(() => {
    setShowAccountSettingModal({
      payload: 'data-source',
    })
  }, [setShowAccountSettingModal])

  const handleRun = useCallback((url: string) => {
    console.log(url)
  }, [])
  return (
    <div>
      <Header onSetting={handleSetting} />
      <div className='mt-2 p-3 pb-4 rounded-xl border border-gray-200'>
        <UrlInput onRun={handleRun} />

        <OptionsWrap>
          <div>contents</div>
        </OptionsWrap>
      </div>
    </div>
  )
}
export default React.memo(FireCrawl)
