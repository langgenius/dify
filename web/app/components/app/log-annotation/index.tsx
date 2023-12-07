'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import Log from '@/app/components/app/log'
import Annotation from '@/app/components/app/annotation'
import { PageType } from '@/app/components/app/configuration/toolbox/annotation/type'
import TabSlider from '@/app/components/base/tab-slider-plain'

type Props = {
  pageType: PageType
  appId: string
}

const LogAnnotation: FC<Props> = ({
  pageType,
  appId,
}) => {
  const { t } = useTranslation()
  const router = useRouter()

  const options = [
    { value: PageType.log, text: t('appLog.title') },
    { value: PageType.annotation, text: t('appAnnotation.title') },
  ]

  return (
    <div className='pt-4 px-6 h-full flex flex-col'>
      <TabSlider
        className='shrink-0'
        value={pageType}
        onChange={(value) => {
          router.push(`/app/${appId}/${value === PageType.log ? 'logs' : 'annotations'}`)
        }}
        options={options}
      />
      <div className='mt-3 grow'>
        {pageType === PageType.log && (<Log appId={appId} />)}
        {pageType === PageType.annotation && (<Annotation appId={appId} />)}
      </div>
    </div>
  )
}
export default React.memo(LogAnnotation)
