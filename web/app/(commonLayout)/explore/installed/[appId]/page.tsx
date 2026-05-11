import * as React from 'react'
import Main from '@/app/components/explore/installed-app'

export type IInstalledAppProps = {
  params?: Promise<{
    appId: string
  }>
}

// Using Next.js page convention for async server components
async function InstalledApp({ params }: IInstalledAppProps) {
  const { appId } = await (params ?? Promise.reject(new Error('Missing params')))
  return (
    <Main id={appId} />
  )
}

export default InstalledApp
