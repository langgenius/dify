'use client'
import type { FC } from 'react'
import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createApp, updateAppApiStatus, updateAppModelConfig, updateAppRateLimit, updateAppSiteAccessToken, updateAppSiteConfig, updateAppSiteStatus } from '../apps'
import Loading from '@/app/components/base/loading'
import { AppModeEnum } from '@/types/app'
import {
  useAppDailyConversations,
  useAppDailyEndUsers,
  useAppDetail,
  useAppList,
} from '../use-apps'

const Service: FC = () => {
  const appId = '1'
  const queryClient = useQueryClient()

  const { data: appList, error: appListError, isLoading: isAppListLoading } = useAppList({ page: 1, limit: 30, name: '' })
  const { data: firstApp, error: appDetailError, isLoading: isAppDetailLoading } = useAppDetail(appId)

  const { data: updateAppSiteStatusRes, error: err1, isLoading: isUpdatingSiteStatus } = useQuery({
    queryKey: ['demo', 'updateAppSiteStatus', appId],
    queryFn: () => updateAppSiteStatus({ url: '/apps', body: { enable_site: false } }),
  })
  const { data: updateAppApiStatusRes, error: err2, isLoading: isUpdatingApiStatus } = useQuery({
    queryKey: ['demo', 'updateAppApiStatus', appId],
    queryFn: () => updateAppApiStatus({ url: '/apps', body: { enable_api: true } }),
  })
  const { data: updateAppRateLimitRes, error: err3, isLoading: isUpdatingRateLimit } = useQuery({
    queryKey: ['demo', 'updateAppRateLimit', appId],
    queryFn: () => updateAppRateLimit({ url: '/apps', body: { api_rpm: 10, api_rph: 20 } }),
  })
  const { data: updateAppSiteCodeRes, error: err4, isLoading: isUpdatingSiteCode } = useQuery({
    queryKey: ['demo', 'updateAppSiteAccessToken', appId],
    queryFn: () => updateAppSiteAccessToken({ url: '/apps' }),
  })
  const { data: updateAppSiteConfigRes, error: err5, isLoading: isUpdatingSiteConfig } = useQuery({
    queryKey: ['demo', 'updateAppSiteConfig', appId],
    queryFn: () => updateAppSiteConfig({ url: '/apps', body: { title: 'title test', author: 'author test' } }),
  })

  const { data: getAppDailyConversationsRes, error: err6, isLoading: isConversationsLoading } = useAppDailyConversations(appId, { start: '1', end: '2' })
  const { data: getAppDailyEndUsersRes, error: err7, isLoading: isEndUsersLoading } = useAppDailyEndUsers(appId, { start: '1', end: '2' })

  const { data: updateAppModelConfigRes, error: err8, isLoading: isUpdatingModelConfig } = useQuery({
    queryKey: ['demo', 'updateAppModelConfig', appId],
    queryFn: () => updateAppModelConfig({ url: '/apps', body: { model_id: 'gpt-100' } }),
  })

  const { mutateAsync: mutateCreateApp } = useMutation({
    mutationKey: ['demo', 'createApp'],
    mutationFn: () => createApp({
      name: `new app${Math.round(Math.random() * 100)}`,
      mode: AppModeEnum.CHAT,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['apps', 'list'],
      })
    },
  })

  const handleCreateApp = async () => {
    await mutateCreateApp()
  }

  if (appListError || appDetailError || err1 || err2 || err3 || err4 || err5 || err6 || err7 || err8)
    return <div>{JSON.stringify(appListError ?? appDetailError ?? err1 ?? err2 ?? err3 ?? err4 ?? err5 ?? err6 ?? err7 ?? err8)}</div>

  const isLoading = isAppListLoading
    || isAppDetailLoading
    || isUpdatingSiteStatus
    || isUpdatingApiStatus
    || isUpdatingRateLimit
    || isUpdatingSiteCode
    || isUpdatingSiteConfig
    || isConversationsLoading
    || isEndUsersLoading
    || isUpdatingModelConfig

  if (isLoading || !appList || !firstApp || !updateAppSiteStatusRes || !updateAppApiStatusRes || !updateAppRateLimitRes || !updateAppSiteCodeRes || !updateAppSiteConfigRes || !getAppDailyConversationsRes || !getAppDailyEndUsersRes || !updateAppModelConfigRes)
    return <Loading />

  return (
    <div>
      <div className='flex flex-col gap-3'>
        <div>
          <div>1.App list</div>
          <div>
            {appList.data.map(item => (
              <div key={item.id}>{item.id} {item.name}</div>
            ))}
          </div>
        </div>

        <div>
          <div>2.First app detail</div>
          <div>{JSON.stringify(firstApp)}</div>
        </div>

        <div>
          <button type="button" onClick={handleCreateApp}>Click me to Create App</button>
        </div>

        <div>
          <div>4.updateAppSiteStatusRes</div>
          <div>{JSON.stringify(updateAppSiteStatusRes)}</div>
        </div>

        <div>
          <div>5.updateAppApiStatusRes</div>
          <div>{JSON.stringify(updateAppApiStatusRes)}</div>
        </div>

        <div>
          <div>6.updateAppRateLimitRes</div>
          <div>{JSON.stringify(updateAppRateLimitRes)}</div>
        </div>

        <div>
          <div>7.updateAppSiteCodeRes</div>
          <div>{JSON.stringify(updateAppSiteCodeRes)}</div>
        </div>

        <div>
          <div>8.updateAppSiteConfigRes</div>
          <div>{JSON.stringify(updateAppSiteConfigRes)}</div>
        </div>

        <div>
          <div>9.getAppDailyConversationsRes</div>
          <div>{JSON.stringify(getAppDailyConversationsRes)}</div>
        </div>

        <div>
          <div>10.getAppDailyEndUsersRes</div>
          <div>{JSON.stringify(getAppDailyEndUsersRes)}</div>
        </div>

        <div>
          <div>11.updateAppModelConfigRes</div>
          <div>{JSON.stringify(updateAppModelConfigRes)}</div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(Service)
