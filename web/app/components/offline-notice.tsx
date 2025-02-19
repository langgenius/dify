'use client'
import { RiCloseLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export default function OfflineNotice({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  const [showOfflineNotice, { setFalse }] = useBoolean(true)

  useEffect(() => {
    const timer = setTimeout(setFalse, 60000)
    return () => clearTimeout(timer)
  }, [setFalse])
  return <>
    {showOfflineNotice && <div className='px-4 py-2 flex items-center justify-start gap-x-2 bg-[#FFFAEB] border-b-[0.5px] border-b-[#FEF0C7]'>
      <div className='rounded-[12px] flex items-center justify-center px-2 py-0.5 h-[22px] bg-[#f79009] text-white text-[11px] not-italic font-medium leading[18px]'>{t('common.offlineNoticeTitle')}</div>
      <div className='grow font-medium leading-[18px] text-[12px] not-italic text-[#344054]'>{t('common.offlineNotice')}</div>
      <RiCloseLine className='size-4 text-[#667085] cursor-pointer' onClick={setFalse} />
    </div>}
    {children}
  </>
}
