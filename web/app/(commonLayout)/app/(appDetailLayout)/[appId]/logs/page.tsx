import React from 'react'
import Main from '@/app/components/app/log-annotation'
import { PageType } from '@/app/components/app/configuration/toolbox/annotation/type'

const Logs = async () => {
  return (
    <Main pageType={PageType.log} />
  )
}

export default Logs
