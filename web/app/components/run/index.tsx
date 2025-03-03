'use client'
import React, { useEffect, useState } from 'react'
import TextGeneration from '@/app/components/run/text-generation'
import Loading from '@/app/components/base/loading'
import { useStore as useAppStore } from '@/app/components/app/store'
import { fetchInstalledAppList } from '@/service/explore'
import type { InstalledApp } from '@/models/explore'
import useSWR from 'swr'
import { fetchApiKeysList } from '@/service/apps'
const TextGenerationApp = ({ installedApp }) => {
  const { data: apiKeysList } = useSWR({ url: `/apps/${installedApp.app.id}/api-keys`, params: {} }, fetchApiKeysList)
  return apiKeysList?.data?.length > 0 && <TextGeneration isWorkflow isInstalledApp installedAppInfo={installedApp} apiKey={apiKeysList.data[0].token}/>
}
const WorkflowRunContainer = () => {
  const appDetail = useAppStore(state => state.appDetail)!
  const [installedApp, setInstalledApp] = useState<InstalledApp>()

  const getAppInfo = async () => {
    const { installed_apps }: any = await fetchInstalledAppList(appDetail.id) || {}
    setInstalledApp(installed_apps?.length > 0 ? installed_apps[0] : null)
  }
  useEffect(() => {
    getAppInfo()
  }, [appDetail.id])
  if (!installedApp) {
    return (
      <div className='flex h-full items-center'>
        <Loading type='area' />
      </div>
    )
  }

  return (
    <div className='h-full py-2 pl-0 pr-2 sm:p-2'>
      {installedApp.app.mode === 'workflow' && (
        <TextGenerationApp installedApp={installedApp}/>
      )}
    </div>
  )
}
export default React.memo(WorkflowRunContainer)
