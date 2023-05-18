'use client'
import React, { FC, useEffect } from 'react'
import { App } from '@/types/app'
import ChatApp from '@/app/components/share/chat'
import { fetchAppDetail } from '@/service/explore'
import Loading from '@/app/components/base/loading'

export interface IInstalledAppProps {
  id: string
}

const InstalledApp: FC<IInstalledAppProps> = ({
  id,
}) => {
  const [app, setApp] = React.useState<App | null>(null)
  const [isLoaded, setIsLoaded] = React.useState(false)
  useEffect(() => {
    if(id) {
      setIsLoaded(false);
      (async () => {
        const appDetail = await fetchAppDetail(id)
        setApp(appDetail)
        setIsLoaded(true)
      })()
    }
  }, [id])

  if(!isLoaded) {
    return (
      <div className='flex h-full items-center'>
        <Loading type='area' />
      </div>
    )
  }
  
  return (
    <div className='h-full'>
      <ChatApp isInstalledApp installedAppInfo={app as App}/>
    </div>
  )
}
export default React.memo(InstalledApp)
