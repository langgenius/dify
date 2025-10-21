import React from 'react'
import Main from '@/app/components/app/log-annotation'
import { PageType } from '@/app/components/base/features/new-feature-panel/annotation-reply/type'

const Logs = async () => {
  return (
    <Main pageType={PageType.log} />
  )
}

export default Logs
