'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import ExploreContext from '@/context/explore-context'
import ChatApp from '@/app/components/share/chat'
import TextGenerationApp from '@/app/components/share/text-generation'
import Loading from '@/app/components/base/loading'

export type IInstalledAppProps = {
  id: string
}

const InstalledApp: FC<IInstalledAppProps> = ({
  id,
}) => {
  const { installedApps } = useContext(ExploreContext)
  const installedApp = installedApps.find(item => item.id === id)

  if (!installedApp) {
    return (
      <div className='flex h-full items-center'>
        <Loading type='area' />
      </div>
    )
  }

  return (
    <div className='h-full p-2'>
      {installedApp?.app.mode === 'chat'
        ? (
          <ChatApp isInstalledApp installedAppInfo={installedApp}/>
        )
        : (
          <TextGenerationApp isInstalledApp installedAppInfo={installedApp}/>
        )}
    </div>
  )
}
export default React.memo(InstalledApp)
