'use client'
import type { FC } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import Annotation from '@/app/components/app/annotation'
import Log from '@/app/components/app/log'
import WorkflowLog from '@/app/components/app/workflow-log'
import { PageType } from '@/app/components/base/features/new-feature-panel/annotation-reply/type'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'

type Props = Readonly<{
  appId: string
  pageType: PageType
}>

const LogAnnotation: FC<Props> = ({ appId, pageType }) => {
  const { data: appDetail } = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: { params: { app_id: appId } },
    }),
  )

  if (!appDetail) {
    return (
      <div className="flex h-full items-center justify-center bg-background-body">
        <LoadingPlaceholder />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col px-6 pt-3">
      <div className="h-0 grow">
        {pageType === PageType.log && appDetail.mode !== AppModeEnum.WORKFLOW && (
          <Log appDetail={appDetail} />
        )}
        {pageType === PageType.annotation && <Annotation appDetail={appDetail} />}
        {pageType === PageType.log && appDetail.mode === AppModeEnum.WORKFLOW && (
          <WorkflowLog appDetail={appDetail} />
        )}
      </div>
    </div>
  )
}
export default React.memo(LogAnnotation)
