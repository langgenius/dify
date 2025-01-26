import type { FC } from 'react'
import React from 'react'
import Main from '@/app/components/explore/installed-app'

export type IInstalledAppProps = {
  params: Promise<{
    appId: string
  }>
}

const InstalledApp: FC<IInstalledAppProps> = async ({ params }) => {
  const appId = (await params).appId
  return (
    <Main id={appId} />
  )
}
export default React.memo(InstalledApp)
