import React from 'react'
import Main from '@/app/components/app/log-annotation'
import { PageType } from '@/app/components/app/configuration/toolbox/annotation/type'
import type { AppMode } from '@/types/app'

export type IProps = {
  params: { appId: string }
  appMode: AppMode
}

const Logs = async ({
  params: { appId },
  appMode,
}: IProps) => {
  return (
    <Main appMode={appMode} pageType={PageType.log} appId={appId} />
  )
}

export default Logs
