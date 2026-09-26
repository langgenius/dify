import * as React from 'react'
import Main from '@/app/components/app/log-annotation'
import { PageType } from '@/app/components/base/features/new-feature-panel/annotation-reply/type'

const Logs = async ({ params }: { params: Promise<{ appId: string }> }) => {
  const { appId } = await params
  return <Main appId={appId} pageType={PageType.log} />
}

export default Logs
