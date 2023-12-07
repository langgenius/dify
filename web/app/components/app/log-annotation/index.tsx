'use client'
import type { FC } from 'react'
import React from 'react'
import Log from '@/app/components/app/log'
import Annotation from '@/app/components/app/annotation'
import { PageType } from '@/app/components/app/configuration/toolbox/annotation/type'

type Props = {
  pageType: PageType
  appId: string
}

const LogAnnotation: FC<Props> = ({
  pageType,
  appId,
}) => {
  return (
    <div>
      <div>Tabs</div>
      <div>
        {pageType === PageType.log && (<Log appId={appId} />)}
        {pageType === PageType.annotation && (<Annotation appId={appId} />)}
      </div>
    </div>
  )
}
export default React.memo(LogAnnotation)
