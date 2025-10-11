import React from 'react'
import Main from '@/app/components/explore/installed-app'

export type IInstalledAppProps = {
  params: {
    appId: string
  }
}

// Using Next.js page convention for async server components
async function InstalledApp({ params }: IInstalledAppProps) {
  const appId = (await params).appId
  return (
    <Main id={appId} />
  )
}

export default InstalledApp
