import type { FC } from 'react'
import React from 'react'
import Main from '@/app/components/explore/installed-app'

export type IInstalledAppProps = {
  params: {
    appId: string
  }
}

const InstalledApp: FC<IInstalledAppProps> = ({ params: { appId } }) => {
  return (
    <Main id={appId} />
  )
}
export default React.memo(InstalledApp)
