import type { FC } from 'react'
import React from 'react'
import Main from '@/app/components/explore/installed-app'

export type IInstalledAppProps = {
  params: Promise<{
    appId: string
  }>
}

const InstalledApp: FC<IInstalledAppProps> = async ({ params }) => {
  return (
    <Main id={(await params).appId} />
  )
}
export default React.memo(InstalledApp)
