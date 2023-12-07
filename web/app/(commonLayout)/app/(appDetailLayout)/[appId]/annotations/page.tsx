import React from 'react'
import Main from '@/app/components/app/log-annotation'
import { PageType } from '@/app/components/app/configuration/toolbox/annotation/type'

export type IProps = {
  params: { appId: string }
}

const Logs = async ({
  params: { appId },
}: IProps) => {
  return (
    <Main pageType={PageType.annotation} appId={appId} />
  )
}

export default Logs
