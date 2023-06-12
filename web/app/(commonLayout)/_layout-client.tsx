'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSelectedLayoutSegments } from 'next/navigation'
import useSWR, { SWRConfig } from 'swr'
import * as Sentry from '@sentry/react'
import Header from '../components/header'
import { fetchAppList } from '@/service/apps'
import { fetchDatasets } from '@/service/datasets'
import { fetchLanggeniusVersion, fetchUserProfile, logout } from '@/service/common'
import Loading from '@/app/components/base/loading'
import { AppContextProvider } from '@/context/app-context'
import DatasetsContext from '@/context/datasets-context'
import type { LangGeniusVersionResponse, UserProfileResponse } from '@/models/common'

Sentry.init({
  // dsn: "https://12f61d63153348398b196f99bc2a04c4@o4505072791912448.ingest.sentry.io/4505305961594880",
  integrations: [
    new Sentry.BrowserTracing({
      // Set `tracePropagationTargets` to control for which URLs distributed tracing should be enabled
      // tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/],
    }),
    new Sentry.Replay(),
  ],

  // Set tracesSampleRate to 1.0 to capture 100%
  // of transactions for performance monitoring.
  // We recommend adjusting this value in production
  tracesSampleRate: 1.0,

  // Capture Replay for 10% of all sessions,
  // plus for 100% of sessions with an error
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
})

export type ICommonLayoutProps = {
  children: React.ReactNode
}

const CommonLayout: FC<ICommonLayoutProps> = ({ children }) => {
  const router = useRouter()
  const pathname = usePathname()
  const segments = useSelectedLayoutSegments()
  const pattern = pathname.replace(/.*\/app\//, '')
  const [idOrMethod] = pattern.split('/')
  const isNotDetailPage = idOrMethod === 'list'
  const pageContainerRef = useRef<HTMLDivElement>(null)

  const appId = isNotDetailPage ? '' : idOrMethod

  const { data: appList, mutate: mutateApps } = useSWR({ url: '/apps', params: { page: 1 } }, fetchAppList)
  const { data: datasetList, mutate: mutateDatasets } = useSWR(segments[0] === 'datasets' ? { url: '/datasets', params: { page: 1 } } : null, fetchDatasets)
  const { data: userProfileResponse, mutate: mutateUserProfile } = useSWR({ url: '/account/profile', params: {} }, fetchUserProfile)

  const [userProfile, setUserProfile] = useState<UserProfileResponse>()
  const [langeniusVersionInfo, setLangeniusVersionInfo] = useState<LangGeniusVersionResponse>()
  const updateUserProfileAndVersion = async () => {
    if (userProfileResponse && !userProfileResponse.bodyUsed) {
      const result = await userProfileResponse.json()
      setUserProfile(result)
      const current_version = userProfileResponse.headers.get('x-version')
      const current_env = userProfileResponse.headers.get('x-env')
      const versionData = await fetchLanggeniusVersion({ url: '/version', params: { current_version } })
      setLangeniusVersionInfo({ ...versionData, current_version, latest_version: versionData.version, current_env })
    }
  }
  useEffect(() => {
    updateUserProfileAndVersion()
  }, [userProfileResponse])

  if (!appList || !userProfile || !langeniusVersionInfo)
    return <Loading type='app' />

  const curAppId = segments[0] === 'app' && segments[2]
  const currentDatasetId = segments[0] === 'datasets' && segments[2]
  const currentDataset = datasetList?.data?.find(opt => opt.id === currentDatasetId)

  // if (!isNotDetailPage && !curApp) {
  //   alert('app not found') // TODO： use toast. Now can not get toast context here.
  //   // notify({ type: 'error', message: 'App not found' })
  //   router.push('/apps')
  // }

  const onLogout = async () => {
    await logout({
      url: '/logout',
      params: {},
    })
    router.push('/signin')
  }

  return (
    <SWRConfig value={{
      shouldRetryOnError: false,
    }}>
      <AppContextProvider value={{ apps: appList.data, mutateApps, userProfile, mutateUserProfile, pageContainerRef }}>
        <DatasetsContext.Provider value={{ datasets: datasetList?.data || [], mutateDatasets, currentDataset }}>
          <div ref={pageContainerRef} className='relative flex flex-col h-full overflow-auto bg-gray-100'>
            <Header
              isBordered={['/apps', '/datasets'].includes(pathname)}
              curAppId={curAppId || ''}
              userProfile={userProfile}
              onLogout={onLogout}
              langeniusVersionInfo={langeniusVersionInfo}
            />
            {children}
          </div>
        </DatasetsContext.Provider>
      </AppContextProvider>
    </SWRConfig>
  )
}
export default React.memo(CommonLayout)
