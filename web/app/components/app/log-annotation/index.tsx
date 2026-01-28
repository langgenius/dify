'use client'
import type { FC } from 'react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Annotation from '@/app/components/app/annotation'
import Log from '@/app/components/app/log'
import { useStore as useAppStore } from '@/app/components/app/store'
import WorkflowLog from '@/app/components/app/workflow-log'
import { PageType } from '@/app/components/base/features/new-feature-panel/annotation-reply/type'
import Loading from '@/app/components/base/loading'
import TabSlider from '@/app/components/base/tab-slider-plain'
import { AppModeEnum } from '@/types/app'
import { cn } from '@/utils/classnames'

type Props = {
  pageType: PageType
}

const LogAnnotation: FC<Props> = ({
  pageType,
}) => {
  const { t } = useTranslation()
  const router = useRouter()
  const appDetail = useAppStore(state => state.appDetail)

  const options = useMemo(() => {
    if (appDetail?.mode === AppModeEnum.COMPLETION)
      return [{ value: PageType.log, text: t('title', { ns: 'appLog' }) }]
    return [
      { value: PageType.log, text: t('title', { ns: 'appLog' }) },
      { value: PageType.annotation, text: t('title', { ns: 'appAnnotation' }) },
    ]
  }, [appDetail?.mode, t])

  if (!appDetail) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <Loading />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col px-6 pt-3">
      {appDetail.mode !== AppModeEnum.WORKFLOW && (
        <TabSlider
          className="shrink-0"
          value={pageType}
          onChange={(value) => {
            router.push(`/app/${appDetail.id}/${value === PageType.log ? 'logs' : 'annotations'}`)
          }}
          options={options}
        />
      )}
      <div className={cn('h-0 grow', appDetail.mode !== AppModeEnum.WORKFLOW && 'mt-3')}>
        {pageType === PageType.log && appDetail.mode !== AppModeEnum.WORKFLOW && (<Log appDetail={appDetail} />)}
        {pageType === PageType.annotation && (<Annotation appDetail={appDetail} />)}
        {pageType === PageType.log && appDetail.mode === AppModeEnum.WORKFLOW && (<WorkflowLog appDetail={appDetail} />)}
      </div>
    </div>
  )
}
export default React.memo(LogAnnotation)
