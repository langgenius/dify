import React from 'react'
import Main from '@/app/components/app/log-annotation'
import { PageType } from '@/app/components/app/configuration/toolbox/annotation/type'

export type IProps = {
  params: { appId: string }
}

const Logs = async () => {
  return (
    <Main pageType={PageType.annotation} />
  )
}

export default Logs
