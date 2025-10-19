'use client'
import type { FC } from 'react'
import React from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { createApp, fetchAppDetail, fetchAppList, getAppDailyConversations, getAppDailyEndUsers, updateAppApiStatus, updateAppModelConfig, updateAppRateLimit, updateAppSiteAccessToken, updateAppSiteConfig, updateAppSiteStatus } from '../apps'
import Loading from '@/app/components/base/loading'
const Service: FC = () => {
  const { data: appList, error: appListError } = useSWR({ url: '/apps', params: { page: 1 } }, fetchAppList)
  const { data: firstApp, error: appDetailError } = useSWR({ url: '/apps', id: '1' }, fetchAppDetail)
  const { data: updateAppSiteStatusRes, error: err1 } = useSWR({ url: '/apps', id: '1', body: { enable_site: false } }, updateAppSiteStatus)
  const { data: updateAppApiStatusRes, error: err2 } = useSWR({ url: '/apps', id: '1', body: { enable_api: true } }, updateAppApiStatus)
  const { data: updateAppRateLimitRes, error: err3 } = useSWR({ url: '/apps', id: '1', body: { api_rpm: 10, api_rph: 20 } }, updateAppRateLimit)
  const { data: updateAppSiteCodeRes, error: err4 } = useSWR({ url: '/apps', id: '1', body: {} }, updateAppSiteAccessToken)
  const { data: updateAppSiteConfigRes, error: err5 } = useSWR({ url: '/apps', id: '1', body: { title: 'title test', author: 'author test' } }, updateAppSiteConfig)
  const { data: getAppDailyConversationsRes, error: err6 } = useSWR({ url: '/apps', id: '1', body: { start: '1', end: '2' } }, getAppDailyConversations)
  const { data: getAppDailyEndUsersRes, error: err7 } = useSWR({ url: '/apps', id: '1', body: { start: '1', end: '2' } }, getAppDailyEndUsers)
  const { data: updateAppModelConfigRes, error: err8 } = useSWR({ url: '/apps', id: '1', body: { model_id: 'gpt-100' } }, updateAppModelConfig)

  const { mutate } = useSWRConfig()

  const handleCreateApp = async () => {
    await createApp({
      name: `new app${Math.round(Math.random() * 100)}`,
      mode: 'chat',
    })
    // reload app list
    mutate({ url: '/apps', params: { page: 1 } })
  }

  if (appListError || appDetailError || err1 || err2 || err3 || err4 || err5 || err6 || err7 || err8)
    return <div>{JSON.stringify(appListError)}</div>

  if (!appList || !firstApp || !updateAppSiteStatusRes || !updateAppApiStatusRes || !updateAppRateLimitRes || !updateAppSiteCodeRes || !updateAppSiteConfigRes || !getAppDailyConversationsRes || !getAppDailyEndUsersRes || !updateAppModelConfigRes)
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
