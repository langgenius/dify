'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import React, { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import TabSlider from '@/app/components/base/tab-slider'

type Props = {
  children: React.ReactNode
}

const Layout: FC<Props> = ({
  children,
}) => {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()

  const options = [
    { value: '/tools/third-part', text: t('tools.type.thirdParty').toUpperCase() },
    // { value: '/tools/published', text: t('tools.published') },
    { value: '/tools/custom', text: t('tools.type.custom').toUpperCase() },
  ]

  const activeTab = pathname

  useEffect(() => {
    document.title = 'Tools - Dify'
  }, [])

  return (
    <div className='grow relative flex flex-col bg-gray-100 overflow-y-auto'>
      <div className='sticky top-0 flex justify-between pt-4 px-12 pb-2 leading-[56px] bg-gray-100 z-10 flex-wrap gap-y-2'>
        <TabSlider
          value={activeTab}
          onChange={value => router.push(value)}
          options={options}
        />
      </div>
      <div className='px-12 pt-2'>
        {children}
      </div>
    </div>
  )
}
export default React.memo(Layout)
