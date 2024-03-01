'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import Log from '@/app/components/app/log'
import WorkflowLog from '@/app/components/app/workflow-log'
import Annotation from '@/app/components/app/annotation'
import { PageType } from '@/app/components/app/configuration/toolbox/annotation/type'
import TabSlider from '@/app/components/base/tab-slider-plain'
import type { AppMode } from '@/types/app'

type Props = {
  pageType: PageType
  appId: string
  appMode: AppMode
}

const LogAnnotation: FC<Props> = ({
  pageType,
  appId,
  appMode,
}) => {
  const { t } = useTranslation()
  const router = useRouter()

  const options = [
    { value: PageType.log, text: t('appLog.title') },
    { value: PageType.annotation, text: t('appAnnotation.title') },
  ]

  return (
    <div className='pt-4 px-6 h-full flex flex-col'>
      {appMode !== 'workflow' && (
        <TabSlider
          className='shrink-0'
          value={pageType}
          onChange={(value) => {
            router.push(`/app/${appId}/${value === PageType.log ? 'logs' : 'annotations'}`)
          }}
          options={options}
        />
      )}
      <div className={cn('grow', appMode !== 'workflow' && 'mt-3')}>
        {pageType === PageType.log && appMode !== 'workflow' && (<Log appId={appId} />)}
        {pageType === PageType.annotation && (<Annotation appId={appId} />)}
        {pageType === PageType.log && appMode === 'workflow' && (<WorkflowLog appId={appId} />)}
      </div>
    </div>
  )
}
export default React.memo(LogAnnotation)
