import React, { FC } from 'react'
import Main from '@/app/components/explore/installed-app'

export interface IInstalledAppProps { 
  params: {
    appId: string
  }
}

const InstalledApp: FC<IInstalledAppProps> = ({ params: {appId} }) => {
  return (
    <Main id={appId} />
  )
}
export default React.memo(InstalledApp)
