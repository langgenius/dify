import React from 'react'
import Main from '@/app/components/try/app/index'

export type IInstalledAppProps = {
  params: {
    appId: string
  }
}

async function InstalledApp({ params }: IInstalledAppProps) {
  const appId = (await params).appId
  return (
    <Main appId={appId} />
  )
}

export default InstalledApp
